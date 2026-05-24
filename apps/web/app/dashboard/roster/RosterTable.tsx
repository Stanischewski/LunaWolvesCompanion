"use client";

import { useState } from "react";
import Link from "next/link";
import { ClassIcon } from "../components/ClassIcon";

type SortKey = "guildRank" | "itemLevel" | "mPlusScore" | "name" | "class" | "level" | "player";

interface Member {
  id: string;
  name: string;
  realm: string;
  class: string;
  level: number;
  itemLevel: number;
  mPlusScore: number;
  guildRank: number;
  player: { bnetTag: string; displayName: string | null } | null;
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

const classOrder: Record<string, number> = {
  death_knight: 0, demon_hunter: 1, druid: 2, evoker: 3, hunter: 4,
  mage: 5, monk: 6, paladin: 7, priest: 8, rogue: 9,
  shaman: 10, warlock: 11, warrior: 12,
};

function sorted(members: Member[], key: SortKey): Member[] {
  return [...members].sort((a, b) => {
    switch (key) {
      case "guildRank":
        return a.guildRank - b.guildRank || b.itemLevel - a.itemLevel;
      case "itemLevel":
        return b.itemLevel - a.itemLevel;
      case "mPlusScore":
        return b.mPlusScore - a.mPlusScore;
      case "name":
        return a.name.localeCompare(b.name);
      case "class":
        return (classOrder[a.class] ?? 99) - (classOrder[b.class] ?? 99) || a.name.localeCompare(b.name);
      case "level":
        return b.level - a.level || b.itemLevel - a.itemLevel;
      case "player": {
        const pa = a.player?.displayName ?? "";
        const pb = b.player?.displayName ?? "";
        return pa.localeCompare(pb) || a.name.localeCompare(b.name);
      }
    }
  });
}

export function RosterTable({
  members,
  classIcons = {},
}: {
  members: Member[];
  classIcons?: Record<string, string>;
}) {
  const [sortKey, setSortKey] = useState<SortKey>("guildRank");

  function SortTh({
    k,
    label,
    align = "text-right",
  }: {
    k: SortKey;
    label: string;
    align?: string;
  }) {
    const active = sortKey === k;
    return (
      <th
        className={`px-4 py-3 ${align} cursor-pointer select-none text-xs uppercase tracking-wider transition-colors ${
          active ? "text-indigo-400" : "text-zinc-500 hover:text-zinc-300"
        }`}
        onClick={() => setSortKey(k)}
      >
        {label}
        {active && <span className="ml-1 opacity-60">↓</span>}
      </th>
    );
  }

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-zinc-800">
            <SortTh k="name" label="Name" align="text-left" />
            <SortTh k="class" label="Klasse" align="text-left" />
            <SortTh k="level" label="Level" />
            <SortTh k="itemLevel" label="ilvl" />
            <SortTh k="mPlusScore" label="M+" />
            <SortTh k="player" label="Spieler" align="text-left" />
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-800">
          {sorted(members, sortKey).map((char) => (
            <tr key={char.id} className="hover:bg-zinc-800/50 transition-colors">
              <td className={`px-4 py-3 font-medium ${classColors[char.class] ?? "text-zinc-100"}`}>
                <Link
                  href={`/dashboard/characters/${char.id}`}
                  className="hover:underline underline-offset-2"
                >
                  {char.name}
                  <span className="text-zinc-600 font-normal">-{char.realm}</span>
                </Link>
              </td>
              <td className="px-4 py-3 text-zinc-400 capitalize">
                <span className="flex items-center gap-1.5">
                  <ClassIcon className={char.class} iconUrl={classIcons[char.class]} />
                  {char.class.replace(/_/g, " ")}
                </span>
              </td>
              <td className="px-4 py-3 text-right text-zinc-400">{char.level}</td>
              <td className="px-4 py-3 text-right text-zinc-300 font-medium">
                {char.itemLevel > 0 ? char.itemLevel : "–"}
              </td>
              <td className="px-4 py-3 text-right text-zinc-400">
                {char.mPlusScore > 0 ? char.mPlusScore : "–"}
              </td>
              <td className="px-4 py-3 text-zinc-400">
                {char.player?.displayName ?? ""}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
