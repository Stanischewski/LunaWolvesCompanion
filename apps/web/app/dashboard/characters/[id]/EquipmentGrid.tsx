"use client";

import { useState } from "react";
import Image from "next/image";

export interface EquipmentSlot {
  slot: string;
  itemId: number;
  itemName: string | null;
  itemLevel: number;
  quality: string | null;
  iconUrl: string | null;
  itemSubclass: string | null;
  stats: Array<{ name: string; value: number }> | null;
  enchantments: string[] | null;
  gems: Array<{ name: string | null; stat: string | null }> | null;
  setBonus: {
    name: string;
    effects: Array<{ count: number; text: string; active: boolean }>;
  } | null;
}

const slotOrder = [
  "HEAD", "NECK", "SHOULDER", "BACK", "CHEST", "WRIST",
  "HANDS", "WAIST", "LEGS", "FEET",
  "FINGER_1", "FINGER_2", "TRINKET_1", "TRINKET_2",
  "MAIN_HAND", "OFF_HAND",
];

const slotLabel: Record<string, string> = {
  HEAD: "Kopf", NECK: "Hals", SHOULDER: "Schulter", BACK: "Rücken",
  CHEST: "Brust", WRIST: "Handgelenk", HANDS: "Hände", WAIST: "Gürtel",
  LEGS: "Beine", FEET: "Füße", FINGER_1: "Ring 1", FINGER_2: "Ring 2",
  TRINKET_1: "Schmuckstück 1", TRINKET_2: "Schmuckstück 2",
  MAIN_HAND: "Haupthand", OFF_HAND: "Nebenhand",
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

function ItemTooltip({ item, slot, side }: { item: EquipmentSlot; slot: string; side: "left" | "right" }) {
  const qColor = (qualityColors[item.quality ?? ""] ?? "text-zinc-300 border-zinc-700").split(" ")[0];
  const hasDetails =
    (item.stats?.length ?? 0) > 0 ||
    (item.enchantments?.length ?? 0) > 0 ||
    (item.gems?.length ?? 0) > 0 ||
    item.setBonus != null;

  return (
    <div
      className={`absolute top-0 z-50 w-80 bg-zinc-950 border border-zinc-700 rounded-lg p-3 shadow-2xl pointer-events-none ${
        side === "right" ? "left-full ml-2" : "right-full mr-2"
      }`}
    >
      {/* Name + meta */}
      <p className={`font-semibold text-sm leading-tight ${qColor}`}>{item.itemName ?? "Unbekanntes Item"}</p>
      <p className="text-xs text-zinc-500 mt-0.5">
        {slotLabel[slot] ?? slot}
        {item.itemSubclass && ` · ${item.itemSubclass}`}
        <span className="text-zinc-400 font-medium"> · {item.itemLevel}</span>
      </p>

      {!hasDetails && (
        <p className="text-xs text-zinc-600 mt-2 italic">Detaildaten nach nächstem Sync verfügbar</p>
      )}

      {/* Stats */}
      {(item.stats?.length ?? 0) > 0 && (
        <div className="mt-2 pt-2 border-t border-zinc-800 space-y-0.5">
          {item.stats!.map((stat, i) => (
            <p key={i} className="text-xs text-zinc-300">
              +{stat.value.toLocaleString("de-DE")} {stat.name}
            </p>
          ))}
        </div>
      )}

      {/* Gems */}
      {(item.gems?.length ?? 0) > 0 && (
        <div className="mt-2 pt-2 border-t border-zinc-800 space-y-1">
          {item.gems!.map((gem, i) => (
            <div key={i} className="flex items-start gap-1.5">
              <span className={`text-xs mt-px shrink-0 ${gem.name ? "text-yellow-400" : "text-zinc-600"}`}>◆</span>
              <div className="min-w-0">
                <span className={`text-xs ${gem.name ? "text-yellow-200" : "text-zinc-600 italic"}`}>
                  {gem.name ?? "Leerer Sockel"}
                </span>
                {gem.stat && (
                  <p className="text-xs text-zinc-400 mt-px">{gem.stat}</p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Enchantments (includes embellishments from Blizzard API) */}
      {(item.enchantments?.length ?? 0) > 0 && (
        <div className="mt-2 pt-2 border-t border-zinc-800 space-y-0.5">
          {item.enchantments!.map((enc, i) => (
            <p key={i} className="text-xs text-teal-300 flex items-start gap-1.5 leading-tight">
              <span className="mt-px shrink-0">✦</span>
              <span>{enc}</span>
            </p>
          ))}
        </div>
      )}

      {/* Set bonus */}
      {item.setBonus && (
        <div className="mt-2 pt-2 border-t border-zinc-800">
          <p className="text-xs font-semibold text-amber-400 mb-1">{item.setBonus.name}</p>
          <div className="space-y-1">
            {item.setBonus.effects.map((effect, i) => (
              <p
                key={i}
                className={`text-xs leading-tight ${
                  effect.active ? "text-amber-200" : "text-zinc-600"
                }`}
              >
                {effect.text}
              </p>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function EquipmentGrid({ equipment }: { equipment: EquipmentSlot[] }) {
  const [hovered, setHovered] = useState<string | null>(null);
  const equipMap = Object.fromEntries(equipment.map((e) => [e.slot, e]));

  return (
    <div className="grid grid-cols-2 gap-2">
      {slotOrder.map((slot, idx) => {
        const item = equipMap[slot];
        const qColors = qualityColors[item?.quality ?? ""] ?? "text-zinc-600 border-zinc-800";
        const isHovered = hovered === slot;
        const side = idx % 2 === 0 ? "right" : "left";

        return (
          <div
            key={slot}
            className={`relative bg-zinc-900 border rounded-lg px-3 py-2.5 flex items-center gap-3 ${
              item ? "border-zinc-800 cursor-default" : "border-zinc-900 opacity-40"
            }`}
            onMouseEnter={() => item && setHovered(slot)}
            onMouseLeave={() => setHovered(null)}
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
                <p className={`text-sm font-medium truncate ${qColors.split(" ")[0]}`}>
                  {item.itemName ?? "Unbekanntes Item"}
                </p>
              ) : (
                <p className="text-sm text-zinc-700">—</p>
              )}
            </div>

            {/* ilvl + indicators */}
            {item && (
              <div className="flex flex-col items-end gap-0.5 shrink-0">
                <span className="text-xs font-semibold text-zinc-300">{item.itemLevel}</span>
                <div className="flex gap-0.5">
                  {(item.gems?.some((g) => g.name) ?? false) && (
                    <span className="text-yellow-400 text-xs leading-none">◆</span>
                  )}
                  {(item.enchantments?.length ?? 0) > 0 && (
                    <span className="text-teal-400 text-xs leading-none">✦</span>
                  )}
                  {item.setBonus && (
                    <span className="text-amber-400 text-xs leading-none">⬡</span>
                  )}
                </div>
              </div>
            )}

            {/* Tooltip */}
            {isHovered && item && (
              <ItemTooltip item={item} slot={slot} side={side} />
            )}
          </div>
        );
      })}
    </div>
  );
}
