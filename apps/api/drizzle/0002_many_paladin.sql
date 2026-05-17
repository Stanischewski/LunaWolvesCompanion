CREATE TYPE "public"."dkp_entry_type" AS ENUM('manual', 'boss', 'spend', 'correction');--> statement-breakpoint
CREATE TABLE "dkp_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guild_id" uuid NOT NULL,
	"addon_entry_id" varchar(128) NOT NULL,
	"player_name" varchar(64) NOT NULL,
	"delta" integer NOT NULL,
	"reason" varchar(256) DEFAULT '' NOT NULL,
	"entry_type" "dkp_entry_type" NOT NULL,
	"officer_name" varchar(64) NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"source" varchar(16) DEFAULT 'addon' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dkp_entries_guild_addon_id" UNIQUE("guild_id","addon_entry_id")
);
--> statement-breakpoint
CREATE TABLE "dkp_seasons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guild_id" uuid NOT NULL,
	"name" varchar(128) NOT NULL,
	"archived_by" varchar(64) NOT NULL,
	"archived_at" timestamp with time zone NOT NULL,
	"snapshot_data" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dkp_standings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guild_id" uuid NOT NULL,
	"player_name" varchar(64) NOT NULL,
	"current" integer DEFAULT 0 NOT NULL,
	"lifetime" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dkp_standings_guild_player" UNIQUE("guild_id","player_name")
);
--> statement-breakpoint
CREATE TABLE "dkp_tombstones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guild_id" uuid NOT NULL,
	"player_name" varchar(64) NOT NULL,
	"deleted_by" varchar(64) NOT NULL,
	"deleted_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "dkp_tombstones_guild_player" UNIQUE("guild_id","player_name")
);
--> statement-breakpoint
ALTER TABLE "dkp_entries" ADD CONSTRAINT "dkp_entries_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dkp_seasons" ADD CONSTRAINT "dkp_seasons_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dkp_standings" ADD CONSTRAINT "dkp_standings_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dkp_tombstones" ADD CONSTRAINT "dkp_tombstones_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;