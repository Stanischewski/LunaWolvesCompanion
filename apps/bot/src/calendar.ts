import type { Client, GuildTextBasedChannel } from "discord.js";
import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import { api } from "./api.js";
import { config } from "./config.js";
import { raidCalendarEmbed } from "./embeds.js";
import type { RaidEvent } from "./api.js";

function buildButtons(raidId: string): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`cal_signup:tank:${raidId}`)
      .setLabel("Tank")
      .setEmoji("🛡️")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`cal_signup:heal:${raidId}`)
      .setLabel("Heiler")
      .setEmoji("💚")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`cal_signup:dps:${raidId}`)
      .setLabel("DPS")
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
    const nextRaid: RaidEvent | undefined = raids.find(
      (r) => new Date(r.scheduledAt) > sixHoursAgo,
    );

    // Kein aktuelles/bevorstehendes Raid — nichts tun, alte Nachricht bleibt stehen
    if (!nextRaid) return;

    const isOngoing = new Date(nextRaid.scheduledAt) <= now;
    const embed = raidCalendarEmbed(nextRaid, isOngoing);
    // Während des Raids keine Anmelde-Buttons
    const components = isOngoing ? [] : [buildButtons(nextRaid.id)];

    // Vorhandene Nachricht dieses Raids bearbeiten
    if (nextRaid.calendarMessageId) {
      try {
        const msg = await channel.messages.fetch(nextRaid.calendarMessageId);
        await msg.edit({ embeds: [embed], components });
        return;
      } catch {
        // Nachricht wurde gelöscht → neue posten
        await api.raid.setCalendarMessageId(nextRaid.id, null);
      }
    }

    // Neue Nachricht für diesen Raid posten
    const msg = await channel.send({ embeds: [embed], components });
    await api.raid.setCalendarMessageId(nextRaid.id, msg.id);
  } catch (err) {
    console.error("[Calendar] Fehler beim Aktualisieren:", err);
  }
}
