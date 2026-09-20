import type { FastifyRequest, FastifyReply } from "fastify";
import { db } from "../db/index.js";
import { players, guilds, guildSettings } from "../db/schema.js";
import { eq } from "drizzle-orm";
import { isBotRequest, markBotRequest } from "./auth.js";

interface RoleCacheEntry {
  roles: string[];
  cachedAt: number;
}

const roleCache = new Map<string, RoleCacheEntry>();
const CACHE_TTL = 5 * 60 * 1000;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Die Gilde, gegen die Rollen aufgeloest werden.
 *
 * Bevorzugt die Gilde aus der Route (`/guilds/:guildId/...`) — sonst wuerden
 * Rechte in einer Multi-Gilden-Installation immer an der primaeren Gilde
 * haengen, auch wenn die Route eine andere meint. Fallback bleibt wie bisher
 * die primaere Gilde, damit Routen ohne guildId-Parameter weiter funktionieren.
 */
async function resolveGuildForRoles(request: FastifyRequest) {
  const params = request.params as { guildId?: string; id?: string } | undefined;
  const routeGuildId = params?.guildId ?? params?.id;

  if (routeGuildId && UUID_RE.test(routeGuildId)) {
    const guild = await db.query.guilds.findFirst({ where: eq(guilds.id, routeGuildId) });
    if (guild) return guild;
  }

  return (
    (await db.query.guilds.findFirst({ where: eq(guilds.isPrimary, true) })) ??
    (await db.query.guilds.findFirst())
  );
}

async function getDiscordMemberRoles(discordId: string): Promise<string[]> {
  const cached = roleCache.get(discordId);
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL) return cached.roles;

  const discordGuildId = process.env.DISCORD_GUILD_ID;
  const botToken = process.env.DISCORD_BOT_TOKEN;

  if (!discordGuildId || !botToken) return [];

  const res = await fetch(
    `https://discord.com/api/v10/guilds/${discordGuildId}/members/${discordId}`,
    { headers: { Authorization: `Bot ${botToken}` } },
  );

  if (!res.ok) return [];

  const member = (await res.json()) as { roles: string[] };
  roleCache.set(discordId, { roles: member.roles, cachedAt: Date.now() });
  return member.roles;
}

export function requireRole(role: "admin" | "editor") {
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

    const guild = await resolveGuildForRoles(request);
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
