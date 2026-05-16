CREATE TYPE "public"."activity_source" AS ENUM('addon', 'api');--> statement-breakpoint
CREATE TYPE "public"."faction" AS ENUM('alliance', 'horde');--> statement-breakpoint
CREATE TYPE "public"."raid_role" AS ENUM('tank', 'heal', 'dps');--> statement-breakpoint
CREATE TYPE "public"."signup_status" AS ENUM('yes', 'maybe', 'no');--> statement-breakpoint
CREATE TYPE "public"."wow_class" AS ENUM('warrior', 'paladin', 'hunter', 'rogue', 'priest', 'shaman', 'mage', 'warlock', 'monk', 'druid', 'demon_hunter', 'death_knight', 'evoker');--> statement-breakpoint
CREATE TABLE "activity_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"character_id" uuid NOT NULL,
	"event_type" varchar(64) NOT NULL,
	"event_data" jsonb,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source" "activity_source" NOT NULL
);
--> statement-breakpoint
CREATE TABLE "addon_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guild_id" uuid NOT NULL,
	"uploaded_by" uuid NOT NULL,
	"raw_data" jsonb NOT NULL,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "characters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"player_id" uuid NOT NULL,
	"guild_id" uuid NOT NULL,
	"name" varchar(64) NOT NULL,
	"realm" varchar(64) NOT NULL,
	"class" "wow_class" NOT NULL,
	"level" integer DEFAULT 1 NOT NULL,
	"item_level" integer DEFAULT 0 NOT NULL,
	"m_plus_score" integer DEFAULT 0 NOT NULL,
	"last_login" timestamp with time zone,
	"guild_rank" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "guilds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(128) NOT NULL,
	"realm" varchar(64) NOT NULL,
	"faction" "faction" NOT NULL,
	"member_count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "players" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bnet_id" varchar(64) NOT NULL,
	"bnet_tag" varchar(64) NOT NULL,
	"discord_id" varchar(32),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "players_bnet_id_unique" UNIQUE("bnet_id")
);
--> statement-breakpoint
CREATE TABLE "raid_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guild_id" uuid NOT NULL,
	"title" varchar(128) NOT NULL,
	"scheduled_at" timestamp with time zone NOT NULL,
	"raid_type" varchar(64),
	"min_ilvl" integer
);
--> statement-breakpoint
CREATE TABLE "raid_signups" (
	"raid_event_id" uuid NOT NULL,
	"character_id" uuid NOT NULL,
	"role" "raid_role" NOT NULL,
	"status" "signup_status" DEFAULT 'yes' NOT NULL,
	CONSTRAINT "raid_signups_raid_event_id_character_id_pk" PRIMARY KEY("raid_event_id","character_id")
);
--> statement-breakpoint
ALTER TABLE "activity_logs" ADD CONSTRAINT "activity_logs_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "addon_snapshots" ADD CONSTRAINT "addon_snapshots_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "addon_snapshots" ADD CONSTRAINT "addon_snapshots_uploaded_by_players_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "characters" ADD CONSTRAINT "characters_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "characters" ADD CONSTRAINT "characters_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "raid_events" ADD CONSTRAINT "raid_events_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "raid_signups" ADD CONSTRAINT "raid_signups_raid_event_id_raid_events_id_fk" FOREIGN KEY ("raid_event_id") REFERENCES "public"."raid_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "raid_signups" ADD CONSTRAINT "raid_signups_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE cascade ON UPDATE no action;