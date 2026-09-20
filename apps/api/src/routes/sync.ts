import type { FastifyInstance } from "fastify";
import { eq, and, desc, sql, isNull, isNotNull, count, inArray, notInArray } from "drizzle-orm";
import { parseLua, LuaParseError } from "@guild/lua-parser";
import type { LuaValue } from "@guild/lua-parser";
import type { WowClass } from "@guild/shared-types";
import { db } from "../db/index.js";
import { guilds, characters, addonSnapshots, activityLogs, dkpEntries, dkpStandings, dkpTombstones, dkpSeasons } from "../db/schema.js";
import { requirePlayerAccount } from "../lib/auth.js";
import { requireRole } from "../lib/permissions.js";
import { getSeasonStart, recalculateStandings, getActiveTombstones } from "../lib/dkpSeason.js";

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

const MIN_ADDON_VERSION = 1;

/** Muss zu TOMBSTONE_TTL in Modules/DKP.lua passen. */
const TOMBSTONE_TTL_MS = 90 * 24 * 60 * 60 * 1000;

/** Obergrenze fuer den Rueckkanal, damit unbestaetigte Eintraege die Antwort nicht sprengen. */
const PENDING_ENTRY_LIMIT = 200;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Einfacher In-Memory-Cooldown pro Spieler (verhindert Sync-Spam).
// Ueber SYNC_COOLDOWN_MS konfigurierbar — 0 schaltet ihn ab (Tests, Staging).
const syncCooldowns = new Map<string, number>();
const SYNC_COOLDOWN_MS = Number(process.env.SYNC_COOLDOWN_MS ?? 60_000);

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
): { entries: AddonDkpEntry[]; tombstones: AddonTombstone[]; seasonEpoch: number } | null {
  if (!isLuaObject(rootValue)) return null;
  const dkpRaw = rootValue.DKP;
  if (!isLuaObject(dkpRaw)) return null;

  // Zeitpunkt des letzten Season-Resets im Addon (0 = noch keiner).
  const seasonEpoch = typeof dkpRaw.seasonEpoch === "number" ? dkpRaw.seasonEpoch : 0;

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

  return { entries, tombstones, seasonEpoch };
}

export async function syncRoutes(app: FastifyInstance) {
  app.post<{ Body: string }>(
    "/sync/addon-data",
    { onRequest: [app.authenticate, requirePlayerAccount], bodyLimit: 2_097_152 },
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

      if (roster.version < MIN_ADDON_VERSION) {
        return reply.status(400).send({
          error: `Addon-Version ${roster.version} zu alt (Minimum: ${MIN_ADDON_VERSION}). Bitte Addon aktualisieren.`,
        });
      }

      const nowMs = Date.now();
      const lastSync = syncCooldowns.get(request.user.sub) ?? 0;
      if (SYNC_COOLDOWN_MS > 0 && nowMs - lastSync < SYNC_COOLDOWN_MS) {
        const waitSec = Math.ceil((SYNC_COOLDOWN_MS - (nowMs - lastSync)) / 1000);
        return reply.status(429).send({ error: `Sync-Cooldown aktiv. Bitte ${waitSec}s warten.` });
      }
      syncCooldowns.set(request.user.sub, nowMs);

      const result = await db.transaction(async (tx) => {
        let guild = await tx.query.guilds.findFirst({
          where: and(
            eq(guilds.name, roster.guild.name),
            eq(guilds.realm, roster.guild.realm),
          ),
        });
        // Fallback: Name-only suchen — Connected Realms können denselben Gilden-Namen
        // mit unterschiedlichen Realm-Strings melden (z.B. "Eredar" vs. "Aman'thul").
        if (!guild) {
          guild = await tx.query.guilds.findFirst({
            where: eq(guilds.name, roster.guild.name),
          });
        }
        if (!guild) {
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

        // ── Saison-Grenze ────────────────────────────────────────────────
        // Hat ein Officer im Spiel "/lw dkp reset" ausgeführt, kennt nur das
        // Addon die neue Saison. Der Server übernimmt sie hier, sonst würde
        // der Sync die alten Einträge weiter mitsummieren.
        let seasonStart = await getSeasonStart(tx, guild.id);
        const addonEpoch = parseDkp(rawData)?.seasonEpoch ?? 0;
        let seasonAdoptedFromAddon = false;

        if (addonEpoch > 0) {
          const addonEpochDate = new Date(addonEpoch * 1000);
          if (addonEpochDate > seasonStart) {
            await tx.insert(dkpSeasons).values({
              guildId: guild.id,
              name: `Saison bis ${addonEpochDate.toISOString().slice(0, 10)} (Addon)`,
              archivedBy: "Addon",
              startedAt: seasonStart.getTime() === 0 ? null : seasonStart,
              archivedAt: addonEpochDate,
              snapshotData: await tx
                .select()
                .from(dkpStandings)
                .where(eq(dkpStandings.guildId, guild.id)),
            });
            seasonStart = addonEpochDate;
            seasonAdoptedFromAddon = true;
          }
        }

        // ── Charaktere abgleichen ────────────────────────────────────────
        // Frueher lief hier pro Mitglied ein SELECT plus ein INSERT/UPDATE und
        // ggf. ein activity-INSERT — bei 500 Mitgliedern bis zu 1.500
        // Roundtrips, und das alles unter Schreibsperren in einer Transaktion.
        // Jetzt: einmal vorladen, im Speicher diffen, dann je eine Anweisung
        // fuer Anlegen, Aktualisieren und Aktivitaetseintraege.
        const existingChars = await tx
          .select({
            id: characters.id,
            name: characters.name,
            realm: characters.realm,
            lastLogin: characters.lastLogin,
            leftGuildAt: characters.leftGuildAt,
          })
          .from(characters)
          .where(eq(characters.guildId, guild.id));

        const charKey = (name: string, realm: string) => `${name.toLowerCase()}|${realm.toLowerCase()}`;
        const byKey = new Map(existingChars.map((c) => [charKey(c.name, c.realm), c]));

        type PendingActivity = { characterId: string; online: boolean; level: number; itemLevel: number };
        const toInsert: (typeof characters.$inferInsert)[] = [];
        const toUpdate: Array<{
          id: string; level: number; itemLevel: number; guildRank: number;
          lastLogin: Date; class: WowClass; wasAway: boolean;
        }> = [];
        const newActivity: PendingActivity[] = [];
        const seenIds = new Set<string>();
        const insertMeta = new Map<string, { online: boolean; level: number; itemLevel: number }>();

        for (const member of roster.members) {
          const mappedClass = CLASS_MAP[member.class.toUpperCase()];
          if (!mappedClass) continue; // unbekannte Klasse — überspringen

          const seenAt = member.online ? roster.scannedAt : member.lastSeen;
          const lastLogin = new Date(seenAt * 1000);
          const existing = byKey.get(charKey(member.name, member.realm));

          if (!existing) {
            insertMeta.set(charKey(member.name, member.realm), {
              online: member.online, level: member.level, itemLevel: member.itemLevel,
            });
            toInsert.push({
              guildId: guild.id,
              name: member.name,
              realm: member.realm,
              class: mappedClass,
              level: member.level,
              itemLevel: member.itemLevel,
              guildRank: member.guildRank,
              lastLogin,
            });
            continue;
          }

          seenIds.add(existing.id);
          toUpdate.push({
            id: existing.id,
            level: member.level,
            itemLevel: member.itemLevel,
            guildRank: member.guildRank,
            lastLogin,
            class: mappedClass,
            wasAway: existing.leftGuildAt !== null,
          });

          const previous = existing.lastLogin ? existing.lastLogin.getTime() : 0;
          if (lastLogin.getTime() > previous) {
            newActivity.push({
              characterId: existing.id,
              online: member.online, level: member.level, itemLevel: member.itemLevel,
            });
          }
        }

        let created = 0;
        if (toInsert.length > 0) {
          const insertedRows = await tx
            .insert(characters)
            .values(toInsert)
            .returning({ id: characters.id, name: characters.name, realm: characters.realm });
          created = insertedRows.length;
          for (const row of insertedRows) {
            seenIds.add(row.id);
            const meta = insertMeta.get(charKey(row.name, row.realm));
            if (meta) newActivity.push({ characterId: row.id, ...meta });
          }
        }

        // Eine UPDATE ... FROM (VALUES ...)-Anweisung statt N Einzelupdates.
        let updated = 0;
        if (toUpdate.length > 0) {
          const rows = toUpdate.map(
            // lastLogin als ISO-String: Date-Objekte kann postgres.js in
            // tx.execute nicht binden.
            (u) => sql`(${u.id}::uuid, ${u.level}::int, ${u.itemLevel}::int, ${u.guildRank}::int, ${u.lastLogin.toISOString()}::timestamptz, ${u.class}::wow_class)`,
          );
          await tx.execute(sql`
            UPDATE characters AS c
            SET level = v.level,
                item_level = v.item_level,
                guild_rank = v.guild_rank,
                last_login = v.last_login,
                class = v.class,
                left_guild_at = NULL
            FROM (VALUES ${sql.join(rows, sql`, `)})
              AS v(id, level, item_level, guild_rank, last_login, class)
            WHERE c.id = v.id
          `);
          updated = toUpdate.length;
        }
        const returnedCount = toUpdate.filter((u) => u.wasAway).length;

        if (newActivity.length > 0) {
          await tx.insert(activityLogs).values(
            newActivity.map((a) => ({
              characterId: a.characterId,
              eventType: "seen",
              eventData: { online: a.online, level: a.level, itemLevel: a.itemLevel },
              source: "addon" as const,
            })),
          );
        }

        // ── Gildenaustritte (B9) ─────────────────────────────────────────
        // Charaktere, die im Snapshot fehlen, gelten als ausgetreten. Bewusst
        // kein Loeschen — DKP-History und Raid-Anmeldungen bleiben erhalten.
        //
        // SCHUTZ: Ist im Spiel "Offline anzeigen" deaktiviert, liefert
        // GetGuildRosterInfo nur die eingeloggten Mitglieder (Review B10). Ein
        // solcher Teil-Snapshot wuerde die halbe Gilde als ausgetreten
        // markieren. Deshalb wird nur markiert, wenn der Snapshot mindestens
        // 70 % der bekannten aktiven Charaktere enthaelt.
        const activeBefore = existingChars.filter((c) => c.leftGuildAt === null).length;
        const coverage = activeBefore === 0 ? 1 : seenIds.size / activeBefore;
        let markedAsLeft = 0;
        let departureCheckSkipped = false;

        if (coverage >= 0.7) {
          const seen = [...seenIds];
          const departed = await tx
            .update(characters)
            .set({ leftGuildAt: new Date() })
            .where(
              and(
                eq(characters.guildId, guild.id),
                isNull(characters.leftGuildAt),
                seen.length > 0 ? notInArray(characters.id, seen) : undefined,
              ),
            )
            .returning({ id: characters.id });
          markedAsLeft = departed.length;
        } else {
          departureCheckSkipped = true;
          app.log.warn(
            `[Sync] Gilde ${guild.id}: Snapshot deckt nur ${Math.round(coverage * 100)} % ` +
              `der aktiven Charaktere ab — Austrittspruefung uebersprungen. ` +
              `Vermutlich ist im Spiel "Offline anzeigen" deaktiviert.`,
          );
        }

        // memberCount zaehlt die aktiven Charaktere, nicht die Snapshot-Groesse
        const [{ activeCount }] = await tx
          .select({ activeCount: count() })
          .from(characters)
          .where(and(eq(characters.guildId, guild.id), isNull(characters.leftGuildAt)));
        await tx.update(guilds).set({ memberCount: activeCount }).where(eq(guilds.id, guild.id));

        // DKP-Merge
        const dkp = parseDkp(rawData);
        let dkpEntriesInserted = 0;
        let dkpTombstonesInserted = 0;
        const dkpAffectedPlayers = new Set<string>();

        if (dkp) {
          // Tombstones als Batch einfügen (1 Query statt N)
          if (dkp.tombstones.length > 0) {
            const insertedTombs = await tx
              .insert(dkpTombstones)
              .values(
                dkp.tombstones.map((tomb) => {
                  const deletedAt = new Date(tomb.timestamp * 1000);
                  return {
                    guildId: guild.id,
                    playerName: tomb.player,
                    deletedBy: tomb.officer,
                    deletedAt,
                    expiresAt: new Date(deletedAt.getTime() + TOMBSTONE_TTL_MS),
                  };
                }),
              )
              .onConflictDoNothing()
              .returning({ playerName: dkpTombstones.playerName });
            dkpTombstonesInserted = insertedTombs.length;
            for (const row of insertedTombs) dkpAffectedPlayers.add(row.playerName);
          }

          // Nur *aktive* Tombstones filtern. Der Server wertete expiresAt bisher
          // gar nicht aus, womit ein einmal gelöschter Spieler dauerhaft
          // gefiltert blieb — während das Addon ihn nach 90 Tagen längst wieder
          // akzeptierte. Die beiden Seiten drifteten dadurch auseinander.
          const activeTombstones = await getActiveTombstones(tx, guild.id);
          const tombstoneMap = new Map<string, Date>(
            activeTombstones.map((t) => [t.playerName, t.deletedAt]),
          );

          // Bulk-Prefetch aller bereits bekannten Entry-IDs (1 Query statt N)
          const knownEntryRows = await tx
            .select({ addonEntryId: dkpEntries.addonEntryId })
            .from(dkpEntries)
            .where(and(eq(dkpEntries.guildId, guild.id), isNotNull(dkpEntries.addonEntryId)));
          const knownEntryIds = new Set(knownEntryRows.map((r) => r.addonEntryId as string));

          // Kandidaten filtern: bekannte, tombstoned und typunbekannte Einträge aussortieren
          type MappedEntry = AddonDkpEntry & { mappedType: NonNullable<(typeof DKP_TYPE_MAP)[string]> };
          const candidateEntries: MappedEntry[] = [];
          for (const entry of dkp.entries) {
            const mappedType = DKP_TYPE_MAP[entry.type.toUpperCase()];
            if (!mappedType) continue;
            if (knownEntryIds.has(entry.id)) continue;
            const tombstoneDate = tombstoneMap.get(entry.player);
            if (tombstoneDate && tombstoneDate >= new Date(entry.timestamp * 1000)) continue;
            candidateEntries.push({ ...entry, mappedType });
          }

          // Batch-Insert der neuen Einträge (1 Query statt N)
          if (candidateEntries.length > 0) {
            const insertedRows = await tx
              .insert(dkpEntries)
              .values(
                candidateEntries.map((entry) => ({
                  guildId: guild.id,
                  addonEntryId: entry.id,
                  playerName: entry.player,
                  delta: entry.delta,
                  reason: entry.reason,
                  entryType: entry.mappedType,
                  officerName: entry.officer,
                  occurredAt: new Date(entry.timestamp * 1000),
                  source: "addon" as const,
                })),
              )
              .onConflictDoNothing()
              .returning({ playerName: dkpEntries.playerName });
            dkpEntriesInserted = insertedRows.length;
            for (const row of insertedRows) {
              dkpAffectedPlayers.add(row.playerName);
            }
          }

          // Standings aller betroffenen Spieler in EINER Anweisung neu berechnen
          // (vorher: ein SELECT plus ein UPSERT je Spieler). Die Saison-Grenze
          // sorgt dafür, dass ein Season-Reset hält — ohne sie summierte der
          // Sync wieder über *alle* Einträge und holte den kompletten
          // Vor-Reset-Stand zurück.
          await recalculateStandings(tx, guild.id, [...dkpAffectedPlayers], seasonStart);
        }

        // Auto-Linking: Versions-BattleTags mit players.bnetTag abgleichen.
        // Vorher zwei SELECTs plus ein UPDATE je Eintrag — jetzt eine Anweisung.
        const versionEntries = parseVersions(rawData);
        let charactersLinked = 0;
        if (versionEntries.length > 0) {
          const rows = versionEntries.map(
            (e) => sql`(${e.name}, ${e.realm}, ${e.battleTag})`,
          );
          const linkResult = await tx.execute(sql`
            UPDATE characters AS c
            SET player_id = p.id
            FROM (VALUES ${sql.join(rows, sql`, `)}) AS v(name, realm, tag)
            JOIN players p ON p.bnet_tag = v.tag
            WHERE c.guild_id = ${guild.id}::uuid
              AND c.name = v.name
              AND c.realm = v.realm
              AND c.player_id IS NULL
          `);
          charactersLinked = (linkResult as unknown as { count?: number }).count ?? 0;
        }

        const latestAddonEntryTimestamp = dkp
          ? dkp.entries.reduce((max, e) => Math.max(max, e.timestamp), 0)
          : 0;

        return {
          snapshotId: snapshot.id,
          guild,
          updated,
          created,
          dkpEntriesInserted,
          dkpEntriesTotal: dkp?.entries.length ?? 0,
          dkpTombstonesInserted,
          dkpPlayersRecalculated: dkpAffectedPlayers.size,
          charactersLinked,
          versionsChecked: versionEntries.length,
          latestAddonEntryTimestamp,
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

      // Rückkanal: ausstehende Web-Einträge ausliefern.
      //
      // Sie werden hier NICHT als geliefert markiert. Vorher geschah das
      // zusammen mit dem Absenden der Antwort — brach die Verbindung ab oder
      // stürzte der Client beim Verarbeiten, waren die im Web vergebenen
      // Punkte dauerhaft verloren: addonSyncedAt war gesetzt, die Einträge
      // tauchten nie wieder auf. Die Bestätigung erfolgt jetzt separat über
      // POST /guilds/:guildId/sync/ack.
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
        .orderBy(dkpEntries.occurredAt)
        .limit(PENDING_ENTRY_LIMIT);

      return reply.status(201).send({
        snapshotId: result.snapshotId,
        guild: { id: result.guild.id, name: result.guild.name, realm: result.guild.realm },
        membersInRoster: roster.members.length,
        membersSkipped: roster.skipped,
        charactersCreated: result.created,
        charactersUpdated: result.updated,
        dkpEntriesInserted: result.dkpEntriesInserted,
        dkpEntriesTotal: result.dkpEntriesTotal,
        dkpTombstonesInserted: result.dkpTombstonesInserted,
        dkpPlayersRecalculated: result.dkpPlayersRecalculated,
        charactersLinked: result.charactersLinked,
        versionsChecked: result.versionsChecked,
        latestAddonEntryTimestamp: result.latestAddonEntryTimestamp,
        pendingWebEntries,
      });
    },
  );

  app.get<{ Params: { guildId: string }; Querystring: { limit?: string } }>(
    "/guilds/:guildId/activity",
    { onRequest: [app.authenticate] },
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
    // Markiert Einträge als ausgeliefert — destruktiv. Vorher genügte ein
    // beliebiges JWT, womit jeder den Rückkanal einer fremden Gilde leeren
    // konnte.
    "/guilds/:guildId/sync/pending-entries",
    { onRequest: [requireRole("editor")] },
    async (request) => {
      const { guildId } = request.params;

      // Wie beim Sync: nur lesen. Bestätigt wird über /sync/ack.
      return db
        .select()
        .from(dkpEntries)
        .where(
          and(
            eq(dkpEntries.guildId, guildId),
            eq(dkpEntries.source, "web"),
            isNull(dkpEntries.addonSyncedAt),
          ),
        )
        .orderBy(dkpEntries.occurredAt)
        .limit(PENDING_ENTRY_LIMIT);
    },
  );

  // Zweite Stufe des Rückkanals: erst nach erfolgreicher Verarbeitung
  // bestätigen. Unbestätigte Einträge werden beim nächsten Sync erneut
  // ausgeliefert — das Addon erkennt Duplikate ohnehin über die Entry-ID.
  app.post<{ Params: { guildId: string }; Body: { entryIds?: unknown } }>(
    "/guilds/:guildId/sync/ack",
    { onRequest: [app.authenticate] },
    async (request, reply) => {
      const { guildId } = request.params;
      if (!UUID_RE.test(guildId)) {
        return reply.status(400).send({ error: "Ungültige Gilden-ID" });
      }

      const { entryIds } = request.body ?? {};
      if (!Array.isArray(entryIds) || entryIds.length === 0) {
        return reply.status(400).send({ error: "entryIds (nicht leer) erforderlich" });
      }
      if (entryIds.length > PENDING_ENTRY_LIMIT) {
        return reply.status(400).send({ error: `Höchstens ${PENDING_ENTRY_LIMIT} IDs pro Aufruf` });
      }
      const ids = entryIds.filter((id): id is string => typeof id === "string" && UUID_RE.test(id));
      if (ids.length === 0) {
        return reply.status(400).send({ error: "Keine gültige UUID in entryIds" });
      }

      const acked = await db
        .update(dkpEntries)
        .set({ addonSyncedAt: new Date() })
        .where(
          and(
            eq(dkpEntries.guildId, guildId),
            eq(dkpEntries.source, "web"),
            isNull(dkpEntries.addonSyncedAt),
            inArray(dkpEntries.id, ids),
          ),
        )
        .returning({ id: dkpEntries.id });

      return { acknowledged: acked.length };
    },
  );

  app.get<{ Params: { guildId: string } }>(
    // Der Roh-Snapshot enthält die komplette DKP-History und die BattleTags aus
    // dem Versions-Modul — der zugriffsbeschränkteste Endpunkt der API.
    "/guilds/:guildId/sync/latest",
    { onRequest: [requireRole("admin")] },
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
