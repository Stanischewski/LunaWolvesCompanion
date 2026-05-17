ALTER TABLE "characters" DROP CONSTRAINT "characters_player_id_players_id_fk";
--> statement-breakpoint
ALTER TABLE "characters" ALTER COLUMN "player_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "characters" ADD CONSTRAINT "characters_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE set null ON UPDATE no action;