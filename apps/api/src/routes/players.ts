import type { FastifyInstance } from "fastify";
import { db } from "../db/index.js";
import { players } from "../db/schema.js";
import { eq } from "drizzle-orm";

export async function playerRoutes(app: FastifyInstance) {
  app.get("/players/me", { onRequest: [app.authenticate] }, async (request, reply) => {
    const player = await db.query.players.findFirst({
      where: eq(players.id, request.user.sub),
      with: { characters: { with: { guild: true } } },
    });
    if (!player) return reply.status(404).send({ error: "Player nicht gefunden" });
    return player;
  });
}
