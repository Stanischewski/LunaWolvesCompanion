import { schedule } from "node-cron";
import type { Client, GuildTextBasedChannel } from "discord.js";
import { api } from "./api.js";
import { raidReminderEmbed, inactivityReportEmbed } from "./embeds.js";
import { config } from "./config.js";

// Gesendete Erinnerungen werden in-memory getrackt, um Duplikate zu vermeiden.
// Schlüssel: "<raidId>-24h" bzw. "<raidId>-1h"
const sentReminders = new Set<string>();

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const WINDOW_MS = 5 * 60 * 1000; // ±5 Minuten Toleranz

function msUntil(iso: string): number {
  return new Date(iso).getTime() - Date.now();
}

function inWindow(actual: number, target: number): boolean {
  return Math.abs(actual - target) < WINDOW_MS;
}

async function checkRaidReminders(channel: GuildTextBasedChannel): Promise<void> {
  const raids = await api.guild.raids();
  for (const raid of raids) {
    const ms = msUntil(raid.scheduledAt);
    if (ms < 0) continue;

    const key24h = `${raid.id}-24h`;
    if (!sentReminders.has(key24h) && inWindow(ms, DAY_MS)) {
      await channel.send({ embeds: [raidReminderEmbed(raid, "24h")] });
      sentReminders.add(key24h);
    }

    const key1h = `${raid.id}-1h`;
    if (!sentReminders.has(key1h) && inWindow(ms, HOUR_MS)) {
      await channel.send({ embeds: [raidReminderEmbed(raid, "1h")] });
      sentReminders.add(key1h);
    }
  }
}

async function sendInactivityReport(channel: GuildTextBasedChannel): Promise<void> {
  const members = await api.guild.members();
  const cutoff = Date.now() - 14 * DAY_MS;
  const inactive = members.filter((m) => !m.lastLogin || new Date(m.lastLogin).getTime() < cutoff);
  await channel.send({ embeds: [inactivityReportEmbed(inactive)] });
}

export function startScheduler(client: Client<true>): void {
  const raidCh = config.raidChannelId
    ? (client.channels.cache.get(config.raidChannelId) as GuildTextBasedChannel | undefined)
    : undefined;
  const officerCh = config.officerChannelId
    ? (client.channels.cache.get(config.officerChannelId) as GuildTextBasedChannel | undefined)
    : undefined;

  // Raid-Erinnerungen: alle 5 Minuten prüfen
  schedule("*/5 * * * *", async () => {
    if (!raidCh) return;
    await checkRaidReminders(raidCh).catch((err) =>
      console.error("[Scheduler] Raid-Check fehlgeschlagen:", err),
    );
  });

  // Inaktivitäts-Report: jeden Sonntag um 10:00
  schedule("0 10 * * 0", async () => {
    if (!officerCh) return;
    await sendInactivityReport(officerCh).catch((err) =>
      console.error("[Scheduler] Inaktivitäts-Report fehlgeschlagen:", err),
    );
  });

  const raidStatus = raidCh ? `Channel ${config.raidChannelId}` : "kein Channel konfiguriert";
  const officerStatus = officerCh
    ? `Channel ${config.officerChannelId}`
    : "kein Channel konfiguriert";
  console.log(`✓ Scheduler gestartet — Raid-Erinnerungen: ${raidStatus}`);
  console.log(`✓ Scheduler gestartet — Inaktivitäts-Report: ${officerStatus}`);
}
