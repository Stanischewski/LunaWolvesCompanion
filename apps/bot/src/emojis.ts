import type { Client } from "discord.js";
import { config } from "./config.js";

// Text-Fallbacks falls keine custom Emojis hochgeladen wurden
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

// Erwartet Emojis mit Namen wie "class_warrior", "class_death_knight" etc.
export function loadClassEmojis(client: Client<true>): void {
  const guild = client.guilds.cache.get(config.guildId);
  if (!guild) return;

  let loaded = 0;
  for (const emoji of guild.emojis.cache.values()) {
    if (!emoji.name?.startsWith("class_")) continue;
    const className = emoji.name.slice(6); // "class_" entfernen
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
