import type { Client } from "discord.js";

const TEXT_FALLBACK: Record<string, string> = {
  warrior: "⚔️",
  paladin: "🛡️",
  hunter: "🏹",
  rogue: "🗡️",
  priest: "✨",
  shaman: "⚡",
  mage: "❄️",
  warlock: "🌑",
  monk: "🥋",
  druid: "🌿",
  demon_hunter: "👁️",
  death_knight: "☠️",
  evoker: "🐉",
};

const customEmojis: Record<string, string> = {};

// Erwartet Application-Emojis mit Namen wie "class_warrior", "class_death_knight" etc.
export async function loadClassEmojis(client: Client<true>): Promise<void> {
  try {
    await client.application.emojis.fetch();
  } catch (err) {
    console.warn("[Emojis] Application-Emojis konnten nicht geladen werden:", err);
    return;
  }

  let loaded = 0;
  for (const emoji of client.application.emojis.cache.values()) {
    if (!emoji.name?.startsWith("class_")) continue;
    const className = emoji.name.slice(6);
    customEmojis[className] = emoji.animated
      ? `<a:${emoji.name}:${emoji.id}>`
      : `<:${emoji.name}:${emoji.id}>`;
    loaded++;
  }

  if (loaded > 0) {
    console.log(`✓ ${loaded} Klassen-Emojis geladen`);
  }
}

export function classEmoji(className: string): string {
  return customEmojis[className] ?? TEXT_FALLBACK[className] ?? "❓";
}
