-- B9: Gildenaustritte werden erkennbar. Bewusst kein Löschen — DKP-History und
-- vergangene Raid-Anmeldungen bleiben erhalten.
ALTER TABLE "characters" ADD COLUMN IF NOT EXISTS "left_guild_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "characters_guild_active" ON "characters" ("guild_id","left_guild_at");--> statement-breakpoint

-- B2: Eine Saison bekommt einen Beginn. archived_at ist ihr Ende und zugleich
-- die Epoche, ab der die Folgesaison zählt.
ALTER TABLE "dkp_seasons" ADD COLUMN IF NOT EXISTS "started_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dkp_seasons_guild_time" ON "dkp_seasons" ("guild_id","archived_at" DESC);--> statement-breakpoint

-- Bestandsdaten: Beginn jeder Saison ist das Ende der Vorgängersaison.
UPDATE "dkp_seasons" s
SET "started_at" = (
  SELECT MAX(p."archived_at") FROM "dkp_seasons" p
  WHERE p."guild_id" = s."guild_id" AND p."archived_at" < s."archived_at"
)
WHERE s."started_at" IS NULL;
