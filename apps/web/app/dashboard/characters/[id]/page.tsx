import Image from "next/image";
import Link from "next/link";
import { apiFetch } from "@/lib/api";
import { notFound } from "next/navigation";

interface RioRun {
  dungeon: string;
  short_name: string;
  mythic_level: number;
  clear_time_ms: number;
  par_time_ms: number;
  num_keystone_upgrades: number;
  score: number;
}

interface RioProfile {
  mythic_plus_scores_by_season: { season: string; scores: { all: number } }[];
  mythic_plus_best_runs: RioRun[];
}

interface EquipmentSlot {
  slot: string;
  itemId: number;
  itemName: string | null;
  itemLevel: number;
  quality: string | null;
  iconUrl: string | null;
}

interface CharacterDetail {
  id: string;
  name: string;
  class: string;
  level: number;
  itemLevel: number;
  mPlusScore: number;
  guildRank: number;
  realm: string;
  guild: { id: string; name: string; realm: string } | null;
  equipment: EquipmentSlot[];
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

const qualityColors: Record<string, string> = {
  POOR: "text-zinc-500 border-zinc-700",
  COMMON: "text-zinc-200 border-zinc-600",
  UNCOMMON: "text-green-400 border-green-700",
  RARE: "text-blue-400 border-blue-700",
  EPIC: "text-purple-400 border-purple-700",
  LEGENDARY: "text-orange-400 border-orange-700",
  ARTIFACT: "text-indigo-300 border-indigo-700",
};

const slotOrder = [
  "HEAD", "NECK", "SHOULDER", "BACK", "CHEST", "WRIST",
  "HANDS", "WAIST", "LEGS", "FEET",
  "FINGER_1", "FINGER_2", "TRINKET_1", "TRINKET_2",
  "MAIN_HAND", "OFF_HAND",
];

const slotLabel: Record<string, string> = {
  HEAD: "Kopf",
  NECK: "Hals",
  SHOULDER: "Schulter",
  BACK: "Rücken",
  CHEST: "Brust",
  WRIST: "Handgelenk",
  HANDS: "Hände",
  WAIST: "Gürtel",
  LEGS: "Beine",
  FEET: "Füße",
  FINGER_1: "Ring 1",
  FINGER_2: "Ring 2",
  TRINKET_1: "Schmuckstück 1",
  TRINKET_2: "Schmuckstück 2",
  MAIN_HAND: "Haupthand",
  OFF_HAND: "Nebenhand",
};

export default async function CharacterPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const char = await apiFetch<CharacterDetail>(`/characters/${id}`).catch(() => null);
  if (!char) notFound();

  const rioProfile = await fetch(
    `https://raider.io/api/v1/characters/profile?region=eu&realm=${encodeURIComponent(char.realm)}&name=${encodeURIComponent(char.name)}&fields=mythic_plus_scores_by_season:current,mythic_plus_best_runs`,
    { next: { revalidate: 300 } },
  )
    .then((r) => (r.ok ? (r.json() as Promise<RioProfile>) : null))
    .catch(() => null);

  const rioScore =
    rioProfile?.mythic_plus_scores_by_season?.[0]?.scores?.all ?? null;

  const equipMap = Object.fromEntries(char.equipment.map((e) => [e.slot, e]));
  const colorClass = classColors[char.class] ?? "text-zinc-100";

  return (
    <div>
      <div className="mb-6">
        <Link
          href="/dashboard"
          className="text-zinc-500 hover:text-zinc-300 text-sm transition-colors"
        >
          ← Übersicht
        </Link>
      </div>

      {/* Header */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 mb-6">
        <div className="flex items-baseline gap-3 mb-1">
          <h1 className={`text-3xl font-bold ${colorClass}`}>{char.name}</h1>
          <span className="text-zinc-500 text-sm">{char.realm}</span>
        </div>
        <p className="text-zinc-400 capitalize mb-4">{char.class.replace(/_/g, " ")}</p>

        <div className="flex flex-wrap gap-6 text-sm">
          <div>
            <p className="text-zinc-500 text-xs uppercase tracking-wider">Level</p>
            <p className="text-xl font-semibold mt-0.5">{char.level}</p>
          </div>
          <div>
            <p className="text-zinc-500 text-xs uppercase tracking-wider">Item-Level</p>
            <p className="text-xl font-semibold mt-0.5">
              {char.itemLevel > 0 ? char.itemLevel : "–"}
            </p>
          </div>
          {char.mPlusScore > 0 && (
            <div>
              <p className="text-zinc-500 text-xs uppercase tracking-wider">M+ Score</p>
              <p className="text-xl font-semibold mt-0.5">{char.mPlusScore}</p>
            </div>
          )}
          {char.guild && (
            <div>
              <p className="text-zinc-500 text-xs uppercase tracking-wider">Gilde</p>
              <p className="text-xl font-semibold mt-0.5">{char.guild.name}</p>
            </div>
          )}
        </div>
      </div>

      {/* Equipment */}
      <h2 className="text-sm font-semibold text-zinc-500 uppercase tracking-wider mb-3">
        Ausrüstung
      </h2>

      {char.equipment.length === 0 ? (
        <p className="text-zinc-600 text-sm">
          Noch keine Ausrüstungsdaten — nach dem nächsten Sync verfügbar.
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {slotOrder.map((slot) => {
            const item = equipMap[slot];
            const qColors = qualityColors[item?.quality ?? ""] ?? "text-zinc-600 border-zinc-800";
            return (
              <div
                key={slot}
                className={`bg-zinc-900 border rounded-lg px-3 py-2.5 flex items-center gap-3 ${
                  item ? "border-zinc-800" : "border-zinc-900 opacity-40"
                }`}
              >
                {/* Icon */}
                <div className="w-10 h-10 shrink-0 rounded overflow-hidden bg-zinc-800 border border-zinc-700">
                  {item?.iconUrl ? (
                    <Image
                      src={item.iconUrl}
                      alt={item.itemName ?? slot}
                      width={40}
                      height={40}
                      className="w-full h-full object-cover"
                      unoptimized
                    />
                  ) : (
                    <div className="w-full h-full" />
                  )}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-zinc-500">{slotLabel[slot] ?? slot}</p>
                  {item ? (
                    <>
                      <p className={`text-sm font-medium truncate ${qColors.split(" ")[0]}`}>
                        {item.itemName ?? "Unbekanntes Item"}
                      </p>
                    </>
                  ) : (
                    <p className="text-sm text-zinc-700">—</p>
                  )}
                </div>

                {/* ilvl */}
                {item && (
                  <span className="text-xs font-semibold text-zinc-300 shrink-0">
                    {item.itemLevel}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
      {/* Mythic+ */}
      <h2 className="text-sm font-semibold text-zinc-500 uppercase tracking-wider mt-8 mb-3">
        Mythic+
      </h2>

      {rioProfile === null ? (
        <p className="text-zinc-600 text-sm">Keine Raider.IO-Daten gefunden.</p>
      ) : rioProfile.mythic_plus_best_runs.length === 0 ? (
        <p className="text-zinc-600 text-sm">Noch keine M+-Läufe in dieser Season.</p>
      ) : (
        <>
          {rioScore !== null && (
            <p className="text-zinc-400 text-sm mb-3">
              Season-Score:{" "}
              <span className="font-semibold text-zinc-100">{Math.round(rioScore)}</span>
            </p>
          )}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
            {rioProfile.mythic_plus_best_runs.map((run) => {
              const upgrades = run.num_keystone_upgrades;
              const inTime = upgrades > 0;
              const upgradeLabel = upgrades >= 3 ? "+3" : upgrades === 2 ? "+2" : upgrades === 1 ? "+1" : "–";
              const timedColor = upgrades >= 2 ? "text-green-400" : upgrades === 1 ? "text-yellow-400" : "text-red-400";
              return (
                <div
                  key={run.dungeon}
                  className="bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2.5"
                >
                  <p className="text-zinc-500 text-xs truncate mb-0.5">{run.short_name}</p>
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-lg font-bold">+{run.mythic_level}</span>
                    <span className={`text-sm font-semibold ${timedColor}`}>{upgradeLabel}</span>
                  </div>
                  <p className="text-zinc-500 text-xs mt-0.5">{Math.round(run.score)} Pkt.</p>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
