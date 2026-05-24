ALTER TABLE "character_equipment" ADD COLUMN "item_subclass" varchar(64);
--> statement-breakpoint
ALTER TABLE "character_equipment" ADD COLUMN "stats" jsonb;
--> statement-breakpoint
ALTER TABLE "character_equipment" ADD COLUMN "enchantments" jsonb;
--> statement-breakpoint
ALTER TABLE "character_equipment" ADD COLUMN "gems" jsonb;
