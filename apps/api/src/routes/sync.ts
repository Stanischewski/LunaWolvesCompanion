import type { FastifyInstance } from "fastify";
import { eq, and, desc, sql, gt, isNull } from "drizzle-orm";
import { parseLua, LuaParseError } from "@guild/lua-parser";
import type { LuaValue } from "@guild/lua-parser";
import type { WowClass } from "@guild/shared-types";
import { db } from "../db/index.js";
import { guilds, characters, addonSnapshots, activityLogs, dkpEntries, dkpStandings, dkpTombstones, players } from "../db/schema.js";

/**
 * Sync Service — Addon-Datenupload (Phase 2).
 *
 * Erwartetes SavedVariables-Format (globale Variable `LunaWolvesDB`):
 *   LunaWolvesDB = {
 *     ["version"]   = 1,
 *     ["scannedAt"] = <unix-timestamp>,
 *     ["guild"]     = { ["name"]=<string>, ["realm"]=<string>, ["faction"]="Horde"|"Alliance" },
 *     ["members"]   = {
 *       ["<Name-Realm>"] = {
 *         ["name"]=<string>, ["realm"]=<string>, ["class"]=<WoW-Klassentoken>,
 *         ["level"]=<int>, ["itemLevel"]=<int>, ["guildRank"]=<int>,
 *         ["online"]=<bool>, ["lastSeen"]=<unix-timestamp>,
 *       }, ...
 *     },
 *   }
 */

const DKP_TYPE_MAP: Record<string, "manual" | "boss" | "spend" | "correction"> = {
  MANUAL: "manual",
  BOSS: "boss",
  SPEND: "spend",
  CORRECTION: "correction",
  ADJUST: "correction",
};

const CLASS_MAP: Record<string, WowClass> = {
  WARRIOR: "warrior",
  PALADIN: "paladin",
  HUNTER: "hunter",
  ROGUE: "rogue",
  PRIEST: "priest",
  SHAMAN: "shaman",
  MAGE: "mage",
  WARLOCK: "warlock",
  MONK: "monk",
  DRUID: "druid",
  DEMONHUNTER: "demon_hunter",
  DEATHKNIGHT: "death_knight",
  EVOKER: "evoker",
};

interface AddonDkpEntry {
  id: string;
  player: string;
  delta: number;
  reason: string;
  type: string;
  officer: string;
  timestamp: number;
}

interface AddonTombstone {
  player: string;
  timestamp: number;
  officer: string;
}

interface AddonVersionEntry {
  name: string;
  realm: string;
  battleTag: string;
}

function parseVersions(rootValue: LuaValue): AddonVersionEntry[] {
  if (!isLuaObject(rootValue)) return [];
  const versionsRaw = rootValue.Versions;
  if (!isLuaObject(versionsRaw)) return [];

  const result: AddonVersionEntry[] = [];
  for (const [fullName, raw] of Object.entries(versionsRaw)) {
    if (!isLuaObject(raw)) continue;
    const battleTag = raw.battleTag;
    if (typeof battleTag !== "string" || !battleTag) continue;

    // fullName-Format: "Name-Realm"
    const dashIdx = fullName.indexOf("-");
    if (dashIdx <= 0) continue;
    const name = fullName.slice(0, dashIdx);
    const realm = fullName.slice(dashIdx + 1);
    if (!name || !realm) continue;

    result.push({ name, realm, battleTag });
  }
  return result;
}

interface AddonMember {
  name: string;
  realm: string;
  class: string;
  level: number;
  itemLevel: number;
  guildRank: number;
  online: boolean;
  lastSeen: number;
}

interface AddonRoster {
  version: number;
  guild: { name: string; realm: string; faction: "alliance" | "horde" };
  scannedAt: number;
  members: AddonMember[];
  skipped: number;
}

type RosterResult = { ok: true; roster: AddonRoster } | { ok: false; error: string };

function isLuaObject(value: LuaValue): value is { [key: string]: LuaValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toFaction(value: string): "alliance" | "horde" | null {
  const lower = value.toLowerCase();
  if (lower === "alliance" || lower === "horde") return lower;
  return null;
}

function toMember(value: LuaValue): AddonMember | null {
  if (!isLuaObject(value)) return null;
  const { name, realm, class: cls, level, itemLevel, guildRank, online, lastSeen } = value;
  if (typeof name !== "string" || typeof realm !== "string" || typeof cls !== "string") {
    return null;
  }
  return {
    name,
    realm,
    class: cls,
    level: typeof level === "number" ? level : 0,
    itemLevel: typeof itemLevel === "number" ? itemLevel : 0,
    guildRank: typeof guildRank === "number" ? guildRank : 0,
    online: online === true,
    lastSeen: typeof lastSeen === "number" ? lastSeen : 0,
  };
}

function parseRoster(value: LuaValue): RosterResult {
  if (!isLuaObject(value)) {
    return { ok: false, error: "LunaWolvesDB ist keine Lua-Tabelle" };
  }
  const guildRaw = value.guild;
  if (!isLuaObject(guildRaw)) {
    return { ok: false, error: "Feld 'guild' fehlt oder ist keine Tabelle" };
  }
  const { name, realm, faction } = guildRaw;
  if (typeof name !== "string" || typeof realm !== "string" || typeof faction !== "string") {
    return { ok: false, error: "guild.name, guild.realm und guild.faction muessen Strings sein" };
  }
  const factionNorm = toFaction(faction);
  if (factionNorm === null) {
    return { ok: false, error: `Ungueltige Fraktion '${faction}' (erwartet: Alliance oder Horde)` };
  }

  const membersRaw = value.members;
  let memberValues: LuaValue[];
  if (Array.isArray(membersRaw)) {
    memberValues = membersRaw;
  } else if (isLuaObject(membersRaw)) {
    memberValues = Object.values(membersRaw);
  } else {
    return { ok: false, error: "Feld 'members' fehlt oder ist keine Tabelle" };
  }

  const members: AddonMember[] = [];
  let skipped = 0;
  for (const raw of memberValues) {
    const member = toMember(raw);
    if (member) members.push(member);
    else skipped++;
  }

  return {
    ok: true,
    roster: {
      version: typeof value.version === "number" ? value.version : 1,
      guild: { name, realm, faction: factionNorm },
      scannedAt: typeof value.scannedAt === "number" ? value.scannedAt : Math.floor(Date.now() / 1000),
      members,
      skipped,
    },
  };
}

function toLuaArray(value: LuaValue): LuaValue[] {
  if (Array.isArray(value)) return value;
  if (isLuaObject(value)) return Object.values(value);
  return [];
}

function parseDkp(
  rootValue: LuaValue,
): { entries: AddonDkpEntry[]; tombstones: AddonTombstone[] } | null {
  if (!isLuaObject(rootValue)) return null;
  const dkpRaw = rootValue.DKP;
  if (!isLuaObject(dkpRaw)) return null;

  const entries: AddonDkpEntry[] = [];
  for (const raw of toLuaArray(dkpRaw.history)) {
    if (!isLuaObject(raw)) continue;
    const { id, player, delta, reason, type, officer, timestamp } = raw;
    if (typeof id !== "string" || typeof player !== "string" || !id || !player) continue;
    entries.push({
      id,
      player,
      delta: typeof delta === "number" ? delta : 0,
      reason: typeof reason === "string" ? reason : "",
      type: typeof type === "string" ? type.toUpperCase() : "MANUAL",
      officer: typeof officer === "string" ? officer : "",
      timestamp: typeof timestamp === "number" ? timestamp : 0,
    });
  }

  const tombstones: AddonTombstone[] = [];
  for (const raw of toLuaArray(dkpRaw.deleted)) {
    if (!isLuaObject(raw)) continue;
    const { player, timestamp, officer } = raw;
    if (typeof player !== "string" || !player) continue;
    tombstones.push({
      player,
      timestamp: typeof timestamp === "number" ? timestamp : 0,
      officer: typeof officer === "string" ? officer : "",
    });
  }

  return { entries, tombstones };
}

export async function syncRoutes(app: FastifyInstance) {
  app.post<{ Body: string }>(
    "/sync/addon-data",
    { onRequest: [app.authenticate], bodyLimit: 2_097_152 },
    async (request, reply) => {
      if (!request.body || !request.body.trim()) {
        return reply
          .status(400)
          .send({ error: "Leerer Request-Body (Content-Type: text/plain erwartet)" });
      }

      let globals: Record<string, LuaValue>;
      try {
        globals = parseLua(request.body);
      } catch (err) {
        if (err instanceof LuaParseError) {
          return reply.status(400).send({ error: `Lua-Parsing fehlgeschlagen: ${err.message}` });
        }
        throw err;
      }

      const rawData = globals.LunaWolvesDB;
      if (rawData === undefined) {
        return reply
          .status(400)
          .send({ error: "Globale Variable 'LunaWolvesDB' nicht gefunden" });
      }

      const parsed = parseRoster(rawData);
      if (!parsed.ok) {
        return reply.status(400).send({ error: parsed.error });
      }
      const roster = parsed.roster;

      const result = await db.transaction(async (tx) => {
        let guild = await tx.query.guilds.findFirst({
          where: and(
            eq(guilds.name, roster.guild.name),
            eq(guilds.realm, roster.guild.realm),
          ),
        });
        if (guild) {
          await tx
            .update(guilds)
            .set({ memberCount: roster.members.length })
            .where(eq(guilds.id, guild.id));
        } else {
          const inserted = await tx
            .insert(guilds)
            .values({
              name: roster.guild.name,
              realm: roster.guild.realm,
              faction: roster.guild.faction,
              memberCount: roster.members.length,
            })
            .returning();
          guild = inserted[0];
        }

        const [snapshot] = await tx
          .insert(addonSnapshots)
          .values({ guildId: guild.id, uploadedBy: request.user.sub, rawData })
          .returning({ id: addonSnapshots.id });

        let updated = 0;
        let created = 0;
        for (const member of roster.members) {
          const mappedClass = CLASS_MAP[member.class.toUpperCase()];
          if (!mappedClass) continue; // unbekannte Klasse — überspringen

          const seenAt = member.online ? roster.scannedAt : member.lastSeen;
          const lastLogin = new Date(seenAt * 1000);

          const existing = await tx.query.characters.findFirst({
            where: and(
              eq(characters.guildId, guild.id),
              eq(characters.name, member.name),
              eq(characters.realm, member.realm),
            ),
          });

          if (!existing) {
            const [inserted] = await tx
              .insert(characters)
              .values({
                guildId: guild.id,
                name: member.name,
                realm: member.realm,
                class: mappedClass,
                level: member.level,
                itemLevel: member.itemLevel,
                guildRank: member.guildRank,
                lastLogin,
              })
              .returning();
            await tx.insert(activityLogs).values({
              characterId: inserted.id,
              eventType: "seen",
              eventData: { online: member.online, level: member.level, itemLevel: member.itemLevel },
              source: "addon",
            });
            created++;
            continue;
          }

          await tx
            .update(characters)
            .set({
              level: member.level,
              itemLevel: member.itemLevel,
              guildRank: member.guildRank,
              lastLogin,
              class: mappedClass,
            })
            .where(eq(characters.id, existing.id));
          updated++;

          const previous = existing.lastLogin ? existing.lastLogin.getTime() : 0;
          if (lastLogin.getTime() > previous) {
            await tx.insert(activityLogs).values({
              characterId: existing.id,
              eventType: "seen",
              eventData: { online: member.online, level: member.level, itemLevel: member.itemLevel },
              source: "addon",
            });
          }
        }

        // DKP-Merge
        const dkp = parseDkp(rawData);
        let dkpEntriesInserted = 0;
        let dkpTombstonesInserted = 0;
        const dkpAffectedPlayers = new Set<string>();

        if (dkp) {
          // Tombstones zuerst einfügen
          for (const tomb of dkp.tombstones) {
            const deletedAt = new Date(tomb.timestamp * 1000);
            const expiresAt = new Date(deletedAt.getTime() + 90 * 24 * 60 * 60 * 1000);
            const [inserted] = await tx
              .insert(dkpTombstones)
              .values({
                guildId: guild.id,
                playerName: tomb.player,
                deletedBy: tomb.officer,
                deletedAt,
                expiresAt,
              })
              .onConflictDoNothing()
              .returning({ id: dkpTombstones.id });
            if (inserted) {
              dkpTombstonesInserted++;
              dkpAffectedPlayers.add(tomb.player);
            }
          }

          // Alle aktiven Tombstones für diese Gilde laden (für Entry-Filter)
          const activeTombstones = await tx.query.dkpTombstones.findMany({
            where: eq(dkpTombstones.guildId, guild.id),
          });
          const tombstoneMap = new Map<string, Date>(
            activeTombstones.map((t) => [t.playerName, t.deletedAt]),
          );

          // History-Einträge einfügen
          for (const entry of dkp.entries) {
            const mappedType = DKP_TYPE_MAP[entry.type];
            if (!mappedType) continue;

            const occurredAt = new Date(entry.timestamp * 1000);

            // Tombstone-Check: Eintrag überspringen wenn Spieler nach/zum Zeitpunkt gelöscht
            const tombstoneDate = tombstoneMap.get(entry.player);
            if (tombstoneDate && tombstoneDate >= occurredAt) continue;

            const [inserted] = await tx
              .insert(dkpEntries)
              .values({
                guildId: guild.id,
                addonEntryId: entry.id,
                playerName: entry.player,
                delta: entry.delta,
                reason: entry.reason,
                entryType: mappedType,
                officerName: entry.officer,
                occurredAt,
                source: "addon",
              })
              .onConflictDoNothing()
              .returning({ id: dkpEntries.id });

            if (inserted) {
              dkpEntriesInserted++;
              dkpAffectedPlayers.add(entry.player);
            }
          }

          // Standings für alle betroffenen Spieler neu berechnen
          for (const playerName of dkpAffectedPlayers) {
            const tombstone = tombstoneMap.get(playerName);
            const baseWhere = and(
              eq(dkpEntries.guildId, guild.id),
              eq(dkpEntries.playerName, playerName),
            );
            const whereClause = tombstone
              ? and(baseWhere, gt(dkpEntries.occurredAt, tombstone))
              : baseWhere;

            const [sums] = await tx
              .select({
                current: sql<number>`COALESCE(SUM(${dkpEntries.delta}), 0)::int`,
                lifetime: sql<number>`COALESCE(SUM(CASE WHEN ${dkpEntries.delta} > 0 THEN ${dkpEntries.delta} ELSE 0 END), 0)::int`,
              })
              .from(dkpEntries)
              .where(whereClause);

            await tx
              .insert(dkpStandings)
              .values({ guildId: guild.id, playerName, current: sums.current, lifetime: sums.lifetime })
              .onConflictDoUpdate({
                target: [dkpStandings.guildId, dkpStandings.playerName],
                set: { current: sums.current, lifetime: sums.lifetime, updatedAt: new Date() },
              });
          }
        }

        // Auto-Linking: Versions-BattleTags mit players.bnetTag abgleichen
        const versionEntries = parseVersions(rawData);
        let charactersLinked = 0;
        for (const entry of versionEntries) {
          // Nur Characters dieser Gilde berücksichtigen
          const character = await tx.query.characters.findFirst({
            where: and(
              eq(characters.guildId, guild.id),
              eq(characters.name, entry.name),
              eq(characters.realm, entry.realm),
              isNull(characters.playerId),
            ),
          });
          if (!character) continue;

          const player = await tx.query.players.findFirst({
            where: eq(players.bnetTag, entry.battleTag),
          });
          if (!player) continue;

          await tx
            .update(characters)
            .set({ playerId: player.id })
            .where(eq(characters.id, character.id));
          charactersLinked++;
        }

        return {
          snapshotId: snapshot.id,
          guild,
          updated,
          created,
          dkpEntriesInserted,
          dkpTombstonesInserted,
          dkpPlayersRecalculated: dkpAffectedPlayers.size,
          charactersLinked,
        };
      });

      app.io.to(`guild:${result.guild.id}`).emit("member_seen", {
        guildId: result.guild.id,
        updated: result.updated,
        scannedAt: roster.scannedAt,
      });

      if (result.dkpEntriesInserted > 0 || result.dkpTombstonesInserted > 0) {
        app.io.to(`guild:${result.guild.id}`).emit("dkp_update", {
          guildId: result.guild.id,
          entriesInserted: result.dkpEntriesInserted,
          tombstonesInserted: result.dkpTombstonesInserted,
        });
      }

      // Rückkanal: ausstehende Web-Einträge zusammenstellen und als geliefert markieren
      const pendingWebEntries = await db
        .select()
        .from(dkpEntries)
        .where(
          and(
            eq(dkpEntries.guildId, result.guild.id),
            eq(dkpEntries.source, "web"),
            isNull(dkpEntries.addonSyncedAt),
          ),
        )
        .orderBy(dkpEntries.occurredAt);

      if (pendingWebEntries.length > 0) {
        await db
          .update(dkpEntries)
          .set({ addonSyncedAt: new Date() })
          .where(
            and(
              eq(dkpEntries.guildId, result.guild.id),
              eq(dkpEntries.source, "web"),
              isNull(dkpEntries.addonSyncedAt),
            ),
          );
      }

      return reply.status(201).send({
        snapshotId: result.snapshotId,
        guild: { id: result.guild.id, name: result.guild.name, realm: result.guild.realm },
        membersInRoster: roster.members.length,
        membersSkipped: roster.skipped,
        charactersCreated: result.created,
        charactersUpdated: result.updated,
        dkpEntriesInserted: result.dkpEntriesInserted,
        dkpTombstonesInserted: result.dkpTombstonesInserted,
        dkpPlayersRecalculated: result.dkpPlayersRecalculated,
        charactersLinked: result.charactersLinked,
        pendingWebEntries,
      });
    },
  );

  app.get<{ Params: { guildId: string }; Querystring: { limit?: string } }>(
    "/guilds/:guildId/activity",
    async (request) => {
      const limit = Math.min(Math.max(Number(request.query.limit) || 50, 1), 200);
      return db
        .select({
          id: activityLogs.id,
          eventType: activityLogs.eventType,
          eventData: activityLogs.eventData,
          recordedAt: activityLogs.recordedAt,
          source: activityLogs.source,
          character: {
            id: characters.id,
            name: characters.name,
            class: characters.class,
          },
        })
        .from(activityLogs)
        .innerJoin(characters, eq(activityLogs.characterId, characters.id))
        .where(eq(characters.guildId, request.params.guildId))
        .orderBy(desc(activityLogs.recordedAt))
        .limit(limit);
    },
  );

  app.get<{ Params: { guildId: string } }>(
    "/guilds/:guildId/sync/pending-entries",
    { onRequest: [app.authenticate] },
    async (request) => {
      const { guildId } = request.params;

      const pending = await db
        .select()
        .from(dkpEntries)
        .where(
          and(
            eq(dkpEntries.guildId, guildId),
            eq(dkpEntries.source, "web"),
            isNull(dkpEntries.addonSyncedAt),
          ),
        )
        .orderBy(dkpEntries.occurredAt);

      if (pending.length > 0) {
        await db
          .update(dkpEntries)
          .set({ addonSyncedAt: new Date() })
          .where(
            and(
              eq(dkpEntries.guildId, guildId),
              eq(dkpEntries.source, "web"),
              isNull(dkpEntries.addonSyncedAt),
            ),
          );
      }

      return pending;
    },
  );

  app.get<{ Params: { guildId: string } }>(
    "/guilds/:guildId/sync/latest",
    async (request, reply) => {
      const snapshot = await db.query.addonSnapshots.findFirst({
        where: eq(addonSnapshots.guildId, request.params.guildId),
        orderBy: desc(addonSnapshots.uploadedAt),
      });
      if (!snapshot) {
        return reply.status(404).send({ error: "Noch kein Addon-Snapshot fuer diese Gilde" });
      }
      return snapshot;
    },
  );
}
