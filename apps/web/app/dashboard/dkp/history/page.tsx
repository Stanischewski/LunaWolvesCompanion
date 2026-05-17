import Link from "next/link";
import { apiFetch } from "@/lib/api";

interface Guild {
  id: string;
  name: string;
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
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default async function DkpHistoryPage() {
  let guild: Guild | null = null;
  let entries: DkpEntry[] = [];

  try {
    const guilds = await apiFetch<Guild[]>("/guilds");
    if (guilds.length > 0) {
      guild = guilds[0];
      entries = await apiFetch<DkpEntry[]>(`/guilds/${guild.id}/dkp/history?limit=100`);
    }
  } catch {}

  return (
    <div>
      <div className="flex items-baseline gap-3 mb-6">
        <Link href="/dashboard/dkp" className="text-zinc-500 hover:text-zinc-300 text-sm">
          ← DKP
        </Link>
        <h1 className="text-2xl font-bold">History</h1>
        {guild && <span className="text-zinc-500 text-sm">{entries.length} Einträge</span>}
      </div>

      {!guild ? (
        <p className="text-zinc-500">Noch keine Gilde eingerichtet.</p>
      ) : entries.length === 0 ? (
        <p className="text-zinc-500">Noch keine DKP-Einträge vorhanden.</p>
      ) : (
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800 text-zinc-500 text-xs uppercase tracking-wider">
                <th className="px-4 py-3 text-left">Datum</th>
                <th className="px-4 py-3 text-left">Spieler</th>
                <th className="px-4 py-3 text-right">DKP</th>
                <th className="px-4 py-3 text-left">Grund</th>
                <th className="px-4 py-3 text-left">Typ</th>
                <th className="px-4 py-3 text-left">Officer</th>
                <th className="px-4 py-3 text-left">Quelle</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {entries.map((e) => (
                <tr key={e.id} className="hover:bg-zinc-800/50 transition-colors">
                  <td className="px-4 py-2.5 text-zinc-500 text-xs whitespace-nowrap">
                    {formatDate(e.occurredAt)}
                  </td>
                  <td className="px-4 py-2.5">
                    <Link
                      href={`/dashboard/dkp/player/${encodeURIComponent(e.playerName)}`}
                      className="text-zinc-200 hover:text-white hover:underline"
                    >
                      {e.playerName}
                    </Link>
                  </td>
                  <td className={`px-4 py-2.5 text-right font-semibold ${e.delta >= 0 ? "text-green-400" : "text-red-400"}`}>
                    {e.delta >= 0 ? "+" : ""}{e.delta}
                  </td>
                  <td className="px-4 py-2.5 text-zinc-400 max-w-[200px] truncate">{e.reason}</td>
                  <td className="px-4 py-2.5 text-zinc-500 text-xs">{typeLabels[e.entryType] ?? e.entryType}</td>
                  <td className="px-4 py-2.5 text-zinc-500 text-xs">{e.officerName}</td>
                  <td className="px-4 py-2.5">
                    <span className={`text-xs px-1.5 py-0.5 rounded ${e.source === "web" ? "bg-blue-900/40 text-blue-400" : "bg-zinc-800 text-zinc-500"}`}>
                      {e.source}
                    </span>
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
