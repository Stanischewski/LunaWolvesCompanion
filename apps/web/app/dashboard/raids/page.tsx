import { apiFetch } from "@/lib/api";

interface Guild {
  id: string;
  name: string;
}

interface RaidEvent {
  id: string;
  title: string;
  scheduledAt: string;
  raidType: string | null;
  minIlvl: number | null;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("de-DE", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default async function RaidsPage() {
  let guild: Guild | null = null;
  let raids: RaidEvent[] = [];

  try {
    const guilds = await apiFetch<Guild[]>("/guilds");
    if (guilds.length > 0) {
      guild = guilds[0];
      raids = await apiFetch<RaidEvent[]>(`/guilds/${guild.id}/raids`);
    }
  } catch {}

  const now = new Date();
  const upcoming = raids.filter((r) => new Date(r.scheduledAt) >= now);
  const past = raids.filter((r) => new Date(r.scheduledAt) < now);

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Raids</h1>

      {!guild ? (
        <p className="text-zinc-500">Noch keine Gilde eingerichtet.</p>
      ) : raids.length === 0 ? (
        <p className="text-zinc-500">Keine Raid-Events geplant.</p>
      ) : (
        <div className="space-y-8">
          {upcoming.length > 0 && (
            <section>
              <h2 className="text-sm font-semibold text-zinc-500 uppercase tracking-wider mb-3">
                Kommende Raids ({upcoming.length})
              </h2>
              <div className="space-y-2">
                {upcoming.map((raid) => (
                  <div
                    key={raid.id}
                    className="bg-zinc-900 border border-zinc-800 rounded-lg px-4 py-3 flex items-center justify-between"
                  >
                    <div>
                      <p className="font-semibold">{raid.title}</p>
                      <p className="text-zinc-400 text-sm">{formatDate(raid.scheduledAt)}</p>
                    </div>
                    <div className="text-right text-sm text-zinc-500 space-y-0.5">
                      {raid.raidType && <p>{raid.raidType}</p>}
                      {raid.minIlvl && <p>min {raid.minIlvl} ilvl</p>}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}
          {past.length > 0 && (
            <section>
              <h2 className="text-sm font-semibold text-zinc-500 uppercase tracking-wider mb-3">
                Vergangene Raids ({past.length})
              </h2>
              <div className="space-y-2 opacity-60">
                {past.map((raid) => (
                  <div
                    key={raid.id}
                    className="bg-zinc-900 border border-zinc-800 rounded-lg px-4 py-3 flex items-center justify-between"
                  >
                    <div>
                      <p className="font-medium">{raid.title}</p>
                      <p className="text-zinc-500 text-sm">{formatDate(raid.scheduledAt)}</p>
                    </div>
                    <div className="text-right text-sm text-zinc-600">
                      {raid.raidType && <p>{raid.raidType}</p>}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
