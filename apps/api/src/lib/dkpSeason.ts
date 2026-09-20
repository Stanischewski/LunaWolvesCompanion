import { sql, eq, desc, and, gt } from "drizzle-orm";
import type { db as Database } from "../db/index.js";
import { dkpSeasons, dkpTombstones } from "../db/schema.js";

type Tx = Parameters<Parameters<typeof Database.transaction>[0]>[0] | typeof Database;

/** Vor der ersten Saison gilt alles als laufende Saison. */
export const EPOCH_ZERO = new Date(0);

/**
 * Beginn der laufenden DKP-Saison.
 *
 * Eine Saison endet mit `dkp_seasons.archivedAt`; dieser Zeitpunkt ist zugleich
 * der Beginn der naechsten. Alles davor zaehlt nicht mehr in die Standings.
 *
 * Ohne diese Grenze machte der naechste Addon-Sync jeden Season-Reset wieder
 * rueckgaengig: die Standings wurden aus *allen* Eintraegen neu summiert, also
 * kam der komplette Vor-Reset-Stand zurueck, sobald ein Spieler einen einzigen
 * neuen Eintrag bekam.
 */
export async function getSeasonStart(tx: Tx, guildId: string): Promise<Date> {
  const [latest] = await tx
    .select({ archivedAt: dkpSeasons.archivedAt })
    .from(dkpSeasons)
    .where(eq(dkpSeasons.guildId, guildId))
    .orderBy(desc(dkpSeasons.archivedAt))
    .limit(1);
  return latest?.archivedAt ?? EPOCH_ZERO;
}

/**
 * Berechnet die Standings der angegebenen Spieler neu — in einer Anweisung.
 *
 * Beruecksichtigt:
 *  - die Saison-Grenze (Eintraege davor zaehlen nicht)
 *  - *aktive* Tombstones (abgelaufene filtern nicht mehr; frueher wertete der
 *    Server `expiresAt` ueberhaupt nicht aus, womit ein einmal geloeschter
 *    Spieler dauerhaft gefiltert blieb, waehrend das Addon ihn laengst wieder
 *    akzeptierte)
 *  - nur Spielernamen, die als Charakter der Gilde bekannt sind
 *
 * Spieler ohne verbleibende Eintraege werden auf 0 gesetzt, nicht uebersprungen —
 * sonst bliebe nach einem Reset ein alter Stand stehen.
 */
export async function recalculateStandings(
  tx: Tx,
  guildId: string,
  playerNames: string[],
  seasonStart: Date,
): Promise<number> {
  if (playerNames.length === 0) return 0;

  // Namen als VALUES-Liste einsetzen. Ein JS-Array in einem sql-Template
  // expandiert Drizzle zu Einzelparametern, was `unnest($1::varchar[])` zu
  // ungueltigem SQL machen wuerde. Der ::varchar-Cast ist noetig, weil
  // Postgres den Typ eines nackten Parameters in VALUES nicht herleiten kann.
  const nameRows = playerNames.map((n) => sql`(${n}::varchar)`);

  // Date-Objekte kann postgres.js in tx.execute nicht binden — als ISO-String
  // mit explizitem Cast uebergeben.
  const seasonStartIso = seasonStart.toISOString();

  const result = await tx.execute(sql`
    INSERT INTO dkp_standings (guild_id, player_name, current, lifetime, updated_at)
    SELECT
      ${guildId}::uuid,
      p.name,
      COALESCE(SUM(e.delta), 0)::int,
      COALESCE(SUM(CASE WHEN e.delta > 0 THEN e.delta ELSE 0 END), 0)::int,
      now()
    FROM (VALUES ${sql.join(nameRows, sql`, `)}) AS p(name)
    LEFT JOIN dkp_tombstones t
      ON t.guild_id = ${guildId}::uuid
     AND t.player_name = p.name
     AND t.expires_at > now()
    LEFT JOIN dkp_entries e
      ON e.guild_id = ${guildId}::uuid
     AND e.player_name = p.name
     AND e.occurred_at > ${seasonStartIso}::timestamptz
     AND (t.deleted_at IS NULL OR e.occurred_at > t.deleted_at)
    WHERE EXISTS (
      SELECT 1 FROM characters c
      WHERE c.guild_id = ${guildId}::uuid AND c.name = p.name
    )
    GROUP BY p.name
    ON CONFLICT (guild_id, player_name) DO UPDATE
      SET current = EXCLUDED.current,
          lifetime = EXCLUDED.lifetime,
          updated_at = now()
  `);

  return (result as unknown as { count?: number }).count ?? 0;
}

/** Aktive (nicht abgelaufene) Tombstones einer Gilde. */
export async function getActiveTombstones(tx: Tx, guildId: string) {
  return tx
    .select({
      playerName: dkpTombstones.playerName,
      deletedAt: dkpTombstones.deletedAt,
    })
    .from(dkpTombstones)
    .where(and(eq(dkpTombstones.guildId, guildId), gt(dkpTombstones.expiresAt, new Date())));
}
