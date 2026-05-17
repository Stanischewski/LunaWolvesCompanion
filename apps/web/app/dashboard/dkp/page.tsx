import Link from "next/link";
import { apiFetch } from "@/lib/api";

interface Guild {
  id: string;
  name: string;
  realm: string;
}

interface Standing {
  id: string;
  playerName: string;
  current: number;
  lifetime: number;
  updatedAt: string;
}

function formatRelative(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 60) return `vor ${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `vor ${h}h`;
  return `vor ${Math.floor(h / 24)}d`;
}

export default async function DkpPage() {
  let guild: Guild | null = null;
  let standings: Standing[] = [];

  try {
    const guilds = await apiFetch<Guild[]>("/guilds");
    if (guilds.length > 0) {
      guild = guilds[0];
      standings = await apiFetch<Standing[]>(`/guilds/${guild.id}/dkp/standings`);
    }
  } catch {}

  return (
    <div>
      <div className="flex items-baseline justify-between mb-6">
        <div className="flex items-baseline gap-3">
          <h1 className="text-2xl font-bold">DKP</h1>
          {guild && (
            <span className="text-zinc-500 text-sm">
              {guild.name} · {standings.length} Spieler
            </span>
          )}
        </div>
        <div className="flex gap-2">
          <Link
            href="/dashboard/dkp/history"
            className="text-xs text-zinc-400 hover:text-zinc-200 px-3 py-1.5 rounded border border-zinc-700 hover:border-zinc-500 transition-colors"
          >
            History
          </Link>
          <Link
            href="/dashboard/dkp/manage"
            className="text-xs text-zinc-100 hover:text-white px-3 py-1.5 rounded border border-zinc-600 hover:border-zinc-400 bg-zinc-800 hover:bg-zinc-700 transition-colors"
          >
            DKP verwalten
          </Link>
        </div>
      </div>

      {!guild ? (
        <p className="text-zinc-500">Noch keine Gilde eingerichtet.</p>
      ) : standings.length === 0 ? (
        <p className="text-zinc-500">Noch keine DKP-Einträge vorhanden.</p>
      ) : (
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800 text-zinc-500 text-xs uppercase tracking-wider">
                <th className="px-4 py-3 text-left w-8">#</th>
                <th className="px-4 py-3 text-left">Spieler</th>
                <th className="px-4 py-3 text-right">Aktuell</th>
                <th className="px-4 py-3 text-right">Lifetime</th>
                <th className="px-4 py-3 text-right">Zuletzt</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {standings.map((s, i) => (
                <tr key={s.id} className="hover:bg-zinc-800/50 transition-colors">
                  <td className="px-4 py-3 text-zinc-600 text-xs">{i + 1}</td>
                  <td className="px-4 py-3">
                    <Link
                      href={`/dashboard/dkp/player/${encodeURIComponent(s.playerName)}`}
                      className="font-medium text-zinc-100 hover:text-white hover:underline"
                    >
                      {s.playerName}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-right font-semibold text-green-400">
                    {s.current.toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-right text-zinc-400">
                    {s.lifetime.toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-right text-zinc-500 text-xs">
                    {formatRelative(s.updatedAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
