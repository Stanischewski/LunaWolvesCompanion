import type { FastifyInstance } from "fastify";
import { db } from "../db/index.js";
import { raidEvents, raidSignups } from "../db/schema.js";
import { eq, and, asc } from "drizzle-orm";

type RaidRole = "tank" | "heal" | "dps";
type SignupStatus = "yes" | "maybe" | "no";

export async function raidRoutes(app: FastifyInstance) {
  app.get<{ Params: { guildId: string } }>(
    "/guilds/:guildId/raids",
    async (request) => {
      return db.query.raidEvents.findMany({
        where: eq(raidEvents.guildId, request.params.guildId),
        orderBy: asc(raidEvents.scheduledAt),
      });
    },
  );

  app.post<{
    Params: { guildId: string };
    Body: { title: string; scheduledAt: string; raidType?: string; minIlvl?: number };
  }>("/guilds/:guildId/raids", { onRequest: [app.authenticate] }, async (request, reply) => {
    const { title, scheduledAt, raidType, minIlvl } = request.body;
    const [raid] = await db
      .insert(raidEvents)
      .values({
        guildId: request.params.guildId,
        title,
        scheduledAt: new Date(scheduledAt),
        ...(raidType && { raidType }),
        ...(minIlvl !== undefined && { minIlvl }),
      })
      .returning();
    return reply.status(201).send(raid);
  });

  app.get<{ Params: { id: string } }>("/raids/:id", async (request, reply) => {
    const raid = await db.query.raidEvents.findFirst({
      where: eq(raidEvents.id, request.params.id),
      with: { signups: { with: { character: true } } },
    });
    if (!raid) return reply.status(404).send({ error: "Raid nicht gefunden" });
    return raid;
  });

  app.post<{
    Params: { id: string };
    Body: { characterId: string; role: RaidRole; status?: SignupStatus };
  }>("/raids/:id/signup", { onRequest: [app.authenticate] }, async (request, reply) => {
    const { characterId, role, status = "yes" } = request.body;
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
