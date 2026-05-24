import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { eq, and, inArray } from "drizzle-orm";
import { db } from "../db/index.js";
import { guildSettings, players, characters, raidEvents, raidSignups } from "../db/schema.js";

async function requireBotSecret(request: FastifyRequest, reply: FastifyReply) {
  const botSecret = process.env.BOT_SECRET;
  if (!botSecret || request.headers["x-bot-secret"] !== botSecret) {
    return reply.status(401).send({ error: "Nicht autorisiert" });
  }
}

async function doSignup(raidId: string, characterId: string, role: "tank" | "heal" | "dps") {
  const char = await db.query.characters.findFirst({
    where: eq(characters.id, characterId),
    columns: { playerId: true },
  });
  if (char?.playerId) {
    const playerChars = await db.query.characters.findMany({
      where: eq(characters.playerId, char.playerId),
      columns: { id: true },
    });
    const otherIds = playerChars.map((c) => c.id).filter((id) => id !== characterId);
    if (otherIds.length > 0) {
      await db.delete(raidSignups).where(
        and(eq(raidSignups.raidEventId, raidId), inArray(raidSignups.characterId, otherIds)),
      );
    }
  }
  await db
    .insert(raidSignups)
    .values({ raidEventId: raidId, characterId, role, status: "yes" })
    .onConflictDoUpdate({
      target: [raidSignups.raidEventId, raidSignups.characterId],
      set: { role, status: "yes" },
    });
}

export async function botRoutes(app: FastifyInstance) {
  const guard = { onRequest: [requireBotSecret] };

  // GET /bot/guilds/:guildId/settings — raidChannelId ohne Rollenprüfung
  app.get<{ Params: { guildId: string } }>(
    "/bot/guilds/:guildId/settings",
    guard,
    async (request) => {
      const { guildId } = request.params;
      const settings = await db.query.guildSettings.findFirst({
        where: eq(guildSettings.guildId, guildId),
      });
      return settings ?? { guildId, raidChannelId: null };
    },
  );

  // PATCH /bot/raids/:raidId/calendar-message — Discord-Nachrichten-ID pro Raid speichern
  app.patch<{ Params: { raidId: string }; Body: { calendarMessageId: string | null } }>(
    "/bot/raids/:raidId/calendar-message",
    guard,
    async (request, reply) => {
      const { raidId } = request.params;
      const { calendarMessageId } = request.body;
      const [updated] = await db
        .update(raidEvents)
        .set({ calendarMessageId })
        .where(eq(raidEvents.id, raidId))
        .returning();
      if (!updated) return reply.status(404).send({ error: "Raid nicht gefunden" });
      return updated;
    },
  );

  // POST /bot/raids/:raidId/signup — Anmeldung per Discord-ID
  // Gibt { status: "signed_up" | "select_character" | "no_character", ... } zurück
  app.post<{
    Params: { raidId: string };
    Body: { discordId: string; role: "tank" | "heal" | "dps" };
  }>("/bot/raids/:raidId/signup", guard, async (request, reply) => {
    const { raidId } = request.params;
    const { discordId, role } = request.body;

    const raid = await db.query.raidEvents.findFirst({
      where: eq(raidEvents.id, raidId),
      columns: { guildId: true },
    });
    if (!raid) return reply.status(404).send({ error: "Raid nicht gefunden" });

    const player = await db.query.players.findFirst({
      where: eq(players.discordId, discordId),
      columns: { id: true },
    });
    if (!player) return { status: "no_character" };

    const playerChars = await db.query.characters.findMany({
      where: and(eq(characters.playerId, player.id), eq(characters.guildId, raid.guildId)),
      columns: { id: true, name: true, class: true },
    });
    if (playerChars.length === 0) return { status: "no_character" };
    if (playerChars.length > 1) return { status: "select_character", characters: playerChars };

    await doSignup(raidId, playerChars[0].id, role);
    return { status: "signed_up", character: playerChars[0] };
  });

  // POST /bot/raids/:raidId/signup-by-char — Anmeldung mit konkreter Charakter-ID
  app.post<{
    Params: { raidId: string };
    Body: { characterId: string; role: "tank" | "heal" | "dps" };
  }>("/bot/raids/:raidId/signup-by-char", guard, async (request) => {
    const { raidId } = request.params;
    const { characterId, role } = request.body;
    await doSignup(raidId, characterId, role);
    return { status: "signed_up" };
  });

  // POST /bot/raids/:raidId/unregister — Abmeldung per Discord-ID
  app.post<{
    Params: { raidId: string };
    Body: { discordId: string };
  }>("/bot/raids/:raidId/unregister", guard, async (request) => {
    const { raidId } = request.params;
    const { discordId } = request.body;

    const player = await db.query.players.findFirst({
      where: eq(players.discordId, discordId),
      columns: { id: true },
    });
    if (!player) return { status: "ok" };

    const playerChars = await db.query.characters.findMany({
      where: eq(characters.playerId, player.id),
      columns: { id: true },
    });
    if (playerChars.length > 0) {
      await db.delete(raidSignups).where(
        and(
          eq(raidSignups.raidEventId, raidId),
          inArray(raidSignups.characterId, playerChars.map((c) => c.id)),
        ),
      );
    }
    return { status: "ok" };
  });
}
