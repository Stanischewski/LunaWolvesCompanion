import type { FastifyInstance } from "fastify";
import { eq, and, desc } from "drizzle-orm";
import { parseLua, LuaParseError } from "@guild/lua-parser";
import type { LuaValue } from "@guild/lua-parser";
import type { WowClass } from "@guild/shared-types";
import { db } from "../db/index.js";
import { guilds, characters, addonSnapshots, activityLogs } from "../db/schema.js";

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
        let unmatched = 0;
        for (const member of roster.members) {
          const existing = await tx.query.characters.findFirst({
            where: and(
              eq(characters.guildId, guild.id),
              eq(characters.name, member.name),
              eq(characters.realm, member.realm),
            ),
          });
          if (!existing) {
            unmatched++;
            continue;
          }
          const seenAt = member.online ? roster.scannedAt : member.lastSeen;
          const lastLogin = new Date(seenAt * 1000);
          const mappedClass = CLASS_MAP[member.class.toUpperCase()];
          await tx
            .update(characters)
            .set({
              level: member.level,
              itemLevel: member.itemLevel,
              guildRank: member.guildRank,
              lastLogin,
              ...(mappedClass ? { class: mappedClass } : {}),
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

        return { snapshotId: snapshot.id, guild, updated, unmatched };
      });

      app.io.to(`guild:${result.guild.id}`).emit("member_seen", {
        guildId: result.guild.id,
        updated: result.updated,
        scannedAt: roster.scannedAt,
      });

      return reply.status(201).send({
        snapshotId: result.snapshotId,
        guild: { id: result.guild.id, name: result.guild.name, realm: result.guild.realm },
        membersInRoster: roster.members.length,
        membersSkipped: roster.skipped,
        charactersUpdated: result.updated,
        charactersUnmatched: result.unmatched,
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
