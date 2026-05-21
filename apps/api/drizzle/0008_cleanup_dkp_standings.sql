-- Bereinigt dkp_standings: entfernt alle Einträge, deren player_name keinem
-- bekannten Charakter (characters-Tabelle) in derselben Gilde entspricht.
DELETE FROM dkp_standings ds
WHERE NOT EXISTS (
    SELECT 1 FROM characters c
    WHERE c.guild_id = ds.guild_id
    AND c.name = ds.player_name
);
