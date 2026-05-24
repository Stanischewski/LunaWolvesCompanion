#!/usr/bin/env tsx
/**
 * Lädt WoW-Klassen-Icons von der Blizzard API und erstellt sie als
 * Application-Emojis des Bots (bis 2.000, kein Server-Limit).
 *
 * Einmalig ausführen mit: pnpm tsx scripts/upload-class-emojis.ts
 *
 * Voraussetzungen: apps/bot/.env mit BNET_CLIENT_ID, BNET_CLIENT_SECRET,
 *                  DISCORD_BOT_TOKEN
 */

import "dotenv/config";

const BNET_CLIENT_ID = process.env.BNET_CLIENT_ID;
const BNET_CLIENT_SECRET = process.env.BNET_CLIENT_SECRET;
const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const REGION = (process.env.BNET_REGION ?? "eu").toLowerCase();

if (!BNET_CLIENT_ID || !BNET_CLIENT_SECRET || !DISCORD_BOT_TOKEN) {
  console.error("❌ Fehlende Umgebungsvariablen. Prüfe apps/bot/.env");
  process.exit(1);
}

// Application-ID aus dem Bot-Token ableiten (erster Segment = base64-kodierte User-ID)
const APP_ID = Buffer.from(DISCORD_BOT_TOKEN.split(".")[0], "base64").toString("utf8");

const CLASSES: Record<string, number> = {
  warrior: 1,
  paladin: 2,
  hunter: 3,
  rogue: 4,
  priest: 5,
  death_knight: 6,
  shaman: 7,
  mage: 8,
  warlock: 9,
  monk: 10,
  druid: 11,
  demon_hunter: 12,
  evoker: 13,
};

async function getBnetToken(): Promise<string> {
  const auth = Buffer.from(`${BNET_CLIENT_ID}:${BNET_CLIENT_SECRET}`).toString("base64");
  const res = await fetch("https://oauth.battle.net/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) throw new Error(`Battle.net Token fehlgeschlagen: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { access_token: string };
  return data.access_token;
}

async function getClassIconUrl(token: string, classId: number): Promise<string> {
  const url = `https://${REGION}.api.blizzard.com/data/wow/media/playable-class/${classId}?namespace=static-${REGION}&locale=en_US`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Blizzard API: ${res.status}`);
  const data = (await res.json()) as { assets: Array<{ key: string; value: string }> };
  const icon = data.assets.find((a) => a.key === "icon");
  if (!icon) throw new Error("Kein Icon in API-Antwort");
  return icon.value;
}

async function toBase64(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download fehlgeschlagen: ${res.status}`);
  return Buffer.from(await res.arrayBuffer()).toString("base64");
}

// Application-Emojis des Bots abrufen (gibt { items: [...] } zurück, kein plain array)
async function getExistingAppEmojiNames(): Promise<Set<string>> {
  const res = await fetch(`https://discord.com/api/v10/applications/${APP_ID}/emojis`, {
    headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}` },
  });
  if (!res.ok) throw new Error(`Discord Emoji-Liste: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { items: Array<{ name: string }> };
  return new Set(data.items.map((e) => e.name));
}

async function createAppEmoji(name: string, imageBase64: string): Promise<void> {
  const res = await fetch(`https://discord.com/api/v10/applications/${APP_ID}/emojis`, {
    method: "POST",
    headers: {
      Authorization: `Bot ${DISCORD_BOT_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ name, image: `data:image/png;base64,${imageBase64}` }),
  });
  if (!res.ok) throw new Error(`Discord: ${res.status} — ${await res.text()}`);
}

async function main() {
  console.log(`Application-ID: ${APP_ID}`);

  console.log("🔑 Battle.net Token wird abgerufen...");
  const token = await getBnetToken();

  console.log("📋 Vorhandene Application-Emojis werden abgerufen...");
  const existing = await getExistingAppEmojiNames();
  console.log(`   ${existing.size} Emojis bereits vorhanden`);

  let uploaded = 0;
  let skipped = 0;

  for (const [className, classId] of Object.entries(CLASSES)) {
    const emojiName = `class_${className}`;

    if (existing.has(emojiName)) {
      console.log(`⏭  ${emojiName} bereits vorhanden`);
      skipped++;
      continue;
    }

    try {
      const iconUrl = await getClassIconUrl(token, classId);
      const base64 = await toBase64(iconUrl);
      await createAppEmoji(emojiName, base64);
      console.log(`✅ ${emojiName} hochgeladen`);
      uploaded++;
    } catch (err) {
      console.error(`❌ ${emojiName}: ${err instanceof Error ? err.message : err}`);
    }

    await new Promise((r) => setTimeout(r, 600));
  }

  console.log(`\n✓ Fertig — ${uploaded} hochgeladen, ${skipped} übersprungen`);
  if (uploaded > 0) console.log("→ Bot neu starten damit die Emojis geladen werden.");
}

main().catch((err) => {
  console.error("Fehler:", err);
  process.exit(1);
});
