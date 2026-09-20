-- Sekundaerindizes fuer die heissen Abfragepfade.
-- Bis hierher existierten nur Primaerschluessel und die unique-Constraints;
-- Fremdschluessel indiziert PostgreSQL nicht automatisch.
-- CONCURRENTLY ist hier bewusst nicht gesetzt: drizzle-kit fuehrt Migrationen
-- in einer Transaktion aus, und die Tabellen sind klein genug fuer eine
-- kurze Sperre.

-- Sync: ein Lookup pro Gildenmitglied pro Upload (routes/sync.ts)
CREATE INDEX IF NOT EXISTS "characters_guild_name_realm" ON "characters" ("guild_id","name","realm");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "characters_player" ON "characters" ("player_id");--> statement-breakpoint

-- Aktivitaetsabfragen laufen immer nach Zeit absteigend
CREATE INDEX IF NOT EXISTS "activity_logs_char_time" ON "activity_logs" ("character_id","recorded_at" DESC);--> statement-breakpoint

-- "neuester Snapshot dieser Gilde"
CREATE INDEX IF NOT EXISTS "addon_snapshots_guild_time" ON "addon_snapshots" ("guild_id","uploaded_at" DESC);--> statement-breakpoint

-- Anmeldungen eines Charakters (Primaerschluessel beginnt mit raid_event_id)
CREATE INDEX IF NOT EXISTS "raid_signups_character" ON "raid_signups" ("character_id");--> statement-breakpoint

-- Raid-Kalender je Gilde nach Termin
CREATE INDEX IF NOT EXISTS "raid_events_guild_time" ON "raid_events" ("guild_id","scheduled_at");--> statement-breakpoint

-- DKP-History, Standings-Neuberechnung und Rueckkanal
CREATE INDEX IF NOT EXISTS "dkp_entries_guild_player_time" ON "dkp_entries" ("guild_id","player_name","occurred_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dkp_entries_guild_time" ON "dkp_entries" ("guild_id","occurred_at" DESC);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dkp_entries_pending" ON "dkp_entries" ("guild_id","source","addon_synced_at");--> statement-breakpoint

-- Saisonliste je Gilde
CREATE INDEX IF NOT EXISTS "dkp_seasons_guild_time" ON "dkp_seasons" ("guild_id","archived_at" DESC);
