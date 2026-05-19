import type { FastifyInstance } from "fastify";
import { db } from "../db/index.js";
import { characters } from "../db/schema.js";
import { eq, and } from "drizzle-orm";

type WowClass =
  | "warrior" | "paladin" | "hunter" | "rogue" | "priest" | "shaman"
  | "mage" | "warlock" | "monk" | "druid" | "demon_hunter" | "death_knight" | "evoker";

export async function characterRoutes(app: FastifyInstance) {
  app.get<{ Params: { id: string } }>("/characters/:id", async (request, reply) => {
    const char = await db.query.characters.findFirst({
      where: eq(characters.id, request.params.id),
      with: {
        guild: true,
        equipment: true,
      },
    });
    if (!char) return reply.status(404).send({ error: "Charakter nicht gefunden" });
    return char;
  });

  app.get("/characters", { onRequest: [app.authenticate] }, async (request) => {
    return db.query.characters.findMany({
      where: eq(characters.playerId, request.user.sub),
      with: { guild: true },
    });
  });

  app.post<{
    Body: {
      name: string;
      realm: string;
      class: WowClass;
      guildId: string;
      level?: number;
      itemLevel?: number;
    };
  }>("/characters", { onRequest: [app.authenticate] }, async (request, reply) => {
    const { name, realm, class: wowClass, guildId, level, itemLevel } = request.body;
    const [character] = await db
      .insert(characters)
      .values({
        playerId: request.user.sub,
        guildId,
        name,
        realm,
        class: wowClass,
        ...(level !== undefined && { level }),
        ...(itemLevel !== undefined && { itemLevel }),
      })
      .returning();
    return reply.status(201).send(character);
  });

  app.patch<{
    Params: { id: string };
    Body: { level?: number; itemLevel?: number; mPlusScore?: number; guildRank?: number };
  }>("/characters/:id", { onRequest: [app.authenticate] }, async (request, reply) => {
    const [updated] = await db
      .update(characters)
      .set(request.body)
      .where(
        and(
          eq(characters.id, request.params.id),
          eq(characters.playerId, request.user.sub)
        )
      )
      .returning();
    if (!updated) return reply.status(404).send({ error: "Character nicht gefunden" });
    return updated;
  });
}
