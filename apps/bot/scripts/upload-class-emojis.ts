#!/usr/bin/env tsx
/**
 * Lädt WoW-Klassen-Icons von der Blizzard API und erstellt sie als Discord Server-Emojis.
 * Einmalig ausführen mit: pnpm tsx scripts/upload-class-emojis.ts
 *
 * Voraussetzungen: apps/bot/.env mit BNET_CLIENT_ID, BNET_CLIENT_SECRET,
 *                  DISCORD_BOT_TOKEN, DISCORD_GUILD_ID
 */

import "dotenv/config";

const BNET_CLIENT_ID = process.env.BNET_CLIENT_ID;
const BNET_CLIENT_SECRET = process.env.BNET_CLIENT_SECRET;
const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const DISCORD_GUILD_ID = process.env.DISCORD_GUILD_ID;
const REGION = (process.env.BNET_REGION ?? "eu").toLowerCase();

if (!BNET_CLIENT_ID || !BNET_CLIENT_SECRET || !DISCORD_BOT_TOKEN || !DISCORD_GUILD_ID) {
  console.error("❌ Fehlende Umgebungsvariablen. Prüfe apps/bot/.env");
  process.exit(1);
}

// WoW Klassen-IDs aus der Blizzard API
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
  if (!res.ok) throw new Error(`Battle.net Token fehlgeschlagen: ${res.status}`);
  const data = (await res.json()) as { access_token: string };
  return data.access_token;
}

async function getClassIconUrl(token: string, classId: number): Promise<string> {
  const url = `https://${REGION}.api.blizzard.com/data/wow/media/playable-class/${classId}?namespace=static-${REGION}&locale=en_US`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Blizzard API Fehler: ${res.status}`);
  const data = (await res.json()) as { assets: Array<{ key: string; value: string }> };
  const icon = data.assets.find((a) => a.key === "icon");
  if (!icon) throw new Error("Kein Icon in API-Antwort");
  return icon.value;
}

async function toBase64(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download fehlgeschlagen: ${res.status}`);
  const buf = await res.arrayBuffer();
  return Buffer.from(buf).toString("base64");
}

async function getExistingEmojiNames(): Promise<Set<string>> {
  const res = await fetch(`https://discord.com/api/v10/guilds/${DISCORD_GUILD_ID}/emojis`, {
    headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}` },
  });
  if (!res.ok) throw new Error(`Discord Emoji-Liste fehlgeschlagen: ${res.status}`);
  const emojis = (await res.json()) as Array<{ name: string }>;
  return new Set(emojis.map((e) => e.name));
}

async function createEmoji(name: string, imageBase64: string): Promise<void> {
  const res = await fetch(`https://discord.com/api/v10/guilds/${DISCORD_GUILD_ID}/emojis`, {
    method: "POST",
    headers: {
      Authorization: `Bot ${DISCORD_BOT_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ name, image: `data:image/png;base64,${imageBase64}` }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`${res.status} — ${err}`);
  }
}

async function main() {
  console.log("🔑 Battle.net Token wird abgerufen...");
  const token = await getBnetToken();

  console.log("📋 Vorhandene Discord-Emojis werden abgerufen...");
  const existing = await getExistingEmojiNames();

  let uploaded = 0;
  let skipped = 0;

  for (const [className, classId] of Object.entries(CLASSES)) {
    const emojiName = `class_${className}`;

    if (existing.has(emojiName)) {
      console.log(`⏭  ${emojiName} bereits vorhanden, übersprungen`);
      skipped++;
      continue;
    }

    try {
      const iconUrl = await getClassIconUrl(token, classId);
      const base64 = await toBase64(iconUrl);
      await createEmoji(emojiName, base64);
      console.log(`✅ ${emojiName} hochgeladen`);
      uploaded++;
    } catch (err) {
      console.error(`❌ ${emojiName}: ${err instanceof Error ? err.message : err}`);
    }

    // Kurze Pause gegen Discord Rate-Limit
    await new Promise((r) => setTimeout(r, 600));
  }

  console.log(`\n✓ Fertig — ${uploaded} hochgeladen, ${skipped} übersprungen`);
  if (uploaded > 0) console.log("→ Bot neu starten damit die Emojis geladen werden.");
}

main().catch((err) => {
  console.error("Fehler:", err);
  process.exit(1);
});
