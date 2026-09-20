import type { FastifyInstance } from "fastify";
import { eq, and, desc, sql, gt } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db } from "../db/index.js";
import { characters, dkpEntries, dkpStandings, dkpTombstones, dkpSeasons } from "../db/schema.js";
import { requireRole } from "../lib/permissions.js";
import { resolveOfficerName } from "../lib/auth.js";
import { getSeasonStart } from "../lib/dkpSeason.js";

export async function dkpRoutes(app: FastifyInstance) {
  // ── READ ──────────────────────────────────────────────────────────────────

  app.get<{ Params: { guildId: string } }>(
    "/guilds/:guildId/dkp/standings",
    { onRequest: [app.authenticate] },
    async (request) => {
      return db.query.dkpStandings.findMany({
        where: eq(dkpStandings.guildId, request.params.guildId),
        orderBy: [desc(dkpStandings.current)],
      });
    },
  );

  app.get<{ Params: { guildId: string; playerName: string } }>(
    "/guilds/:guildId/dkp/standings/:playerName",
    { onRequest: [app.authenticate] },
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
    Querystring: { player?: string; type?: string; limit?: string; offset?: string; allSeasons?: string };
  }>(
    "/guilds/:guildId/dkp/history",
    { onRequest: [app.authenticate] },
    async (request) => {
      const { player, type, limit: limitStr, offset: offsetStr, allSeasons } = request.query;
      const limit = Math.min(Math.max(Number(limitStr) || 50, 1), 200);
      const offset = Math.max(Number(offsetStr) || 0, 0);

      // Standardmäßig die laufende Saison — sonst stünden nach einem Reset
      // Einträge in der Liste, die in den Standings nicht mehr zählen.
      // ?allSeasons=1 liefert weiterhin alles.
      const seasonStart =
        allSeasons === "1" ? null : await getSeasonStart(db, request.params.guildId);

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
            seasonStart ? gt(dkpEntries.occurredAt, seasonStart) : undefined,
          ),
        )
        .orderBy(desc(dkpEntries.occurredAt))
        .limit(limit)
        .offset(offset);
    },
  );

  app.get<{ Params: { guildId: string } }>(
    "/guilds/:guildId/dkp/seasons",
    { onRequest: [app.authenticate] },
    async (request) => {
      return db
        .select({
          id: dkpSeasons.id,
          name: dkpSeasons.name,
          archivedBy: dkpSeasons.archivedBy,
          startedAt: dkpSeasons.startedAt,
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
    Body: {
      playerName: string;
      amount: number;
      reason?: string;
      entryType?: "manual" | "boss" | "correction";
      officerName?: string;
    };
  }>(
    "/guilds/:guildId/dkp/award",
    { onRequest: [requireRole("editor")] },
    async (request, reply) => {
      const { playerName, amount, reason = "Manuell", entryType = "manual" } = request.body;
      if (!playerName || !(amount > 0)) {
        return reply.status(400).send({ error: "playerName und amount (> 0) erforderlich" });
      }

      const knownChar = await db.query.characters.findFirst({
        where: and(eq(characters.guildId, request.params.guildId), eq(characters.name, playerName)),
        columns: { id: true },
      });
      if (!knownChar) {
        return reply.status(400).send({ error: `Charakter '${playerName}' nicht bekannt — bitte zuerst mit dem Addon synchronisieren.` });
      }

      const delta = Math.round(amount);
      const officerName = resolveOfficerName(request, request.body?.officerName);

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
    Body: { playerName: string; amount: number; reason?: string; officerName?: string };
  }>(
    "/guilds/:guildId/dkp/spend",
    { onRequest: [requireRole("editor")] },
    async (request, reply) => {
      const { playerName, amount, reason = "Ausgabe" } = request.body;
      if (!playerName || !(amount > 0)) {
        return reply.status(400).send({ error: "playerName und amount (> 0) erforderlich" });
      }

      const knownChar = await db.query.characters.findFirst({
        where: and(eq(characters.guildId, request.params.guildId), eq(characters.name, playerName)),
        columns: { id: true },
      });
      if (!knownChar) {
        return reply.status(400).send({ error: `Charakter '${playerName}' nicht bekannt — bitte zuerst mit dem Addon synchronisieren.` });
      }

      const delta = -Math.round(amount);
      const officerName = resolveOfficerName(request, request.body?.officerName);

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
    Body: { playerName: string; amount: number; reason?: string; officerName?: string };
  }>(
    "/guilds/:guildId/dkp/adjust",
    { onRequest: [requireRole("editor")] },
    async (request, reply) => {
      const { playerName, amount, reason = "Korrektur" } = request.body;
      if (!playerName || amount === undefined || amount === 0) {
        return reply.status(400).send({ error: "playerName und amount (ungleich 0) erforderlich" });
      }

      const knownChar = await db.query.characters.findFirst({
        where: and(eq(characters.guildId, request.params.guildId), eq(characters.name, playerName)),
        columns: { id: true },
      });
      if (!knownChar) {
        return reply.status(400).send({ error: `Charakter '${playerName}' nicht bekannt — bitte zuerst mit dem Addon synchronisieren.` });
      }

      const delta = Math.round(amount);
      const officerName = resolveOfficerName(request, request.body?.officerName);

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

  app.delete<{
    Params: { guildId: string; playerName: string };
    Body: { officerName?: string } | undefined;
  }>(
    "/guilds/:guildId/dkp/players/:playerName",
    { onRequest: [requireRole("admin")] },
    async (request, reply) => {
      const { guildId, playerName } = request.params;
      const officerName = resolveOfficerName(request, request.body?.officerName);
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
    Body: { seasonName?: string; officerName?: string };
  }>(
    "/guilds/:guildId/dkp/reset",
    { onRequest: [requireRole("admin")] },
    async (request, reply) => {
      const { guildId } = request.params;
      const seasonName =
        request.body?.seasonName ?? `Saison-${new Date().toISOString().slice(0, 10)}`;
      const officerName = resolveOfficerName(request, request.body?.officerName);
      const now = new Date();

      await db.transaction(async (tx) => {
        // Snapshot der aktuellen Standings als JSONB archivieren
        const snapshot = await tx.query.dkpStandings.findMany({
          where: eq(dkpStandings.guildId, guildId),
        });

        const previousStart = await getSeasonStart(tx, guildId);

        // `archivedAt` ist zugleich die Epoche der Folgesaison: ab hier
        // zählen die Einträge. Ohne diese Grenze summierte der nächste
        // Addon-Sync wieder über *alle* Einträge und holte den kompletten
        // Vor-Reset-Stand zurück, sobald ein Spieler einen neuen Eintrag bekam.
        await tx.insert(dkpSeasons).values({
          guildId,
          name: seasonName,
          archivedBy: officerName,
          startedAt: previousStart.getTime() === 0 ? null : previousStart,
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

      return reply.status(201).send({
        seasonName,
        resetAt: now,
        // Epoche für das Addon: Einträge davor zählen nicht mehr.
        seasonEpoch: Math.floor(now.getTime() / 1000),
      });
    },
  );
}
