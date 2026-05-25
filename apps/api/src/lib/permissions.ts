import type { FastifyRequest, FastifyReply } from "fastify";
import { db } from "../db/index.js";
import { players, guilds, guildSettings } from "../db/schema.js";
import { eq } from "drizzle-orm";

interface RoleCacheEntry {
  roles: string[];
  cachedAt: number;
}

const roleCache = new Map<string, RoleCacheEntry>();
const CACHE_TTL = 5 * 60 * 1000;

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

    const guild =
      (await db.query.guilds.findFirst({ where: eq(guilds.isPrimary, true) })) ??
      (await db.query.guilds.findFirst());
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

    const memberRoles = await getDiscordMemberRoles(player.discordId);

    const allowedRoles = role === "admin" ? adminRoles : [...adminRoles, ...editorRoles];
    const hasAccess = memberRoles.some((r) => allowedRoles.includes(r));

    if (!hasAccess) {
      return reply.status(403).send({ error: "Keine Berechtigung" });
    }
  };
}
