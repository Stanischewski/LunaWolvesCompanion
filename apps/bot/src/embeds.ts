import { EmbedBuilder } from "discord.js";
import type { GuildInfo, MemberCharacter, RaidEvent } from "./api.js";

export const GUILD_COLOR = 0x7c3aed;

const CLASS_EMOJI: Record<string, string> = {
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

const CLASS_NAMES: Record<string, string> = {
  warrior: "Krieger",
  paladin: "Paladin",
  hunter: "Jäger",
  rogue: "Schurke",
  priest: "Priester",
  shaman: "Schamane",
  mage: "Magier",
  warlock: "Hexenmeister",
  monk: "Mönch",
  druid: "Druide",
  demon_hunter: "Dämonenjäger",
  death_knight: "Todesritter",
  evoker: "Rufer",
};

function ts(iso: string): string {
  return `<t:${Math.floor(new Date(iso).getTime() / 1000)}:F>`;
}

function tsRel(iso: string): string {
  return `<t:${Math.floor(new Date(iso).getTime() / 1000)}:R>`;
}

export function guildStatusEmbed(guild: GuildInfo): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(GUILD_COLOR)
    .setTitle(`🐺 ${guild.name} — ${guild.realm}`)
    .addFields(
      {
        name: "Fraktion",
        value: guild.faction === "horde" ? "🔴 Horde" : "🔵 Allianz",
        inline: true,
      },
      { name: "Mitglieder", value: String(guild.memberCount), inline: true },
    )
    .setTimestamp();
}

export function rosterEmbed(guild: GuildInfo, members: MemberCharacter[]): EmbedBuilder {
  const sorted = [...members].sort((a, b) => b.itemLevel - a.itemLevel);
  const lines = sorted.slice(0, 20).map((m, i) => {
    const emoji = CLASS_EMOJI[m.class] ?? "❓";
    const cls = CLASS_NAMES[m.class] ?? m.class;
    return `\`${String(i + 1).padStart(2, " ")}\` ${emoji} **${m.name}** — ${cls}, ${m.itemLevel} ilvl`;
  });
  return new EmbedBuilder()
    .setColor(GUILD_COLOR)
    .setTitle(`📋 Mitgliederliste — ${guild.name}`)
    .setDescription(lines.join("\n") || "Keine Mitglieder gefunden.")
    .setFooter({
      text: `${members.length} Mitglieder gesamt${members.length > 20 ? " · Zeige Top 20" : ""}`,
    })
    .setTimestamp();
}

export function activityEmbed(guild: GuildInfo, members: MemberCharacter[]): EmbedBuilder {
  const recent = [...members]
    .filter((m) => m.lastLogin)
    .sort((a, b) => new Date(b.lastLogin).getTime() - new Date(a.lastLogin).getTime())
    .slice(0, 15);
  const lines = recent.map((m) => {
    const emoji = CLASS_EMOJI[m.class] ?? "❓";
    return `${emoji} **${m.name}** — zuletzt ${tsRel(m.lastLogin)}`;
  });
  return new EmbedBuilder()
    .setColor(GUILD_COLOR)
    .setTitle(`🕐 Letzte Aktivität — ${guild.name}`)
    .setDescription(lines.join("\n") || "Keine Aktivitätsdaten vorhanden.")
    .setTimestamp();
}

export function playerEmbed(member: MemberCharacter): EmbedBuilder {
  const emoji = CLASS_EMOJI[member.class] ?? "❓";
  const cls = CLASS_NAMES[member.class] ?? member.class;
  return new EmbedBuilder()
    .setColor(GUILD_COLOR)
    .setTitle(`${emoji} ${member.name} — ${member.realm}`)
    .addFields(
      { name: "Klasse", value: cls, inline: true },
      { name: "Level", value: String(member.level), inline: true },
      { name: "Item-Level", value: String(member.itemLevel), inline: true },
      { name: "M+ Score", value: String(member.mPlusScore ?? 0), inline: true },
      { name: "Gildenrang", value: String(member.guildRank), inline: true },
      {
        name: "Letzte Aktivität",
        value: member.lastLogin ? tsRel(member.lastLogin) : "—",
        inline: true,
      },
    )
    .setTimestamp();
}

export function raidListEmbed(raids: RaidEvent[]): EmbedBuilder {
  const upcoming = raids.filter((r) => new Date(r.scheduledAt) > new Date());
  const lines = upcoming.slice(0, 10).map((r) => {
    const type = r.raidType ? ` (${r.raidType})` : "";
    const minIlvl = r.minIlvl ? ` · min. ${r.minIlvl} ilvl` : "";
    return `**${r.title}**${type}\n${ts(r.scheduledAt)}${minIlvl}`;
  });
  return new EmbedBuilder()
    .setColor(GUILD_COLOR)
    .setTitle("📅 Anstehende Raids")
    .setDescription(lines.join("\n\n") || "Keine Raids geplant.")
    .setTimestamp();
}

export function raidRosterEmbed(raid: RaidEvent): EmbedBuilder {
  const signups = raid.signups ?? [];
  const tanks = signups
    .filter((s) => s.role === "tank" && s.status !== "no")
    .map((s) => s.character?.name ?? "?");
  const heals = signups
    .filter((s) => s.role === "heal" && s.status !== "no")
    .map((s) => s.character?.name ?? "?");
  const dps = signups
    .filter((s) => s.role === "dps" && s.status !== "no")
    .map((s) => s.character?.name ?? "?");
  const maybe = signups.filter((s) => s.status === "maybe").map((s) => s.character?.name ?? "?");

  return new EmbedBuilder()
    .setColor(GUILD_COLOR)
    .setTitle(`⚔️ ${raid.title}`)
    .setDescription(ts(raid.scheduledAt))
    .addFields(
      { name: `🛡️ Tank (${tanks.length})`, value: tanks.join(", ") || "—" },
      { name: `💚 Heiler (${heals.length})`, value: heals.join(", ") || "—" },
      { name: `⚔️ DPS (${dps.length})`, value: dps.join(", ") || "—" },
      ...(maybe.length ? [{ name: "❓ Vielleicht", value: maybe.join(", ") }] : []),
    )
    .setFooter({ text: `${tanks.length + heals.length + dps.length} Angemeldete` })
    .setTimestamp();
}
