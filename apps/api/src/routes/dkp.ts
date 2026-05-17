import type { FastifyInstance } from "fastify";
import { eq, and, desc, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db } from "../db/index.js";
import { dkpEntries, dkpStandings, dkpTombstones, dkpSeasons } from "../db/schema.js";

export async function dkpRoutes(app: FastifyInstance) {
  // ── READ ──────────────────────────────────────────────────────────────────

  app.get<{ Params: { guildId: string } }>(
    "/guilds/:guildId/dkp/standings",
    async (request) => {
      return db.query.dkpStandings.findMany({
        where: eq(dkpStandings.guildId, request.params.guildId),
        orderBy: [desc(dkpStandings.current)],
      });
    },
  );

  app.get<{ Params: { guildId: string; playerName: string } }>(
    "/guilds/:guildId/dkp/standings/:playerName",
    async (request, reply) => {
      const standing = await db.query.dkpStandings.findFirst({
        where: and(
          eq(dkpStandings.guildId, request.params.guildId),
          eq(dkpStandings.playerName, request.params.playerName),
        ),
      });
      if (!standing) return reply.status(404).send({ error: "Spieler nicht gefunden" });
      return standing;
    },
  );

  app.get<{
    Params: { guildId: string };
    Querystring: { player?: string; type?: string; limit?: string; offset?: string };
  }>(
    "/guilds/:guildId/dkp/history",
    async (request) => {
      const { player, type, limit: limitStr, offset: offsetStr } = request.query;
      const limit = Math.min(Math.max(Number(limitStr) || 50, 1), 200);
      const offset = Math.max(Number(offsetStr) || 0, 0);

      return db
        .select()
        .from(dkpEntries)
        .where(
          and(
            eq(dkpEntries.guildId, request.params.guildId),
            player ? eq(dkpEntries.playerName, player) : undefined,
            type
              ? eq(dkpEntries.entryType, type as "manual" | "boss" | "spend" | "correction")
              : undefined,
          ),
        )
        .orderBy(desc(dkpEntries.occurredAt))
        .limit(limit)
        .offset(offset);
    },
  );

  app.get<{ Params: { guildId: string } }>(
    "/guilds/:guildId/dkp/seasons",
    async (request) => {
      return db
        .select({
          id: dkpSeasons.id,
          name: dkpSeasons.name,
          archivedBy: dkpSeasons.archivedBy,
          archivedAt: dkpSeasons.archivedAt,
        })
        .from(dkpSeasons)
        .where(eq(dkpSeasons.guildId, request.params.guildId))
        .orderBy(desc(dkpSeasons.archivedAt));
    },
  );

  // ── WRITE ─────────────────────────────────────────────────────────────────

  app.post<{
    Params: { guildId: string };
    Body: { playerName: string; amount: number; reason?: string; entryType?: "manual" | "boss" | "correction" };
  }>(
    "/guilds/:guildId/dkp/award",
    { onRequest: [app.authenticate] },
    async (request, reply) => {
      const { playerName, amount, reason = "Manuell", entryType = "manual" } = request.body;
      if (!playerName || !(amount > 0)) {
        return reply.status(400).send({ error: "playerName und amount (> 0) erforderlich" });
      }

      const delta = Math.round(amount);
      const officerName: string = (request.user as { bnetTag: string }).bnetTag;

      const result = await db.transaction(async (tx) => {
        const [entry] = await tx
          .insert(dkpEntries)
          .values({
            guildId: request.params.guildId,
            addonEntryId: `web-${randomUUID()}`,
            playerName,
            delta,
            reason,
            entryType,
            officerName,
            occurredAt: new Date(),
            source: "web",
          })
          .returning();

        await tx
          .insert(dkpStandings)
          .values({ guildId: request.params.guildId, playerName, current: delta, lifetime: delta })
          .onConflictDoUpdate({
            target: [dkpStandings.guildId, dkpStandings.playerName],
            set: {
              current: sql`${dkpStandings.current} + ${delta}`,
              lifetime: sql`${dkpStandings.lifetime} + ${delta}`,
              updatedAt: new Date(),
            },
          });

        return entry;
      });

      app.io.to(`guild:${request.params.guildId}`).emit("dkp_update", {
        guildId: request.params.guildId,
        playerName,
        delta,
        type: entryType,
      });

      return reply.status(201).send(result);
    },
  );

  app.post<{
    Params: { guildId: string };
    Body: { playerName: string; amount: number; reason?: string };
  }>(
    "/guilds/:guildId/dkp/spend",
    { onRequest: [app.authenticate] },
    async (request, reply) => {
      const { playerName, amount, reason = "Ausgabe" } = request.body;
      if (!playerName || !(amount > 0)) {
        return reply.status(400).send({ error: "playerName und amount (> 0) erforderlich" });
      }

      const delta = -Math.round(amount);
      const officerName: string = (request.user as { bnetTag: string }).bnetTag;

      const result = await db.transaction(async (tx) => {
        const [entry] = await tx
          .insert(dkpEntries)
          .values({
            guildId: request.params.guildId,
            addonEntryId: `web-${randomUUID()}`,
            playerName,
            delta,
            reason,
            entryType: "spend",
            officerName,
            occurredAt: new Date(),
            source: "web",
          })
          .returning();

        await tx
          .insert(dkpStandings)
          .values({ guildId: request.params.guildId, playerName, current: delta, lifetime: 0 })
          .onConflictDoUpdate({
            target: [dkpStandings.guildId, dkpStandings.playerName],
            set: {
              current: sql`${dkpStandings.current} + ${delta}`,
              updatedAt: new Date(),
            },
          });

        return entry;
      });

      app.io.to(`guild:${request.params.guildId}`).emit("dkp_update", {
        guildId: request.params.guildId,
        playerName,
        delta,
        type: "spend",
      });

      return reply.status(201).send(result);
    },
  );

  app.post<{
    Params: { guildId: string };
    Body: { playerName: string; amount: number; reason?: string };
  }>(
    "/guilds/:guildId/dkp/adjust",
    { onRequest: [app.authenticate] },
    async (request, reply) => {
      const { playerName, amount, reason = "Korrektur" } = request.body;
      if (!playerName || amount === undefined || amount === 0) {
        return reply.status(400).send({ error: "playerName und amount (ungleich 0) erforderlich" });
      }

      const delta = Math.round(amount);
      const officerName: string = (request.user as { bnetTag: string }).bnetTag;

      const result = await db.transaction(async (tx) => {
        const [entry] = await tx
          .insert(dkpEntries)
          .values({
            guildId: request.params.guildId,
            addonEntryId: `web-${randomUUID()}`,
            playerName,
            delta,
            reason,
            entryType: "correction",
            officerName,
            occurredAt: new Date(),
            source: "web",
          })
          .returning();

        await tx
          .insert(dkpStandings)
          .values({ guildId: request.params.guildId, playerName, current: delta, lifetime: 0 })
          .onConflictDoUpdate({
            target: [dkpStandings.guildId, dkpStandings.playerName],
            set: {
              current: sql`${dkpStandings.current} + ${delta}`,
              updatedAt: new Date(),
            },
          });

        return entry;
      });

      app.io.to(`guild:${request.params.guildId}`).emit("dkp_update", {
        guildId: request.params.guildId,
        playerName,
        delta,
        type: "correction",
      });

      return reply.status(201).send(result);
    },
  );

  app.delete<{ Params: { guildId: string; playerName: string } }>(
    "/guilds/:guildId/dkp/players/:playerName",
    { onRequest: [app.authenticate] },
    async (request, reply) => {
      const { guildId, playerName } = request.params;
      const officerName: string = (request.user as { bnetTag: string }).bnetTag;
      const now = new Date();
      const expiresAt = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);

      await db.transaction(async (tx) => {
        await tx
          .insert(dkpTombstones)
          .values({ guildId, playerName, deletedBy: officerName, deletedAt: now, expiresAt })
          .onConflictDoUpdate({
            target: [dkpTombstones.guildId, dkpTombstones.playerName],
            set: { deletedBy: officerName, deletedAt: now, expiresAt },
          });

        await tx
          .insert(dkpStandings)
          .values({ guildId, playerName, current: 0, lifetime: 0 })
          .onConflictDoUpdate({
            target: [dkpStandings.guildId, dkpStandings.playerName],
            set: { current: 0, lifetime: 0, updatedAt: now },
          });
      });

      app.io.to(`guild:${guildId}`).emit("dkp_update", {
        guildId,
        playerName,
        type: "delete",
      });

      return reply.status(204).send();
    },
  );

  app.post<{
    Params: { guildId: string };
    Body: { seasonName?: string };
  }>(
    "/guilds/:guildId/dkp/reset",
    { onRequest: [app.authenticate] },
    async (request, reply) => {
      const { guildId } = request.params;
      const seasonName =
        request.body?.seasonName ?? `Saison-${new Date().toISOString().slice(0, 10)}`;
      const officerName: string = (request.user as { bnetTag: string }).bnetTag;
      const now = new Date();

      await db.transaction(async (tx) => {
        // Snapshot der aktuellen Standings als JSONB archivieren
        const snapshot = await tx.query.dkpStandings.findMany({
          where: eq(dkpStandings.guildId, guildId),
        });

        await tx.insert(dkpSeasons).values({
          guildId,
          name: seasonName,
          archivedBy: officerName,
          archivedAt: now,
          snapshotData: snapshot,
        });

        // Alle Standings auf 0 zurücksetzen
        await tx
          .update(dkpStandings)
          .set({ current: 0, lifetime: 0, updatedAt: now })
          .where(eq(dkpStandings.guildId, guildId));
      });

      app.io.to(`guild:${guildId}`).emit("dkp_reset", {
        guildId,
        seasonName,
        resetBy: officerName,
      });

      return reply.status(201).send({ seasonName, resetAt: now });
    },
  );
}
