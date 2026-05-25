-- =============================================================================
-- baseline_migrations.sql — EINMALIG pro Datenbank ausführen
-- =============================================================================
-- Zweck: Eine Datenbank, deren Migrationen bisher MANUELL (z.B. via DataGrip)
-- eingespielt wurden, für `drizzle-kit migrate` vorbereiten.
--
-- Ohne diesen Schritt kennt Drizzle die Tracking-Tabelle nicht und würde beim
-- nächsten Deploy versuchen, ALLE Migrationen ab 0000 erneut anzuwenden — das
-- scheitert an bereits existierenden Tabellen/Spalten.
--
-- Dieses Script legt die Tracking-Tabelle an und markiert alle Migrationen bis
-- einschließlich 0015 als angewendet. drizzle-kit migrate überspringt dann alles
-- bis 0015 und wendet künftig nur neue Migrationen (0016+) an.
--
-- WICHTIG: Vorher das Reparatur-Script laufen lassen, das sicherstellt, dass die
-- DB tatsächlich auf Stand 0015 ist (alle Spalten vorhanden).
--
-- Anwenden: in DataGrip auf der Ziel-DB (z.B. lunawolves) ausführen.
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS drizzle;

CREATE TABLE IF NOT EXISTS drizzle."__drizzle_migrations" (
  id SERIAL PRIMARY KEY,
  hash text NOT NULL,
  created_at bigint
);

-- Baseline-Marke = größter "when"-Wert aus drizzle/meta/_journal.json (Migration 0015/0011).
-- Wird nur eingefügt, falls noch keine Marke >= diesem Wert existiert (mehrfach ausführbar).
INSERT INTO drizzle."__drizzle_migrations" (hash, created_at)
SELECT 'baseline_through_0015', 1779667200000
WHERE NOT EXISTS (
  SELECT 1 FROM drizzle."__drizzle_migrations" WHERE created_at >= 1779667200000
);
