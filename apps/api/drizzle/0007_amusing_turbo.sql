CREATE TABLE "character_equipment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"character_id" uuid NOT NULL,
	"slot" varchar(32) NOT NULL,
	"item_id" integer NOT NULL,
	"item_name" varchar(256),
	"item_level" integer DEFAULT 0 NOT NULL,
	"quality" varchar(32),
	"icon_url" text,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "char_equipment_slot" UNIQUE("character_id","slot")
);
--> statement-breakpoint
CREATE TABLE "item_icon_cache" (
	"item_id" integer PRIMARY KEY NOT NULL,
	"icon_url" text NOT NULL,
	"cached_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "players" ADD COLUMN "bnet_access_token" text;--> statement-breakpoint
ALTER TABLE "players" ADD COLUMN "bnet_token_expiry" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "character_equipment" ADD CONSTRAINT "character_equipment_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE cascade ON UPDATE no action;