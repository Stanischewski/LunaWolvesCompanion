import type { Client, GuildTextBasedChannel } from "discord.js";
import { api } from "./api.js";
import { dkpBoardEmbeds } from "./embeds.js";

export async function updateDkpBoard(client: Client<true>): Promise<void> {
  try {
    const settings = await api.bot.settings();
    const channelId = settings.dkpChannelId;
    if (!channelId) return;

    const channel =
      (client.channels.cache.get(channelId) as GuildTextBasedChannel | undefined) ??
      ((await client.channels.fetch(channelId).catch(() => null)) as GuildTextBasedChannel | null);
    if (!channel || !("send" in channel)) return;

    const [standings, members] = await Promise.all([
      api.dkp.standings(),
      api.guild.members(),
    ]);
    const classMap = new Map(members.map((m) => [m.name.toLowerCase(), m.class]));
    const embeds = dkpBoardEmbeds(standings, classMap);

    if (settings.dkpMessageId) {
      try {
        const msg = await channel.messages.fetch(settings.dkpMessageId);
        await msg.edit({ embeds });
        return;
      } catch {
        // Nachricht gelöscht → neue posten
        await api.bot.setDkpMessageId(null);
      }
    }

    const msg = await channel.send({ embeds });
    await api.bot.setDkpMessageId(msg.id);
  } catch (err) {
    console.error("[DkpBoard] Fehler beim Aktualisieren:", err);
  }
}
