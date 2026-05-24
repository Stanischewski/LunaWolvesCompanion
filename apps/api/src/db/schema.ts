import {
  pgTable,
  pgEnum,
  uuid,
  varchar,
  text,
  integer,
  timestamp,
  jsonb,
  primaryKey,
  unique,
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
  discordTag: varchar("discord_tag", { length: 64 }),
  displayName: varchar("display_name", { length: 64 }),
  bnetAccessToken: text("bnet_access_token"),
  bnetTokenExpiry: timestamp("bnet_token_expiry", { withTimezone: true }),
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
    .references(() => players.id, { onDelete: "set null" }),
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
  description: text("description"),
  scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull(),
  raidType: varchar("raid_type", { length: 64 }),
  minIlvl: integer("min_ilvl"),
  calendarMessageId: varchar("calendar_message_id", { length: 32 }),
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

export const characterEquipment = pgTable(
  "character_equipment",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    characterId: uuid("character_id")
      .notNull()
      .references(() => characters.id, { onDelete: "cascade" }),
    slot: varchar("slot", { length: 32 }).notNull(),
    itemId: integer("item_id").notNull(),
    itemName: varchar("item_name", { length: 256 }),
    itemLevel: integer("item_level").notNull().default(0),
    quality: varchar("quality", { length: 32 }),
    iconUrl: text("icon_url"),
    itemSubclass: varchar("item_subclass", { length: 64 }),
    stats: jsonb("stats").$type<Array<{ name: string; value: number }>>(),
    enchantments: jsonb("enchantments").$type<string[]>(),
    gems: jsonb("gems").$type<Array<{ name: string | null; stat: string | null }>>(),
    setBonus: jsonb("set_bonus").$type<{
      name: string;
      effects: Array<{ count: number; text: string; active: boolean }>;
    }>(),
    syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("char_equipment_slot").on(t.characterId, t.slot)],
);

export const itemIconCache = pgTable("item_icon_cache", {
  itemId: integer("item_id").primaryKey(),
  iconUrl: text("icon_url").notNull(),
  cachedAt: timestamp("cached_at", { withTimezone: true }).notNull().defaultNow(),
});

// === DKP-System ===

export const dkpEntryTypeEnum = pgEnum("dkp_entry_type", [
  "manual",
  "boss",
  "spend",
  "correction",
]);

export const dkpEntries = pgTable(
  "dkp_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    guildId: uuid("guild_id")
      .notNull()
      .references(() => guilds.id, { onDelete: "cascade" }),
    addonEntryId: varchar("addon_entry_id", { length: 128 }).notNull(),
    playerName: varchar("player_name", { length: 64 }).notNull(),
    delta: integer("delta").notNull(),
    reason: varchar("reason", { length: 256 }).notNull().default(""),
    entryType: dkpEntryTypeEnum("entry_type").notNull(),
    officerName: varchar("officer_name", { length: 64 }).notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    source: varchar("source", { length: 16 }).notNull().default("addon"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    addonSyncedAt: timestamp("addon_synced_at", { withTimezone: true }),
  },
  (t) => [unique("dkp_entries_guild_addon_id").on(t.guildId, t.addonEntryId)],
);

export const dkpStandings = pgTable(
  "dkp_standings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    guildId: uuid("guild_id")
      .notNull()
      .references(() => guilds.id, { onDelete: "cascade" }),
    playerName: varchar("player_name", { length: 64 }).notNull(),
    current: integer("current").notNull().default(0),
    lifetime: integer("lifetime").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("dkp_standings_guild_player").on(t.guildId, t.playerName)],
);

export const dkpTombstones = pgTable(
  "dkp_tombstones",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    guildId: uuid("guild_id")
      .notNull()
      .references(() => guilds.id, { onDelete: "cascade" }),
    playerName: varchar("player_name", { length: 64 }).notNull(),
    deletedBy: varchar("deleted_by", { length: 64 }).notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [unique("dkp_tombstones_guild_player").on(t.guildId, t.playerName)],
);

export const guildSettings = pgTable("guild_settings", {
  id: uuid("id").primaryKey().defaultRandom(),
  guildId: uuid("guild_id").notNull().unique().references(() => guilds.id, { onDelete: "cascade" }),
  raidChannelId: varchar("raid_channel_id", { length: 32 }),
  calendarMessageId: varchar("calendar_message_id", { length: 32 }),
  dkpChannelId: varchar("dkp_channel_id", { length: 32 }),
  dkpMessageId: varchar("dkp_message_id", { length: 32 }),
  adminRoleIds: jsonb("admin_role_ids").$type<string[]>().notNull().default([]),
  editorRoleIds: jsonb("editor_role_ids").$type<string[]>().notNull().default([]),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const dkpSeasons = pgTable("dkp_seasons", {
  id: uuid("id").primaryKey().defaultRandom(),
  guildId: uuid("guild_id")
    .notNull()
    .references(() => guilds.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 128 }).notNull(),
  archivedBy: varchar("archived_by", { length: 64 }).notNull(),
  archivedAt: timestamp("archived_at", { withTimezone: true }).notNull(),
  snapshotData: jsonb("snapshot_data").notNull(),
});
