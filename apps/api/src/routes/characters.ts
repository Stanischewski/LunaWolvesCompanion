import type { FastifyInstance } from "fastify";
import { db } from "../db/index.js";
import { characters } from "../db/schema.js";
import { eq, and } from "drizzle-orm";
import { requireRole } from "../lib/permissions.js";
import { requirePlayerAccount } from "../lib/auth.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const WOW_CLASSES = [
  "warrior", "paladin", "hunter", "rogue", "priest", "shaman",
  "mage", "warlock", "monk", "druid", "demon_hunter", "death_knight", "evoker",
] as const;

type WowClass = (typeof WOW_CLASSES)[number];

export async function characterRoutes(app: FastifyInstance) {
  app.get<{ Params: { id: string } }>(
    "/characters/:id",
    { onRequest: [app.authenticate] },
    async (request, reply) => {
      if (!UUID_RE.test(request.params.id)) {
        return reply.status(400).send({ error: "Ungültige ID" });
      }
      const char = await db.query.characters.findFirst({
        where: eq(characters.id, request.params.id),
        with: {
          guild: true,
          equipment: true,
        },
      });
      if (!char) return reply.status(404).send({ error: "Charakter nicht gefunden" });
      return char;
    },
  );

  app.get("/characters", { onRequest: [app.authenticate] }, async (request) => {
    return db.query.characters.findMany({
      where: eq(characters.playerId, request.user.sub),
      with: { guild: true },
    });
  });

  // Charaktere entstehen im Normalfall beim Addon-Sync und werden ueber den
  // BattleTag automatisch verknuepft (routes/sync.ts). Das manuelle Anlegen ist
  // der Sonderfall und Admins vorbehalten: Der Charaktername ist die einzige
  // Plausibilitaetspruefung der DKP-Vergabe, ein frei waehlbarer Name haette
  // sie ausgehebelt.
  app.post<{
    Body: {
      name?: unknown;
      realm?: unknown;
      class?: unknown;
      guildId?: unknown;
      level?: unknown;
      itemLevel?: unknown;
    };
  }>("/characters", { onRequest: [requireRole("admin")] }, async (request, reply) => {
    const { name, realm, class: wowClass, guildId, level, itemLevel } = request.body ?? {};

    if (typeof name !== "string" || !name.trim()) {
      return reply.status(400).send({ error: "name erforderlich" });
    }
    if (typeof realm !== "string" || !realm.trim()) {
      return reply.status(400).send({ error: "realm erforderlich" });
    }
    if (typeof guildId !== "string" || !UUID_RE.test(guildId)) {
      return reply.status(400).send({ error: "guildId muss eine gültige UUID sein" });
    }
    if (typeof wowClass !== "string" || !WOW_CLASSES.includes(wowClass as WowClass)) {
      return reply.status(400).send({ error: "class ist ungültig" });
    }

    const [character] = await db
      .insert(characters)
      .values({
        guildId,
        name: name.trim().slice(0, 64),
        realm: realm.trim().slice(0, 64),
        class: wowClass as WowClass,
        ...(typeof level === "number" && { level }),
        ...(typeof itemLevel === "number" && { itemLevel }),
      })
      .returning();
    return reply.status(201).send(character);
  });

  // Feldweise Uebernahme: `.set(request.body)` liess zuvor beliebige Spalten
  // setzen, darunter guildId, name und playerId.
  app.patch<{
    Params: { id: string };
    Body: { level?: unknown; itemLevel?: unknown; mPlusScore?: unknown; guildRank?: unknown };
  }>(
    "/characters/:id",
    { onRequest: [app.authenticate, requirePlayerAccount] },
    async (request, reply) => {
      if (!UUID_RE.test(request.params.id)) {
        return reply.status(400).send({ error: "Ungültige ID" });
      }

      const { level, itemLevel, mPlusScore, guildRank } = request.body ?? {};
      const updates: Partial<typeof characters.$inferInsert> = {};
      if (typeof level === "number") updates.level = level;
      if (typeof itemLevel === "number") updates.itemLevel = itemLevel;
      if (typeof mPlusScore === "number") updates.mPlusScore = mPlusScore;
      if (typeof guildRank === "number") updates.guildRank = guildRank;

      if (Object.keys(updates).length === 0) {
        return reply.status(400).send({ error: "Keine gültigen Felder" });
      }

      const [updated] = await db
        .update(characters)
        .set(updates)
        .where(
          and(
            eq(characters.id, request.params.id),
            eq(characters.playerId, request.user.sub),
          ),
        )
        .returning();
      if (!updated) return reply.status(404).send({ error: "Character nicht gefunden" });
      return updated;
    },
  );
}
