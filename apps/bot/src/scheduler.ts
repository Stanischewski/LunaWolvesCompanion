import { schedule } from "node-cron";
import type { Client } from "discord.js";
import { updateCalendarMessage } from "./calendar.js";

export function startScheduler(client: Client<true>): void {
  // Raid-Kalender: sofort beim Start, dann alle 10 Minuten aktualisieren
  updateCalendarMessage(client).catch((err) =>
    console.error("[Scheduler] Kalender-Initial fehlgeschlagen:", err),
  );
  schedule("*/10 * * * *", async () => {
    await updateCalendarMessage(client).catch((err) =>
      console.error("[Scheduler] Kalender-Update fehlgeschlagen:", err),
    );
  });

  console.log("✓ Scheduler gestartet — Raid-Kalender aktiv");
}
