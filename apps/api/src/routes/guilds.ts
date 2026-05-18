import type { FastifyInstance } from "fastify";
import { db } from "../db/index.js";
import { guilds, characters, activityLogs, players } from "../db/schema.js";
import { eq, and, gt, gte, count, sql } from "drizzle-orm";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
    if (!UUID_RE.test(request.params.id)) return reply.status(400).send({ error: "Ungültige ID" });
    const guild = await db.query.guilds.findFirst({
      where: eq(guilds.id, request.params.id),
    });
    if (!guild) return reply.status(404).send({ error: "Gilde nicht gefunden" });
    return guild;
  });

  app.get<{ Params: { id: string } }>("/guilds/:id/members", async (request, reply) => {
    if (!UUID_RE.test(request.params.id)) return reply.status(400).send({ error: "Ungültige ID" });
    const guild = await db.query.guilds.findFirst({
      where: eq(guilds.id, request.params.id),
    });
    if (!guild) return reply.status(404).send({ error: "Gilde nicht gefunden" });

    const rows = await db
      .select({
        id: characters.id,
        name: characters.name,
        class: characters.class,
        level: characters.level,
        itemLevel: characters.itemLevel,
        mPlusScore: characters.mPlusScore,
        guildRank: characters.guildRank,
        lastLogin: characters.lastLogin,
        bnetTag: players.bnetTag,
      })
      .from(characters)
      .leftJoin(players, eq(characters.playerId, players.id))
      .where(eq(characters.guildId, request.params.id));

    return rows.map((r) => ({
      ...r,
      player: r.bnetTag ? { bnetTag: r.bnetTag } : null,
      bnetTag: undefined,
    }));
  });

  app.get<{ Params: { id: string } }>("/guilds/:id/stats", async (request, reply) => {
    const guildId = request.params.id;
    if (!UUID_RE.test(guildId)) return reply.status(400).send({ error: "Ungültige ID" });
    const guild = await db.query.guilds.findFirst({ where: eq(guilds.id, guildId) });
    if (!guild) return reply.status(404).send({ error: "Gilde nicht gefunden" });

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const [totals] = await db
      .select({
        totalMembers: count(),
        avgItemLevel: sql<number>`COALESCE(ROUND(AVG(${characters.itemLevel}::numeric), 0), 0)`,
      })
      .from(characters)
      .where(eq(characters.guildId, guildId));

    const activityByDay = await db
      .select({
        day: sql<string>`DATE(${activityLogs.recordedAt})`,
        events: count(),
      })
      .from(activityLogs)
      .innerJoin(characters, eq(activityLogs.characterId, characters.id))
      .where(and(eq(characters.guildId, guildId), gte(activityLogs.recordedAt, sevenDaysAgo)))
      .groupBy(sql`DATE(${activityLogs.recordedAt})`)
      .orderBy(sql`DATE(${activityLogs.recordedAt})`);

    const ilvlDistribution = await db
      .select({
        bucket: sql<number>`(${characters.itemLevel} / 10) * 10`,
        count: count(),
      })
      .from(characters)
      .where(and(eq(characters.guildId, guildId), gt(characters.itemLevel, 0)))
      .groupBy(sql`(${characters.itemLevel} / 10) * 10`)
      .orderBy(sql`(${characters.itemLevel} / 10) * 10`);

    // Active members: distinct characters with activity in last 7 days
    const activeSub = db
      .selectDistinct({ id: activityLogs.characterId })
      .from(activityLogs)
      .innerJoin(characters, eq(activityLogs.characterId, characters.id))
      .where(and(eq(characters.guildId, guildId), gte(activityLogs.recordedAt, sevenDaysAgo)))
      .as("active_sub");

    const [{ activeMembers7d }] = await db
      .select({ activeMembers7d: count() })
      .from(activeSub);

    return {
      totalMembers: totals?.totalMembers ?? 0,
      avgItemLevel: Number(totals?.avgItemLevel ?? 0),
      activeMembers7d,
      activityByDay,
      ilvlDistribution,
    };
  });
}
