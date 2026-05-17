import { apiFetch } from "@/lib/api";

interface Guild {
  id: string;
  name: string;
  realm: string;
  faction: string;
}

interface Member {
  id: string;
  name: string;
  class: string;
  level: number;
  itemLevel: number;
  mPlusScore: number;
  guildRank: number;
  player: { bnetTag: string } | null;
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

export default async function RosterPage() {
  let guild: Guild | null = null;
  let members: Member[] = [];

  try {
    const guilds = await apiFetch<Guild[]>("/guilds");
    if (guilds.length > 0) {
      guild = guilds[0];
      members = await apiFetch<Member[]>(`/guilds/${guild.id}/members`);
    }
  } catch {}

  return (
    <div>
      <div className="flex items-baseline gap-3 mb-6">
        <h1 className="text-2xl font-bold">Roster</h1>
        {guild && (
          <span className="text-zinc-500 text-sm">
            {guild.name} – {guild.realm} · {members.length} Mitglieder
          </span>
        )}
      </div>

      {!guild ? (
        <p className="text-zinc-500">Noch keine Gilde eingerichtet.</p>
      ) : members.length === 0 ? (
        <p className="text-zinc-500">Keine Characters in der Gilde.</p>
      ) : (
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800 text-zinc-500 text-xs uppercase tracking-wider">
                <th className="px-4 py-3 text-left">Name</th>
                <th className="px-4 py-3 text-left">Klasse</th>
                <th className="px-4 py-3 text-right">Level</th>
                <th className="px-4 py-3 text-right">ilvl</th>
                <th className="px-4 py-3 text-right">M+</th>
                <th className="px-4 py-3 text-left">Battle.net</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {members
                .sort((a, b) => a.guildRank - b.guildRank || b.itemLevel - a.itemLevel)
                .map((char) => (
                  <tr key={char.id} className="hover:bg-zinc-800/50 transition-colors">
                    <td className={`px-4 py-3 font-medium ${classColors[char.class] ?? "text-zinc-100"}`}>
                      {char.name}
                    </td>
                    <td className="px-4 py-3 text-zinc-400 capitalize">
                      {char.class.replace(/_/g, " ")}
                    </td>
                    <td className="px-4 py-3 text-right text-zinc-400">{char.level}</td>
                    <td className="px-4 py-3 text-right text-zinc-300 font-medium">{char.itemLevel}</td>
                    <td className="px-4 py-3 text-right text-zinc-400">
                      {char.mPlusScore > 0 ? char.mPlusScore : "–"}
                    </td>
                    <td className="px-4 py-3 text-zinc-500">{char.player?.bnetTag ?? "–"}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
