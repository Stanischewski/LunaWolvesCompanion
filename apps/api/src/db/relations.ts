import { relations } from "drizzle-orm";
import {
  players,
  guilds,
  characters,
  activityLogs,
  addonSnapshots,
  raidEvents,
  raidSignups,
  dkpEntries,
  dkpStandings,
  dkpTombstones,
  dkpSeasons,
} from "./schema.js";

export const playersRelations = relations(players, ({ many }) => ({
  characters: many(characters),
  addonSnapshots: many(addonSnapshots),
}));

export const guildsRelations = relations(guilds, ({ many }) => ({
  characters: many(characters),
  raidEvents: many(raidEvents),
  addonSnapshots: many(addonSnapshots),
  dkpEntries: many(dkpEntries),
  dkpStandings: many(dkpStandings),
  dkpTombstones: many(dkpTombstones),
  dkpSeasons: many(dkpSeasons),
}));

export const charactersRelations = relations(characters, ({ one, many }) => ({
  player: one(players, { fields: [characters.playerId], references: [players.id] }),
  guild: one(guilds, { fields: [characters.guildId], references: [guilds.id] }),
  activityLogs: many(activityLogs),
  raidSignups: many(raidSignups),
}));

export const activityLogsRelations = relations(activityLogs, ({ one }) => ({
  character: one(characters, { fields: [activityLogs.characterId], references: [characters.id] }),
}));

export const addonSnapshotsRelations = relations(addonSnapshots, ({ one }) => ({
  guild: one(guilds, { fields: [addonSnapshots.guildId], references: [guilds.id] }),
  uploadedBy: one(players, { fields: [addonSnapshots.uploadedBy], references: [players.id] }),
}));

export const raidEventsRelations = relations(raidEvents, ({ one, many }) => ({
  guild: one(guilds, { fields: [raidEvents.guildId], references: [guilds.id] }),
  signups: many(raidSignups),
}));

export const raidSignupsRelations = relations(raidSignups, ({ one }) => ({
  raidEvent: one(raidEvents, { fields: [raidSignups.raidEventId], references: [raidEvents.id] }),
  character: one(characters, { fields: [raidSignups.characterId], references: [characters.id] }),
}));

export const dkpEntriesRelations = relations(dkpEntries, ({ one }) => ({
  guild: one(guilds, { fields: [dkpEntries.guildId], references: [guilds.id] }),
}));

export const dkpStandingsRelations = relations(dkpStandings, ({ one }) => ({
  guild: one(guilds, { fields: [dkpStandings.guildId], references: [guilds.id] }),
}));

export const dkpTombstonesRelations = relations(dkpTombstones, ({ one }) => ({
  guild: one(guilds, { fields: [dkpTombstones.guildId], references: [guilds.id] }),
}));

export const dkpSeasonsRelations = relations(dkpSeasons, ({ one }) => ({
  guild: one(guilds, { fields: [dkpSeasons.guildId], references: [guilds.id] }),
}));
