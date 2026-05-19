import Link from "next/link";
import { apiFetch } from "@/lib/api";
import { LiveFeed } from "./components/LiveFeed";
import { DisplayNameTile } from "./DisplayNameTile";

interface Guild {
  id: string;
  name: string;
}

interface Character {
  id: string;
  name: string;
  class: string;
  level: number;
  itemLevel: number;
  mPlusScore: number;
  guild: Guild | null;
}

interface Player {
  id: string;
  bnetTag: string;
  discordTag: string | null;
  displayName: string | null;
  characters: Character[];
}

const classColors: Record<string, string> = {
  warrior: "text-amber-500",
  paladin: "text-pink-400",
  hunter: "text-green-400",
  rogue: "text-yellow-400",
  priest: "text-zinc-100",
  shaman: "text-blue-400",
  mage: "text-cyan-400",
  warlock: "text-purple-400",
  monk: "text-emerald-400",
  druid: "text-orange-400",
  demon_hunter: "text-violet-400",
  death_knight: "text-red-500",
  evoker: "text-teal-400",
};

export default async function DashboardPage() {
  let player: Player | null = null;
  try {
    player = await apiFetch<Player>("/players/me");
  } catch {}

  const guildId = player?.characters.find((c) => c.guild)?.guild?.id ?? null;

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Übersicht</h1>
      {player ? (
        <div className="space-y-6">
          <div className="flex gap-4 flex-wrap">
            <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
              <p className="text-zinc-500 text-xs uppercase tracking-wider">Battle.net Account</p>
              <p className="text-xl font-semibold mt-1">{player.bnetTag}</p>
            </div>

            <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
              <p className="text-zinc-500 text-xs uppercase tracking-wider">Discord Account</p>
              {player.discordTag ? (
                <p className="text-xl font-semibold mt-1 text-indigo-300">{player.discordTag}</p>
              ) : (
                <a
                  href="/auth/discord-link"
                  className="mt-1 flex items-center gap-2 text-indigo-400 hover:text-indigo-300 transition-colors"
                >
                  <span className="text-lg font-semibold">Verknüpfen</span>
                  <span className="text-zinc-500 text-sm">→</span>
                </a>
              )}
            </div>

            <DisplayNameTile current={player.displayName} />
          </div>

          <div>
            <h2 className="text-lg font-semibold mb-3">
              Deine Characters ({player.characters.length})
            </h2>
            {player.characters.length === 0 ? (
              <p className="text-zinc-500">Noch keine Characters angelegt.</p>
            ) : (
              <div className="grid gap-2">
                {player.characters.map((char) => (
                  <Link
                    key={char.id}
                    href={`/dashboard/characters/${char.id}`}
                    className="bg-zinc-900 border border-zinc-800 rounded-lg px-4 py-3 flex items-center justify-between hover:border-zinc-600 hover:bg-zinc-800/60 transition-colors"
                  >
                    <div>
                      <span className={`font-semibold ${classColors[char.class] ?? "text-zinc-100"}`}>
                        {char.name}
                      </span>
                      <span className="text-zinc-500 text-sm ml-2 capitalize">
                        {char.class.replace(/_/g, " ")}
                      </span>
                    </div>
                    <div className="flex items-center gap-6 text-sm text-zinc-400">
                      <span>Lvl {char.level}</span>
                      <span className="text-zinc-300">{char.itemLevel > 0 ? char.itemLevel : "–"} ilvl</span>
                      {char.mPlusScore > 0 && <span>{char.mPlusScore} M+</span>}
                      {char.guild && <span className="text-zinc-500">{char.guild.name}</span>}
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>

          {guildId && <LiveFeed guildId={guildId} />}
        </div>
      ) : (
        <p className="text-zinc-500">Fehler beim Laden des Profils.</p>
      )}
    </div>
  );
}
