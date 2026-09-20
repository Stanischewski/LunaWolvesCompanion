import type { FastifyRequest, FastifyReply } from "fastify";
import { db } from "../db/index.js";
import { players, guilds, guildSettings, raidEvents } from "../db/schema.js";
import { eq } from "drizzle-orm";
import { isBotRequest, markBotRequest } from "./auth.js";
import { cacheGet, cacheSet } from "./cache.js";

const CACHE_TTL = 5 * 60 * 1000;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Ermittelt die Gilden-ID, gegen die Rollen geprueft werden. Gibt null zurueck,
 * wenn die Route sie nicht bestimmen kann — dann greift die primaere Gilde.
 *
 * Bewusst explizit pro Route statt "irgendein :id-Parameter": `/raids/:id`
 * traegt eine Raid-ID, `/guilds/:id` eine Gilden-ID. Beides gleich zu behandeln
 * waere ein stiller Fehlgriff.
 */
export type GuildIdResolver = (request: FastifyRequest) => Promise<string | null>;

/** Standard: `/guilds/:guildId/...` */
const guildFromGuildIdParam: GuildIdResolver = async (request) => {
  const { guildId } = (request.params ?? {}) as { guildId?: string };
  return guildId && UUID_RE.test(guildId) ? guildId : null;
};

/** Fuer Routen, bei denen `:id` die Gilde ist (`/guilds/:id/...`). */
export const guildFromIdParam: GuildIdResolver = async (request) => {
  const { id } = (request.params ?? {}) as { id?: string };
  return id && UUID_RE.test(id) ? id : null;
};

/** Fuer Routen, bei denen `:id` ein Raid ist (`/raids/:id`). */
export const guildFromRaidParam: GuildIdResolver = async (request) => {
  const { id } = (request.params ?? {}) as { id?: string };
  if (!id || !UUID_RE.test(id)) return null;
  const raid = await db.query.raidEvents.findFirst({
    where: eq(raidEvents.id, id),
    columns: { guildId: true },
  });
  return raid?.guildId ?? null;
};

/**
 * Die Gilde, gegen die Rollen aufgeloest werden.
 *
 * Ohne Routen-Bezug wuerden Rechte in einer Multi-Gilden-Installation immer an
 * der primaeren Gilde haengen, auch wenn die Route eine andere meint. Fallback
 * bleibt die primaere Gilde, damit Routen ohne Gilden-Bezug funktionieren.
 */
async function resolveGuildForRoles(request: FastifyRequest, resolver: GuildIdResolver) {
  const routeGuildId = await resolver(request);

  if (routeGuildId) {
    const guild = await db.query.guilds.findFirst({ where: eq(guilds.id, routeGuildId) });
    if (guild) return guild;
  }

  return (
    (await db.query.guilds.findFirst({ where: eq(guilds.isPrimary, true) })) ??
    (await db.query.guilds.findFirst())
  );
}

async function getDiscordMemberRoles(discordId: string): Promise<string[]> {
  const cacheKey = `roles:${discordId}`;
  const cached = await cacheGet(cacheKey);
  if (cached !== null) {
    try {
      return JSON.parse(cached) as string[];
    } catch {
      // beschädigter Eintrag — neu holen
    }
  }

  const discordGuildId = process.env.DISCORD_GUILD_ID;
  const botToken = process.env.DISCORD_BOT_TOKEN;

  if (!discordGuildId || !botToken) return [];

  const res = await fetch(
    `https://discord.com/api/v10/guilds/${discordGuildId}/members/${discordId}`,
    { headers: { Authorization: `Bot ${botToken}` } },
  );

  if (!res.ok) return [];

  const member = (await res.json()) as { roles: string[] };
  await cacheSet(cacheKey, JSON.stringify(member.roles), CACHE_TTL);
  return member.roles;
}

export function requireRole(
  role: "admin" | "editor",
  resolveGuildId: GuildIdResolver = guildFromGuildIdParam,
) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    // Der Discord-Bot prueft die Officer-Rolle bereits selbst (commands/dkp.ts)
    // und authentifiziert sich mit dem Bot-Secret. Ein JWT hat er nicht.
    if (isBotRequest(request)) {
      markBotRequest(request);
      return;
    }

    try {
      await request.jwtVerify();
    } catch {
      return reply.status(401).send({ error: "Nicht authentifiziert" });
    }

    const playerId = (request.user as { sub: string }).sub;

    const player = await db.query.players.findFirst({
      where: eq(players.id, playerId),
    });

    if (!player?.discordId) {
      return reply.status(403).send({ error: "Discord-Konto muss verknüpft sein" });
    }

    const guild = await resolveGuildForRoles(request, resolveGuildId);
    if (!guild) return reply.status(403).send({ error: "Keine Gilde konfiguriert" });

    const settings = await db.query.guildSettings.findFirst({
      where: eq(guildSettings.guildId, guild.id),
    });

    const bootstrapRoleId = process.env.ADMIN_DISCORD_ROLE_ID;
    const adminRoles = [
      ...(settings?.adminRoleIds ?? []),
      ...(bootstrapRoleId ? [bootstrapRoleId] : []),
    ];
    const editorRoles = settings?.editorRoleIds ?? [];

    const allowedRoles = role === "admin" ? adminRoles : [...adminRoles, ...editorRoles];

    // Ohne konfigurierte Rollen kann niemand die Pruefung bestehen. Das ist
    // richtig so (fail closed), muss aber erkennbar sein — sonst sucht der
    // Admin den Fehler bei seinem Discord-Konto statt in der Konfiguration.
    if (allowedRoles.length === 0) {
      request.log.warn(
        `[Permissions] Gilde ${guild.id} hat keine ${role}-Rollen konfiguriert — Zugriff verweigert.`,
      );
      return reply.status(403).send({
        error:
          "Keine Rollen konfiguriert. ADMIN_DISCORD_ROLE_ID setzen oder Rollen unter Einstellungen hinterlegen.",
      });
    }

    const memberRoles = await getDiscordMemberRoles(player.discordId);
    const hasAccess = memberRoles.some((r) => allowedRoles.includes(r));

    if (!hasAccess) {
      return reply.status(403).send({ error: "Keine Berechtigung" });
    }
  };
}
