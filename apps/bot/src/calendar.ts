import type { Client, GuildTextBasedChannel } from "discord.js";
import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import { api } from "./api.js";
import { config } from "./config.js";
import { raidCalendarEmbed } from "./embeds.js";
import type { RaidEvent } from "./api.js";

const ROLE_LABELS: Record<string, string> = {
  tank: "Tank",
  heal: "Heiler",
  dps: "DPS",
};

function buildButtons(raidId: string): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`cal_signup:tank:${raidId}`)
      .setLabel(ROLE_LABELS.tank)
      .setEmoji("🛡️")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`cal_signup:heal:${raidId}`)
      .setLabel(ROLE_LABELS.heal)
      .setEmoji("💚")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`cal_signup:dps:${raidId}`)
      .setLabel(ROLE_LABELS.dps)
      .setEmoji("⚔️")
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(`cal_unregister:${raidId}`)
      .setLabel("Abmelden")
      .setEmoji("❌")
      .setStyle(ButtonStyle.Secondary),
  );
}

export async function updateCalendarMessage(client: Client<true>): Promise<void> {
  try {
    const settings = await api.bot.settings();
    const channelId = settings.raidChannelId ?? config.raidChannelId;
    if (!channelId) {
      console.warn("[Calendar] Kein Raid-Channel konfiguriert (weder DB-Settings noch RAID_CHANNEL_ID).");
      return;
    }

    const channel =
      (client.channels.cache.get(channelId) as GuildTextBasedChannel | undefined) ??
      ((await client.channels.fetch(channelId).catch(() => null)) as GuildTextBasedChannel | null);
    if (!channel || !("send" in channel)) return;

    const raids = await api.guild.raids();
    const now = new Date();
    const sixHoursAgo = new Date(now.getTime() - 6 * 60 * 60 * 1000);
    // Zeige das nächste geplante Raid, oder einen Raid der in den letzten 6h gestartet ist
    const nextRaid: RaidEvent | undefined = raids.find(
      (r) => new Date(r.scheduledAt) > sixHoursAgo,
    );
    const isOngoing = nextRaid !== undefined && new Date(nextRaid.scheduledAt) <= now;

    const embed = raidCalendarEmbed(nextRaid, isOngoing);
    // Bei laufenden Raids keine Anmelde-Buttons mehr anzeigen
    const components = nextRaid && !isOngoing ? [buildButtons(nextRaid.id)] : [];

    let msgId = settings.calendarMessageId;

    if (msgId) {
      try {
        const msg = await channel.messages.fetch(msgId);
        await msg.edit({ embeds: [embed], components });
        return;
      } catch {
        msgId = null;
      }
    }

    const msg = await channel.send({ embeds: [embed], components });
    await api.bot.setCalendarMessageId(msg.id);
  } catch (err) {
    console.error("[Calendar] Fehler beim Aktualisieren:", err);
  }
}
