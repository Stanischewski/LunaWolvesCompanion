import { apiFetch } from "@/lib/api";

interface Guild {
  id: string;
  name: string;
  realm: string;
}

interface StatsResponse {
  totalMembers: number;
  avgItemLevel: number;
  activeMembers7d: number;
  activityByDay: { day: string; events: number }[];
  ilvlDistribution: { bucket: number; count: number }[];
}

function BarChart({
  data,
  keyField,
  valueField,
  color,
  labelFormatter,
}: {
  data: Record<string, number | string>[];
  keyField: string;
  valueField: string;
  color: string;
  labelFormatter?: (val: string | number) => string;
}) {
  const maxVal = Math.max(...data.map((d) => Number(d[valueField])), 1);
  return (
    <div className="space-y-1.5">
      {data.map((d, i) => {
        const pct = (Number(d[valueField]) / maxVal) * 100;
        const label = labelFormatter ? labelFormatter(d[keyField]) : String(d[keyField]);
        return (
          <div key={i} className="flex items-center gap-3">
            <span className="text-xs text-zinc-500 w-20 shrink-0 text-right">{label}</span>
            <div className="flex-1 h-4 bg-zinc-800 rounded overflow-hidden">
              <div className={`h-full rounded ${color}`} style={{ width: `${pct}%` }} />
            </div>
            <span className="text-xs text-zinc-400 w-8 text-right tabular-nums">
              {d[valueField]}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export default async function StatsPage() {
  let guild: Guild | null = null;
  let stats: StatsResponse | null = null;

  try {
    const player = await apiFetch<{ characters: { guild: Guild | null }[] }>("/players/me").catch(() => null);
    const guildFromPlayer = player?.characters.find((c) => c.guild)?.guild ?? null;

    if (guildFromPlayer) {
      guild = guildFromPlayer;
    } else {
      const guilds = await apiFetch<Guild[]>("/guilds");
      if (guilds.length > 0) guild = guilds[0];
    }

    if (guild) {
      stats = await apiFetch<StatsResponse>(`/guilds/${guild.id}/stats`);
    }
  } catch {}

  if (!guild) {
    return (
      <div>
        <h1 className="text-2xl font-bold mb-6">Statistiken</h1>
        <p className="text-zinc-500">Noch keine Gilde eingerichtet.</p>
      </div>
    );
  }

  if (!stats) {
    return (
      <div>
        <h1 className="text-2xl font-bold mb-6">Statistiken</h1>
        <p className="text-zinc-500">Statistiken konnten nicht geladen werden.</p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-baseline gap-3 mb-6">
        <h1 className="text-2xl font-bold">Statistiken</h1>
        <span className="text-zinc-500 text-sm">
          {guild.name} – {guild.realm}
        </span>
      </div>

      {/* KPI-Karten */}
      <div className="grid grid-cols-3 gap-4 mb-8">
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
          <p className="text-zinc-500 text-xs uppercase tracking-wider">Mitglieder</p>
          <p className="text-3xl font-bold mt-1">{stats.totalMembers}</p>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
          <p className="text-zinc-500 text-xs uppercase tracking-wider">Ø Item-Level</p>
          <p className="text-3xl font-bold mt-1">{stats.avgItemLevel}</p>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
          <p className="text-zinc-500 text-xs uppercase tracking-wider">Aktiv (7 Tage)</p>
          <p className="text-3xl font-bold mt-1 text-emerald-400">{stats.activeMembers7d}</p>
        </div>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-2 gap-6">
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-5">
          <h2 className="text-sm font-semibold text-zinc-300 mb-4">Aktivität (letzte 7 Tage)</h2>
          {stats.activityByDay.length === 0 ? (
            <p className="text-xs text-zinc-600">Noch keine Aktivitätsdaten.</p>
          ) : (
            <BarChart
              data={stats.activityByDay as unknown as Record<string, number | string>[]}
              keyField="day"
              valueField="events"
              color="bg-violet-600"
              labelFormatter={(v) =>
                new Date(String(v)).toLocaleDateString("de-DE", { weekday: "short", day: "numeric" })
              }
            />
          )}
        </div>

        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-5">
          <h2 className="text-sm font-semibold text-zinc-300 mb-4">ilvl-Verteilung</h2>
          {stats.ilvlDistribution.length === 0 ? (
            <p className="text-xs text-zinc-600">Noch keine Charakterdaten.</p>
          ) : (
            <BarChart
              data={stats.ilvlDistribution as unknown as Record<string, number | string>[]}
              keyField="bucket"
              valueField="count"
              color="bg-emerald-600"
              labelFormatter={(v) => `${v}+`}
            />
          )}
        </div>
      </div>
    </div>
  );
}
