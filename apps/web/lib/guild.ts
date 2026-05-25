import { apiFetch } from "./api";

export interface Guild {
  id: string;
  name: string;
  realm: string;
  faction: string;
  isPrimary: boolean;
}

/**
 * Bestimmt die anzuzeigende Gilde.
 *
 * Priorität:
 * 1. Gilde mit isPrimary=true in der DB (per Einstellungen konfigurierbar)
 * 2. GUILD_NAME env-Variable (Fallback für alte Setups)
 * 3. Erster Charakter des eingeloggten Spielers, der einer Gilde angehört
 * 4. Erste Gilde aus /guilds
 */
export async function resolveGuild(): Promise<Guild | null> {
  const allGuilds = await apiFetch<Guild[]>("/guilds").catch(() => [] as Guild[]);

  // 1. Primäre Gilde per DB konfiguriert
  const primary = allGuilds.find((g) => g.isPrimary);
  if (primary) return primary;

  // 2. Feste Gilde per env konfiguriert (Fallback)
  const guildName = process.env.GUILD_NAME;
  if (guildName) {
    const match = allGuilds.find(
      (g) => g.name.toLowerCase() === guildName.toLowerCase(),
    );
    if (match) return match;
  }

  // 3. Gilde des eingeloggten Spielers
  try {
    const player = await apiFetch<{ characters: { guild: Guild | null }[] }>("/players/me");
    const fromPlayer = player.characters.find((c) => c.guild)?.guild ?? null;
    if (fromPlayer) return fromPlayer;
  } catch {
    // nicht eingeloggt oder Fehler – weiter zum Fallback
  }

  // 4. Erste Gilde in der DB
  return allGuilds[0] ?? null;
}
