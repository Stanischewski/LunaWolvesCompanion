import { apiFetch } from "./api";

export interface Guild {
  id: string;
  name: string;
  realm: string;
  faction: string;
}

/**
 * Bestimmt die anzuzeigende Gilde.
 *
 * Priorität:
 * 1. GUILD_NAME env-Variable → sucht exakt diesen Namen in /guilds
 * 2. Erster Charakter des eingeloggten Spielers, der einer Gilde angehört
 * 3. Erste Gilde aus /guilds
 */
export async function resolveGuild(): Promise<Guild | null> {
  const guildName = process.env.GUILD_NAME;

  const allGuilds = await apiFetch<Guild[]>("/guilds").catch(() => [] as Guild[]);

  // 1. Feste Gilde per env konfiguriert
  if (guildName) {
    const match = allGuilds.find(
      (g) => g.name.toLowerCase() === guildName.toLowerCase(),
    );
    if (match) return match;
  }

  // 2. Gilde des eingeloggten Spielers
  try {
    const player = await apiFetch<{ characters: { guild: Guild | null }[] }>("/players/me");
    const fromPlayer = player.characters.find((c) => c.guild)?.guild ?? null;
    if (fromPlayer) return fromPlayer;
  } catch {
    // nicht eingeloggt oder Fehler – weiter zum Fallback
  }

  // 3. Erste Gilde in der DB
  return allGuilds[0] ?? null;
}
