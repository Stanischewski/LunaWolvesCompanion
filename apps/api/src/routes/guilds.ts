import type { FastifyInstance } from "fastify";
import { db } from "../db/index.js";
import { guilds } from "../db/schema.js";
import { eq } from "drizzle-orm";

export async function guildRoutes(app: FastifyInstance) {
  app.get("/guilds", async () => {
    return db.query.guilds.findMany();
  });

  app.post<{
    Body: { name: string; realm: string; faction: "alliance" | "horde" };
  }>("/guilds", { onRequest: [app.authenticate] }, async (request, reply) => {
    const [guild] = await db.insert(guilds).values(request.body).returning();
    return reply.status(201).send(guild);
  });

  app.get<{ Params: { id: string } }>("/guilds/:id", async (request, reply) => {
    const guild = await db.query.guilds.findFirst({
      where: eq(guilds.id, request.params.id),
    });
    if (!guild) return reply.status(404).send({ error: "Gilde nicht gefunden" });
    return guild;
  });

  app.get<{ Params: { id: string } }>("/guilds/:id/members", async (request, reply) => {
    const guild = await db.query.guilds.findFirst({
      where: eq(guilds.id, request.params.id),
      with: { characters: { with: { player: true } } },
    });
    if (!guild) return reply.status(404).send({ error: "Gilde nicht gefunden" });
    return guild.characters;
  });
}
