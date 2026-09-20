import type { FastifyInstance } from "fastify";
import { db } from "../db/index.js";
import { raidEvents, raidSignups, characters } from "../db/schema.js";
import { eq, and, asc, inArray } from "drizzle-orm";
import { requireRole, guildFromRaidParam } from "../lib/permissions.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Stellt sicher, dass der Charakter dem angemeldeten Spieler gehoert.
 * Ohne diese Pruefung koennte jeder Eingeloggte fremde Charaktere an- und
 * ummelden — und ueber die "ein Charakter pro Spieler pro Raid"-Logik unten
 * sogar fremde Anmeldungen loeschen lassen.
 */
async function assertOwnCharacter(
  characterId: string,
  playerId: string,
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  if (typeof characterId !== "string" || !UUID_RE.test(characterId)) {
    return { ok: false, status: 400, error: "Ungültige Charakter-ID" };
  }
  const char = await db.query.characters.findFirst({
    where: eq(characters.id, characterId),
    columns: { playerId: true },
  });
  if (!char) return { ok: false, status: 404, error: "Charakter nicht gefunden" };
  if (char.playerId !== playerId) {
    return { ok: false, status: 403, error: "Charakter gehört nicht zu deinem Konto" };
  }
  return { ok: true };
}

type RaidRole = "tank" | "heal" | "dps";
type SignupStatus = "yes" | "maybe" | "no";

export async function raidRoutes(app: FastifyInstance) {
  app.get<{ Params: { guildId: string } }>(
    "/guilds/:guildId/raids",
    { onRequest: [app.authenticate] },
    async (request) => {
      return db.query.raidEvents.findMany({
        where: eq(raidEvents.guildId, request.params.guildId),
        orderBy: asc(raidEvents.scheduledAt),
        with: {
          signups: {
            with: { character: { columns: { id: true, name: true, class: true, itemLevel: true } } },
          },
        },
      });
    },
  );

  app.post<{
    Params: { guildId: string };
    Body: { title: string; scheduledAt: string; description?: string; raidType?: string; minIlvl?: number };
  }>("/guilds/:guildId/raids", { onRequest: [requireRole("editor")] }, async (request, reply) => {
    const { title, scheduledAt, description, raidType, minIlvl } = request.body;
    const [raid] = await db
      .insert(raidEvents)
      .values({
        guildId: request.params.guildId,
        title,
        scheduledAt: new Date(scheduledAt),
        ...(description && { description }),
        ...(raidType && { raidType }),
        ...(minIlvl !== undefined && { minIlvl }),
      })
      .returning();
    return reply.status(201).send(raid);
  });

  app.get<{ Params: { id: string } }>("/raids/:id", { onRequest: [app.authenticate] }, async (request, reply) => {
    const raid = await db.query.raidEvents.findFirst({
      where: eq(raidEvents.id, request.params.id),
      with: { signups: { with: { character: true } } },
    });
    if (!raid) return reply.status(404).send({ error: "Raid nicht gefunden" });
    return raid;
  });

  app.patch<{
    Params: { id: string };
    Body: { title?: string; scheduledAt?: string; description?: string | null; raidType?: string | null; minIlvl?: number | null };
  }>("/raids/:id", { onRequest: [requireRole("editor", guildFromRaidParam)] }, async (request, reply) => {
    const { title, scheduledAt, description, raidType, minIlvl } = request.body;
    const updates: Record<string, unknown> = {};
    if (title !== undefined) updates.title = title;
    if (scheduledAt !== undefined) updates.scheduledAt = new Date(scheduledAt);
    if (description !== undefined) updates.description = description ?? null;
    if (raidType !== undefined) updates.raidType = raidType ?? null;
    if (minIlvl !== undefined) updates.minIlvl = minIlvl ?? null;
    if (Object.keys(updates).length === 0)
      return reply.status(400).send({ error: "Keine Änderungen" });
    const [updated] = await db
      .update(raidEvents)
      .set(updates)
      .where(eq(raidEvents.id, request.params.id))
      .returning();
    if (!updated) return reply.status(404).send({ error: "Raid nicht gefunden" });
    return updated;
  });

  app.post<{
    Params: { id: string };
    Body: { characterId: string; role: RaidRole; status?: SignupStatus };
  }>("/raids/:id/signup", { onRequest: [app.authenticate] }, async (request, reply) => {
    const { characterId, role, status = "yes" } = request.body;

    const owned = await assertOwnCharacter(characterId, request.user.sub);
    if (!owned.ok) return reply.status(owned.status).send({ error: owned.error });

    // Ein Charakter pro Spieler pro Raid: vorhandene Anmeldungen desselben
    // Spielers entfernen. Der Besitzer steht durch assertOwnCharacter fest.
    const playerChars = await db.query.characters.findMany({
      where: eq(characters.playerId, request.user.sub),
      columns: { id: true },
    });
    const otherIds = playerChars.map((c) => c.id).filter((id) => id !== characterId);
    if (otherIds.length > 0) {
      await db.delete(raidSignups).where(
        and(
          eq(raidSignups.raidEventId, request.params.id),
          inArray(raidSignups.characterId, otherIds),
        ),
      );
    }

    const [signup] = await db
      .insert(raidSignups)
      .values({ raidEventId: request.params.id, characterId, role, status })
      .onConflictDoUpdate({
        target: [raidSignups.raidEventId, raidSignups.characterId],
        set: { role, status },
      })
      .returning();

    // WebSocket: Raid-Signup-Event an alle Clients dieser Gilde senden
    const raid = await db.query.raidEvents.findFirst({
      where: eq(raidEvents.id, request.params.id),
      columns: { guildId: true },
    });
    if (raid) {
      app.io.to(`guild:${raid.guildId}`).emit("raid_signup", {
        raidId: request.params.id,
        characterId,
        role,
        status: signup.status,
      });
    }

    return reply.status(201).send(signup);
  });

  app.patch<{
    Params: { id: string };
    Body: { characterId: string; status: SignupStatus };
  }>("/raids/:id/signup", { onRequest: [app.authenticate] }, async (request, reply) => {
    const { characterId, status } = request.body;

    const owned = await assertOwnCharacter(characterId, request.user.sub);
    if (!owned.ok) return reply.status(owned.status).send({ error: owned.error });

    const [updated] = await db
      .update(raidSignups)
      .set({ status })
      .where(
        and(
          eq(raidSignups.raidEventId, request.params.id),
          eq(raidSignups.characterId, characterId),
        ),
      )
      .returning();
    if (!updated) return reply.status(404).send({ error: "Signup nicht gefunden" });
    return updated;
  });
}
