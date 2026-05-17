import { apiFetch } from "@/lib/api";

interface Guild {
  id: string;
  name: string;
}

interface Member {
  id: string;
  name: string;
  class: string;
  level: number;
  itemLevel: number;
  mPlusScore: number;
  guildRank: number;
  lastLogin: string | null;
}

const CLASS_NAMES: Record<string, string> = {
  warrior: "Krieger", paladin: "Paladin", hunter: "Jäger", rogue: "Schurke",
  priest: "Priester", shaman: "Schamane", mage: "Magier", warlock: "Hexenmeister",
  monk: "Mönch", druid: "Druide", demon_hunter: "Dämonenjäger",
  death_knight: "Todesritter", evoker: "Rufer",
};

const CLASS_COLORS: Record<string, string> = {
  warrior: "text-amber-500", paladin: "text-pink-400", hunter: "text-green-400",
  rogue: "text-yellow-400", priest: "text-zinc-100", shaman: "text-blue-400",
  mage: "text-cyan-400", warlock: "text-purple-400", monk: "text-emerald-400",
  druid: "text-orange-400", demon_hunter: "text-violet-400",
  death_knight: "text-red-500", evoker: "text-teal-400",
};

function cmp(v1: number, v2: number, higherBetter = true) {
  if (v1 === v2) return { icon: "—", color: "text-zinc-500" };
  const wins = higherBetter ? v1 > v2 : v1 < v2;
  return wins
    ? { icon: "✅", color: "text-emerald-400" }
    : { icon: "❌", color: "text-red-400" };
}

function StatRow({
  label,
  vA,
  vB,
  higherBetter = true,
  format,
}: {
  label: string;
  vA: number;
  vB: number;
  higherBetter?: boolean;
  format?: (v: number) => string;
}) {
  const fmt = format ?? String;
  const rA = cmp(vA, vB, higherBetter);
  const rB = cmp(vB, vA, higherBetter);
  return (
    <tr className="border-b border-zinc-800">
      <td className={`px-4 py-2 text-right font-medium ${rA.color}`}>
        {rA.icon} {fmt(vA)}
      </td>
      <td className="px-4 py-2 text-center text-xs text-zinc-500 uppercase tracking-wider">
        {label}
      </td>
      <td className={`px-4 py-2 text-left font-medium ${rB.color}`}>
        {fmt(vB)} {rB.icon}
      </td>
    </tr>
  );
}

export default async function ComparePage({
  searchParams,
}: {
  searchParams: Promise<{ a?: string; b?: string }>;
}) {
  const { a: nameA, b: nameB } = await searchParams;

  let memberA: Member | null = null;
  let memberB: Member | null = null;
  let allMembers: Member[] = [];

  try {
    const guilds = await apiFetch<Guild[]>("/guilds");
    if (guilds.length > 0) {
      allMembers = await apiFetch<Member[]>(`/guilds/${guilds[0].id}/members`);
      if (nameA) memberA = allMembers.find((m) => m.name.toLowerCase() === nameA.toLowerCase()) ?? null;
      if (nameB) memberB = allMembers.find((m) => m.name.toLowerCase() === nameB.toLowerCase()) ?? null;
    }
  } catch {}

  const hasSearch = nameA || nameB;

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Spieler-Vergleich</h1>

      {/* Suche */}
      <form className="flex gap-3 mb-8" method="GET">
        <div className="flex-1">
          <label className="block text-xs text-zinc-500 mb-1">Charakter A</label>
          <input
            name="a"
            defaultValue={nameA}
            placeholder="Charaktername…"
            list="members-list"
            className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-violet-500"
          />
        </div>
        <div className="flex-1">
          <label className="block text-xs text-zinc-500 mb-1">Charakter B</label>
          <input
            name="b"
            defaultValue={nameB}
            placeholder="Charaktername…"
            list="members-list"
            className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-violet-500"
          />
        </div>
        <div className="flex items-end">
          <button
            type="submit"
            className="bg-violet-600 hover:bg-violet-500 text-white text-sm px-4 py-2 rounded transition-colors"
          >
            Vergleichen
          </button>
        </div>
        <datalist id="members-list">
          {allMembers.map((m) => (
            <option key={m.id} value={m.name} />
          ))}
        </datalist>
      </form>

      {/* Ergebnis */}
      {hasSearch && (!memberA || !memberB) && (
        <p className="text-zinc-500 text-sm">
          {!memberA && nameA && `Charakter "${nameA}" nicht gefunden. `}
          {!memberB && nameB && `Charakter "${nameB}" nicht gefunden.`}
        </p>
      )}

      {memberA && memberB && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-700 bg-zinc-800/50">
                <th className="px-4 py-3 text-right">
                  <span className={`font-bold text-base ${CLASS_COLORS[memberA.class] ?? "text-zinc-100"}`}>
                    {memberA.name}
                  </span>
                  <p className="text-xs text-zinc-500 font-normal">
                    {CLASS_NAMES[memberA.class] ?? memberA.class}
                  </p>
                </th>
                <th className="px-4 py-3 text-center w-32" />
                <th className="px-4 py-3 text-left">
                  <span className={`font-bold text-base ${CLASS_COLORS[memberB.class] ?? "text-zinc-100"}`}>
                    {memberB.name}
                  </span>
                  <p className="text-xs text-zinc-500 font-normal">
                    {CLASS_NAMES[memberB.class] ?? memberB.class}
                  </p>
                </th>
              </tr>
            </thead>
            <tbody>
              <StatRow label="Item-Level" vA={memberA.itemLevel} vB={memberB.itemLevel} />
              <StatRow label="M+ Score" vA={memberA.mPlusScore ?? 0} vB={memberB.mPlusScore ?? 0} />
              <StatRow label="Level" vA={memberA.level} vB={memberB.level} />
              <StatRow
                label="Gildenrang"
                vA={memberA.guildRank}
                vB={memberB.guildRank}
                higherBetter={false}
                format={(v) => `Rang ${v}`}
              />
            </tbody>
          </table>
        </div>
      )}

      {!hasSearch && (
        <p className="text-zinc-500 text-sm">
          Tipp: Auch per Discord verfügbar — <code className="text-zinc-400">/player compare</code>
        </p>
      )}
    </div>
  );
}
