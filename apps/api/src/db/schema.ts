import {
  pgTable,
  pgEnum,
  uuid,
  varchar,
  integer,
  timestamp,
  jsonb,
  primaryKey,
} from "drizzle-orm/pg-core";

export const factionEnum = pgEnum("faction", ["alliance", "horde"]);

export const wowClassEnum = pgEnum("wow_class", [
  "warrior", "paladin", "hunter", "rogue", "priest", "shaman",
  "mage", "warlock", "monk", "druid", "demon_hunter", "death_knight", "evoker",
]);

export const raidRoleEnum = pgEnum("raid_role", ["tank", "heal", "dps"]);

export const signupStatusEnum = pgEnum("signup_status", ["yes", "maybe", "no"]);

export const activitySourceEnum = pgEnum("activity_source", ["addon", "api"]);

export const players = pgTable("players", {
  id: uuid("id").primaryKey().defaultRandom(),
  bnetId: varchar("bnet_id", { length: 64 }).notNull().unique(),
  bnetTag: varchar("bnet_tag", { length: 64 }).notNull(),
  discordId: varchar("discord_id", { length: 32 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const guilds = pgTable("guilds", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 128 }).notNull(),
  realm: varchar("realm", { length: 64 }).notNull(),
  faction: factionEnum("faction").notNull(),
  memberCount: integer("member_count").notNull().default(0),
});

export const characters = pgTable("characters", {
  id: uuid("id").primaryKey().defaultRandom(),
  playerId: uuid("player_id")
    .notNull()
    .references(() => players.id, { onDelete: "cascade" }),
  guildId: uuid("guild_id")
    .notNull()
    .references(() => guilds.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 64 }).notNull(),
  realm: varchar("realm", { length: 64 }).notNull(),
  class: wowClassEnum("class").notNull(),
  level: integer("level").notNull().default(1),
  itemLevel: integer("item_level").notNull().default(0),
  mPlusScore: integer("m_plus_score").notNull().default(0),
  lastLogin: timestamp("last_login", { withTimezone: true }),
  guildRank: integer("guild_rank").notNull().default(0),
});

export const activityLogs = pgTable("activity_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  characterId: uuid("character_id")
    .notNull()
    .references(() => characters.id, { onDelete: "cascade" }),
  eventType: varchar("event_type", { length: 64 }).notNull(),
  eventData: jsonb("event_data"),
  recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
  source: activitySourceEnum("source").notNull(),
});

export const addonSnapshots = pgTable("addon_snapshots", {
  id: uuid("id").primaryKey().defaultRandom(),
  guildId: uuid("guild_id")
    .notNull()
    .references(() => guilds.id, { onDelete: "cascade" }),
  uploadedBy: uuid("uploaded_by")
    .notNull()
    .references(() => players.id),
  rawData: jsonb("raw_data").notNull(),
  uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull().defaultNow(),
});

export const raidEvents = pgTable("raid_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  guildId: uuid("guild_id")
    .notNull()
    .references(() => guilds.id, { onDelete: "cascade" }),
  title: varchar("title", { length: 128 }).notNull(),
  scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull(),
  raidType: varchar("raid_type", { length: 64 }),
  minIlvl: integer("min_ilvl"),
});

export const raidSignups = pgTable(
  "raid_signups",
  {
    raidEventId: uuid("raid_event_id")
      .notNull()
      .references(() => raidEvents.id, { onDelete: "cascade" }),
    characterId: uuid("character_id")
      .notNull()
      .references(() => characters.id, { onDelete: "cascade" }),
    role: raidRoleEnum("role").notNull(),
    status: signupStatusEnum("status").notNull().default("yes"),
  },
  (t) => [primaryKey({ columns: [t.raidEventId, t.characterId] })],
);
