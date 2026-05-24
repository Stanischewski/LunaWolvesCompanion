import { EmbedBuilder } from "discord.js";
import type { GuildInfo, MemberCharacter, RaidEvent, RaidSignup, DkpStanding, DkpEntry } from "./api.js";
import { classEmoji } from "./emojis.js";

export const GUILD_COLOR = 0x7c3aed;

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
    const emoji = classEmoji(m.class);
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
    const emoji = classEmoji(m.class);
    return `${emoji} **${m.name}** — zuletzt ${tsRel(m.lastLogin)}`;
  });
  return new EmbedBuilder()
    .setColor(GUILD_COLOR)
    .setTitle(`🕐 Letzte Aktivität — ${guild.name}`)
    .setDescription(lines.join("\n") || "Keine Aktivitätsdaten vorhanden.")
    .setTimestamp();
}

export function playerEmbed(member: MemberCharacter): EmbedBuilder {
  const emoji = classEmoji(member.class);
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

export function raidReminderEmbed(raid: RaidEvent, window: "24h" | "1h"): EmbedBuilder {
  const icon = window === "24h" ? "📣" : "⏰";
  const label = window === "24h" ? "Morgen" : "In 1 Stunde";
  return new EmbedBuilder()
    .setColor(window === "1h" ? 0xf59e0b : GUILD_COLOR)
    .setTitle(`${icon} Raid-Erinnerung — ${label}!`)
    .setDescription(`**${raid.title}** beginnt ${tsRel(raid.scheduledAt)}`)
    .addFields(
      { name: "Datum & Uhrzeit", value: ts(raid.scheduledAt), inline: true },
      ...(raid.raidType ? [{ name: "Typ", value: raid.raidType, inline: true }] : []),
      ...(raid.minIlvl ? [{ name: "Min. Item-Level", value: String(raid.minIlvl), inline: true }] : []),
    )
    .setTimestamp();
}

export function inactivityReportEmbed(members: MemberCharacter[]): EmbedBuilder {
  if (members.length === 0) {
    return new EmbedBuilder()
      .setColor(0x22c55e)
      .setTitle("✅ Wochenbericht — Alle aktiv")
      .setDescription("Keine Mitglieder sind seit mehr als 14 Tagen inaktiv.")
      .setTimestamp();
  }
  const lines = members.map((m) => {
    const last = m.lastLogin ? tsRel(m.lastLogin) : "Nie eingeloggt";
    const emoji = classEmoji(m.class);
    return `${emoji} **${m.name}** — ${last}`;
  });
  return new EmbedBuilder()
    .setColor(0xef4444)
    .setTitle(`⚠️ Inaktivitäts-Wochenbericht — ${members.length} Mitglieder`)
    .setDescription(
      `Folgende Mitglieder waren **mehr als 14 Tage** nicht online:\n\n${lines.join("\n")}`,
    )
    .setTimestamp();
}

export function dkpStandingsEmbed(standings: DkpStanding[]): EmbedBuilder {
  const top = standings.slice(0, 15);
  const lines = top.map(
    (s, i) =>
      `\`${String(i + 1).padStart(2, " ")}\` **${s.playerName}** — ${s.current} DKP *(${s.lifetime} gesamt)*`,
  );
  return new EmbedBuilder()
    .setColor(GUILD_COLOR)
    .setTitle("🏆 DKP Standings")
    .setDescription(lines.join("\n") || "Keine Einträge.")
    .setFooter({
      text: `${standings.length} Spieler${standings.length > 15 ? " · Zeige Top 15" : ""}`,
    })
    .setTimestamp();
}

export function dkpBoardEmbeds(
  standings: DkpStanding[],
  classMap?: Map<string, string>,
): EmbedBuilder[] {
  if (standings.length === 0) {
    return [
      new EmbedBuilder()
        .setColor(GUILD_COLOR)
        .setTitle("DKP")
        .setDescription("Noch keine Einträge.")
        .setTimestamp(),
    ];
  }

  // Dynamisches Chunking: Feldgrenze 1024 Zeichen, Custom-Emojis sind ~38 Zeichen lang
  const FIELD_LIMIT = 1020;
  const embeds: EmbedBuilder[] = [];

  let nameLines: string[] = [];
  let dkpLines: string[] = [];
  let namesLen = 0;
  let isFirst = true;

  const flush = () => {
    if (nameLines.length === 0) return;
    const embed = new EmbedBuilder()
      .setColor(GUILD_COLOR)
      .addFields(
        { name: "Spieler", value: nameLines.join("\n"), inline: true },
        { name: "DKP", value: dkpLines.join("\n"), inline: true },
      );
    if (isFirst) {
      embed.setTitle("DKP").setFooter({ text: `${standings.length} Spieler` }).setTimestamp();
      isFirst = false;
    }
    embeds.push(embed);
    nameLines = [];
    dkpLines = [];
    namesLen = 0;
  };

  for (const s of standings) {
    const cls = classMap?.get(s.playerName.toLowerCase());
    const icon = cls ? classEmoji(cls) : "—";
    const nameLine = `${icon}  ${s.playerName}`;
    const lineLen = nameLine.length + 1; // +1 für \n
    if (namesLen + lineLen > FIELD_LIMIT && nameLines.length > 0) flush();
    nameLines.push(nameLine);
    dkpLines.push(`${s.current}`);
    namesLen += lineLen;
  }
  flush();

  return embeds;
}

export function dkpPlayerEmbed(standing: DkpStanding): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(GUILD_COLOR)
    .setTitle(`💰 DKP — ${standing.playerName}`)
    .addFields(
      { name: "Aktuell", value: String(standing.current), inline: true },
      { name: "Gesamt verdient", value: String(standing.lifetime), inline: true },
    )
    .setTimestamp();
}

export function dkpHistoryEmbed(entries: DkpEntry[], playerFilter?: string): EmbedBuilder {
  const lines = entries.map((e) => {
    const sign = e.delta > 0 ? "+" : "";
    const icon = e.entryType === "spend" ? "💸" : e.delta > 0 ? "✅" : "🔧";
    return `${icon} **${e.playerName}** ${sign}${e.delta} — ${e.reason}`;
  });
  const title = playerFilter ? `📜 DKP-Verlauf — ${playerFilter}` : "📜 DKP-Verlauf";
  return new EmbedBuilder()
    .setColor(GUILD_COLOR)
    .setTitle(title)
    .setDescription(lines.join("\n") || "Keine Einträge.")
    .setTimestamp();
}

export function compareEmbed(a: MemberCharacter, b: MemberCharacter): EmbedBuilder {
  const emojiA = classEmoji(a.class);
  const emojiB = classEmoji(b.class);
  const clsA = CLASS_NAMES[a.class] ?? a.class;
  const clsB = CLASS_NAMES[b.class] ?? b.class;

  // ✅ = besser, ❌ = schlechter, — = gleich (higherBetter=true für ilvl/M+, false für Rang)
  const cmp = (v1: number, v2: number, higherBetter = true): string => {
    if (v1 === v2) return "—";
    return (higherBetter ? v1 > v2 : v1 < v2) ? "✅" : "❌";
  };

  const scoreA = a.mPlusScore ?? 0;
  const scoreB = b.mPlusScore ?? 0;

  return new EmbedBuilder()
    .setColor(GUILD_COLOR)
    .setTitle("⚖️ Spieler-Vergleich")
    .setDescription(`${emojiA} **${a.name}** vs ${emojiB} **${b.name}**`)
    .addFields(
      {
        name: `${emojiA} ${a.name}`,
        value: [
          `**Klasse:** ${clsA}`,
          `**ilvl:** ${cmp(a.itemLevel, b.itemLevel)} ${a.itemLevel}`,
          `**M+:** ${cmp(scoreA, scoreB)} ${scoreA}`,
          `**Rang:** ${cmp(a.guildRank, b.guildRank, false)} ${a.guildRank}`,
          `**Aktiv:** ${a.lastLogin ? tsRel(a.lastLogin) : "—"}`,
        ].join("\n"),
        inline: true,
      },
      {
        name: `${emojiB} ${b.name}`,
        value: [
          `**Klasse:** ${clsB}`,
          `**ilvl:** ${cmp(b.itemLevel, a.itemLevel)} ${b.itemLevel}`,
          `**M+:** ${cmp(scoreB, scoreA)} ${scoreB}`,
          `**Rang:** ${cmp(b.guildRank, a.guildRank, false)} ${b.guildRank}`,
          `**Aktiv:** ${b.lastLogin ? tsRel(b.lastLogin) : "—"}`,
        ].join("\n"),
        inline: true,
      },
    )
    .setFooter({ text: "✅ führt · ❌ liegt zurück · — gleich" })
    .setTimestamp();
}

export function raidCalendarEmbed(raid: RaidEvent | undefined, isOngoing = false): EmbedBuilder {
  if (!raid) {
    return new EmbedBuilder()
      .setColor(GUILD_COLOR)
      .setTitle("📅 Raid-Kalender")
      .setDescription("Aktuell sind keine Raids geplant.")
      .setTimestamp();
  }

  const signups = raid.signups ?? [];
  const tanks = signups.filter((s) => s.role === "tank" && s.status !== "no");
  const heals = signups.filter((s) => s.role === "heal" && s.status !== "no");
  const dps = signups.filter((s) => s.role === "dps" && s.status !== "no");
  const maybe = signups.filter((s) => s.status === "maybe");

  const fmt = (s: RaidSignup) =>
    `${classEmoji(s.character?.class ?? "")} ${s.character?.name ?? "?"}`;

  const descLines = [
    isOngoing ? "🟢 **Raid läuft gerade!**" : null,
    `**Datum:** ${ts(raid.scheduledAt)} (${tsRel(raid.scheduledAt)})`,
    raid.raidType ? `**Typ:** ${raid.raidType}` : null,
    raid.minIlvl ? `**Min. Item-Level:** ${raid.minIlvl}` : null,
  ].filter(Boolean) as string[];

  return new EmbedBuilder()
    .setColor(isOngoing ? 0x22c55e : GUILD_COLOR)
    .setTitle(`📅 ${isOngoing ? "Laufender Raid" : "Nächster Raid"} — ${raid.title}`)
    .setDescription(descLines.join("\n"))
    .addFields(
      { name: `🛡️ Tanks (${tanks.length})`, value: tanks.map(fmt).join("\n") || "—", inline: true },
      { name: `💚 Heiler (${heals.length})`, value: heals.map(fmt).join("\n") || "—", inline: true },
      { name: `⚔️ DPS (${dps.length})`, value: dps.map(fmt).join("\n") || "—", inline: true },
      ...(maybe.length > 0
        ? [{ name: `❓ Vielleicht (${maybe.length})`, value: maybe.map(fmt).join("\n") }]
        : []),
    )
    .setFooter({
      text: isOngoing
        ? `${tanks.length + heals.length + dps.length} Angemeldete · Raid hat begonnen`
        : `${tanks.length + heals.length + dps.length} Angemeldete · Schaltflächen unten zum An-/Abmelden`,
    })
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
