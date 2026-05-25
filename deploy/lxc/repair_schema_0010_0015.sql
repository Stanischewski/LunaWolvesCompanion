-- =============================================================================
-- repair_schema_0010_0015.sql — Produktions-DB auf Migrationsstand 0015 bringen
-- =============================================================================
-- Hintergrund: Migrationen wurden manuell eingespielt, dabei fehlten 0010–0014.
-- Der Code (Drizzle-Schema) erwartet diese Spalten → 500er beim Raid-Erstellen
-- und Einstellungen-Speichern (column ... does not exist).
--
-- Dieses Script ist idempotent (ADD COLUMN IF NOT EXISTS) und kann gefahrlos
-- mehrfach ausgeführt werden. In DataGrip auf der Ziel-DB (z.B. lunawolves) laufen.
-- =============================================================================

-- 0010: Kalender-Nachricht in guild_settings
ALTER TABLE "guild_settings" ADD COLUMN IF NOT EXISTS "calendar_message_id" varchar(32);

-- 0011: Kalender-Nachricht pro Raid
ALTER TABLE "raid_events" ADD COLUMN IF NOT EXISTS "calendar_message_id" varchar(32);

-- 0012: Ausrüstungs-Details
ALTER TABLE "character_equipment" ADD COLUMN IF NOT EXISTS "item_subclass" varchar(64);
ALTER TABLE "character_equipment" ADD COLUMN IF NOT EXISTS "stats" jsonb;
ALTER TABLE "character_equipment" ADD COLUMN IF NOT EXISTS "enchantments" jsonb;
ALTER TABLE "character_equipment" ADD COLUMN IF NOT EXISTS "gems" jsonb;

-- 0013: Set-Bonus
ALTER TABLE "character_equipment" ADD COLUMN IF NOT EXISTS "set_bonus" jsonb;

-- 0014: DKP-Channel
ALTER TABLE "guild_settings" ADD COLUMN IF NOT EXISTS "dkp_channel_id" varchar(32);
ALTER TABLE "guild_settings" ADD COLUMN IF NOT EXISTS "dkp_message_id" varchar(32);

-- 0015 (is_primary) bereits angewendet — hier nicht nötig.

-- Rechte für App-User (idempotent)
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "guild_settings" TO lw_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "raid_events" TO lw_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "character_equipment" TO lw_app;
