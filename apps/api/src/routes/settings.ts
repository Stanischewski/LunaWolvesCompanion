import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { guildSettings } from "../db/schema.js";
import { requireRole } from "../lib/permissions.js";

interface SettingsBody {
  raidChannelId?: string | null;
  dkpChannelId?: string | null;
  adminRoleIds?: string[];
  editorRoleIds?: string[];
}

export async function settingsRoutes(app: FastifyInstance) {
  app.get<{ Params: { guildId: string } }>(
    "/guilds/:guildId/settings",
    { onRequest: [requireRole("admin")] },
    async (request) => {
      const { guildId } = request.params;
      const settings = await db.query.guildSettings.findFirst({
        where: eq(guildSettings.guildId, guildId),
      });
      return settings ?? { guildId, raidChannelId: null, dkpChannelId: null, adminRoleIds: [], editorRoleIds: [] };
    },
  );

  app.put<{ Params: { guildId: string }; Body: SettingsBody }>(
    "/guilds/:guildId/settings",
    { onRequest: [requireRole("admin")] },
    async (request) => {
      const { guildId } = request.params;
      const { raidChannelId, dkpChannelId, adminRoleIds, editorRoleIds } = request.body;

      const existing = await db.query.guildSettings.findFirst({
        where: eq(guildSettings.guildId, guildId),
      });

      if (existing) {
        const [updated] = await db
          .update(guildSettings)
          .set({
            ...(raidChannelId !== undefined && { raidChannelId }),
            ...(dkpChannelId !== undefined && { dkpChannelId }),
            ...(adminRoleIds !== undefined && { adminRoleIds }),
            ...(editorRoleIds !== undefined && { editorRoleIds }),
            updatedAt: new Date(),
          })
          .where(eq(guildSettings.guildId, guildId))
          .returning();
        return updated;
      }

      const [created] = await db
        .insert(guildSettings)
        .values({
          guildId,
          raidChannelId: raidChannelId ?? null,
          dkpChannelId: dkpChannelId ?? null,
          adminRoleIds: adminRoleIds ?? [],
          editorRoleIds: editorRoleIds ?? [],
        })
        .returning();
      return created;
    },
  );
}
