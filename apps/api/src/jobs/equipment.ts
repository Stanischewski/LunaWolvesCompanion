import { db } from "../db/index.js";
import { players, characters, characterEquipment, itemIconCache } from "../db/schema.js";
import { eq, and, isNotNull, gt } from "drizzle-orm";
import type { FastifyBaseLogger } from "fastify";

const region = process.env.BNET_REGION ?? "eu";

let cachedClientToken: { value: string; expiry: Date } | null = null;

async function getClientToken(): Promise<string> {
  if (cachedClientToken && cachedClientToken.expiry > new Date()) {
    return cachedClientToken.value;
  }
  const creds = Buffer.from(
    `${process.env.BNET_CLIENT_ID}:${process.env.BNET_CLIENT_SECRET}`,
  ).toString("base64");
  const res = await fetch(`https://${region}.battle.net/oauth/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${creds}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) throw new Error(`Client-Token fehlgeschlagen: ${res.status}`);
  const data = (await res.json()) as { access_token: string; expires_in: number };
  cachedClientToken = {
    value: data.access_token,
    expiry: new Date(Date.now() + (data.expires_in - 120) * 1000),
  };
  return cachedClientToken.value;
}

async function resolveIconUrl(itemId: number, clientToken: string): Promise<string | null> {
  const cached = await db.query.itemIconCache.findFirst({
    where: eq(itemIconCache.itemId, itemId),
  });
  if (cached) return cached.iconUrl;

  const res = await fetch(
    `https://${region}.api.blizzard.com/data/wow/media/item/${itemId}?namespace=static-${region}`,
    { headers: { Authorization: `Bearer ${clientToken}` } },
  );
  if (!res.ok) return null;

  const data = (await res.json()) as { assets?: { key: string; value: string }[] };
  const iconUrl = data.assets?.find((a) => a.key === "icon")?.value ?? null;
  if (iconUrl) {
    await db.insert(itemIconCache).values({ itemId, iconUrl }).onConflictDoNothing();
  }
  return iconUrl;
}

interface BnetEquipItem {
  item: { id: number };
  slot: { type: string };
  name: string;
  level: { value: number };
  quality: { type: string };
  media: { id: number };
}

export async function syncEquipment(log: FastifyBaseLogger) {
  if (!process.env.BNET_CLIENT_ID || !process.env.BNET_CLIENT_SECRET) {
    log.warn("[Equipment] BNET-Credentials fehlen, überspringe");
    return;
  }

  const now = new Date();
  const rows = await db
    .select({
      playerId: players.id,
      bnetTag: players.bnetTag,
      bnetAccessToken: players.bnetAccessToken,
      charId: characters.id,
      charName: characters.name,
      charRealm: characters.realm,
    })
    .from(players)
    .innerJoin(characters, eq(characters.playerId, players.id))
    .where(and(isNotNull(players.bnetAccessToken), gt(players.bnetTokenExpiry, now)));

  if (rows.length === 0) {
    log.info("[Equipment] Keine Spieler mit verknüpften Charakteren und gültigem Token");
    return;
  }

  let clientToken: string;
  try {
    clientToken = await getClientToken();
  } catch (e) {
    log.error({ err: e }, "[Equipment] Client-Token fehlgeschlagen");
    return;
  }

  const playerCount = new Set(rows.map((r) => r.playerId)).size;
  log.info(`[Equipment] Sync für ${playerCount} Spieler, ${rows.length} Charaktere`);

  for (const char of rows) {
    const realmSlug = char.charRealm
      .replace(/([a-z\d])([A-Z])/g, "$1-$2")
      .replace(/([A-Z]+)([A-Z][a-z])/g, "$1-$2")
      .toLowerCase()
      .replace(/'/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    const charName = char.charName.toLowerCase();

    try {
      const res = await fetch(
        `https://${region}.api.blizzard.com/profile/wow/character/${realmSlug}/${charName}/equipment?namespace=profile-${region}&locale=de_DE`,
        { headers: { Authorization: `Bearer ${char.bnetAccessToken}` } },
      );

      if (!res.ok) {
        const errBody = await res.text().catch(() => "");
        log.warn(
          `[Equipment] ${char.charName}-${char.charRealm} (${char.bnetTag}): HTTP ${res.status} — ${errBody.slice(0, 300)}`,
        );
        continue;
      }

      const data = (await res.json()) as { equipped_items?: BnetEquipItem[] };

      for (const item of data.equipped_items ?? []) {
        const iconUrl = await resolveIconUrl(item.media.id, clientToken);
        await db
          .insert(characterEquipment)
          .values({
            characterId: char.charId,
            slot: item.slot.type,
            itemId: item.item.id,
            itemName: item.name,
            itemLevel: item.level.value,
            quality: item.quality.type,
            iconUrl,
          })
          .onConflictDoUpdate({
            target: [characterEquipment.characterId, characterEquipment.slot],
            set: {
              itemId: item.item.id,
              itemName: item.name,
              itemLevel: item.level.value,
              quality: item.quality.type,
              iconUrl,
              syncedAt: new Date(),
            },
          });
      }

      log.info(`[Equipment] ${char.charName} (${char.charRealm}): ${data.equipped_items?.length ?? 0} Slots gespeichert`);
    } catch (e) {
      log.error({ err: e }, `[Equipment] Fehler bei ${char.charName}`);
    }
  }

  log.info("[Equipment] Sync abgeschlossen");
}
