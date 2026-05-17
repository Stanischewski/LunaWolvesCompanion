import Link from "next/link";
import { apiFetch } from "@/lib/api";

interface Guild {
  id: string;
}

interface Standing {
  playerName: string;
  current: number;
  lifetime: number;
  updatedAt: string;
}

interface DkpEntry {
  id: string;
  playerName: string;
  delta: number;
  reason: string;
  entryType: "manual" | "boss" | "spend" | "correction";
  officerName: string;
  occurredAt: string;
  source: "addon" | "web";
}

const typeLabels: Record<string, string> = {
  manual: "Manuell",
  boss: "Bosskill",
  spend: "Ausgabe",
  correction: "Korrektur",
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default async function DkpPlayerPage({
  params,
}: {
  params: Promise<{ name: string }>;
}) {
  const { name } = await params;
  const playerName = decodeURIComponent(name);

  let standing: Standing | null = null;
  let history: DkpEntry[] = [];

  try {
    const guilds = await apiFetch<Guild[]>("/guilds");
    if (guilds.length > 0) {
      const guildId = guilds[0].id;
      [standing, history] = await Promise.all([
        apiFetch<Standing>(`/guilds/${guildId}/dkp/standings/${encodeURIComponent(playerName)}`).catch(() => null),
        apiFetch<DkpEntry[]>(`/guilds/${guildId}/dkp/history?player=${encodeURIComponent(playerName)}&limit=100`),
      ]);
    }
  } catch {}

  return (
    <div>
      <div className="flex items-baseline gap-3 mb-6">
        <Link href="/dashboard/dkp" className="text-zinc-500 hover:text-zinc-300 text-sm">
          ← DKP
        </Link>
        <h1 className="text-2xl font-bold">{playerName}</h1>
      </div>

      {standing ? (
        <div className="grid grid-cols-2 gap-4 mb-8">
          <div className="bg-zinc-900 border border-zinc-800 rounded-lg px-6 py-4">
            <p className="text-xs text-zinc-500 uppercase tracking-wider mb-1">Aktuell</p>
            <p className="text-3xl font-bold text-green-400">{standing.current.toLocaleString()}</p>
            <p className="text-xs text-zinc-600 mt-1">DKP</p>
          </div>
          <div className="bg-zinc-900 border border-zinc-800 rounded-lg px-6 py-4">
            <p className="text-xs text-zinc-500 uppercase tracking-wider mb-1">Lifetime</p>
            <p className="text-3xl font-bold text-zinc-300">{standing.lifetime.toLocaleString()}</p>
            <p className="text-xs text-zinc-600 mt-1">DKP gesamt</p>
          </div>
        </div>
      ) : (
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg px-6 py-4 mb-8">
          <p className="text-zinc-500">Kein Standing für diesen Spieler.</p>
        </div>
      )}

      <h2 className="text-sm font-semibold text-zinc-500 uppercase tracking-wider mb-3">
        History ({history.length})
      </h2>

      {history.length === 0 ? (
        <p className="text-zinc-500">Keine Einträge.</p>
      ) : (
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800 text-zinc-500 text-xs uppercase tracking-wider">
                <th className="px-4 py-3 text-left">Datum</th>
                <th className="px-4 py-3 text-right">DKP</th>
                <th className="px-4 py-3 text-left">Grund</th>
                <th className="px-4 py-3 text-left">Typ</th>
                <th className="px-4 py-3 text-left">Officer</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {history.map((e) => (
                <tr key={e.id} className="hover:bg-zinc-800/50 transition-colors">
                  <td className="px-4 py-2.5 text-zinc-500 text-xs whitespace-nowrap">
                    {formatDate(e.occurredAt)}
                  </td>
                  <td className={`px-4 py-2.5 text-right font-semibold ${e.delta >= 0 ? "text-green-400" : "text-red-400"}`}>
                    {e.delta >= 0 ? "+" : ""}{e.delta}
                  </td>
                  <td className="px-4 py-2.5 text-zinc-400">{e.reason}</td>
                  <td className="px-4 py-2.5 text-zinc-500 text-xs">{typeLabels[e.entryType] ?? e.entryType}</td>
                  <td className="px-4 py-2.5 text-zinc-500 text-xs">{e.officerName}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
