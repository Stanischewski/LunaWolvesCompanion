import type { FastifyInstance } from "fastify";

const CLASS_IDS: Record<string, number> = {
  warrior: 1, paladin: 2, hunter: 3, rogue: 4, priest: 5,
  death_knight: 6, shaman: 7, mage: 8, warlock: 9, monk: 10,
  druid: 11, demon_hunter: 12, evoker: 13,
};

let cache: Record<string, string> | null = null;
let cacheExpiresAt = 0;

async function getBnetToken(): Promise<string> {
  const id = process.env.BNET_CLIENT_ID;
  const secret = process.env.BNET_CLIENT_SECRET;
  if (!id || !secret) throw new Error("BNET_CLIENT_ID/SECRET nicht konfiguriert");
  const auth = Buffer.from(`${id}:${secret}`).toString("base64");
  const res = await fetch("https://oauth.battle.net/token", {
    method: "POST",
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) throw new Error(`Battle.net Token: ${res.status}`);
  return ((await res.json()) as { access_token: string }).access_token;
}

async function fetchClassIcons(): Promise<Record<string, string>> {
  const region = (process.env.BNET_REGION ?? "eu").toLowerCase();
  const token = await getBnetToken();
  const icons: Record<string, string> = {};

  await Promise.all(
    Object.entries(CLASS_IDS).map(async ([name, id]) => {
      try {
        const res = await fetch(
          `https://${region}.api.blizzard.com/data/wow/media/playable-class/${id}?namespace=static-${region}&locale=en_US`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
        if (!res.ok) return;
        const data = (await res.json()) as { assets: Array<{ key: string; value: string }> };
        const icon = data.assets.find((a) => a.key === "icon");
        if (icon) icons[name] = icon.value;
      } catch {
        // Klasse wird ohne Icon übersprungen
      }
    }),
  );

  return icons;
}

export async function classIconRoutes(app: FastifyInstance) {
  app.get("/class-icons", async (_request, reply) => {
    if (cache && Date.now() < cacheExpiresAt) return cache;
    try {
      cache = await fetchClassIcons();
      cacheExpiresAt = Date.now() + 24 * 60 * 60 * 1000;
      return cache;
    } catch (err) {
      app.log.error({ err }, "[ClassIcons] Fehler");
      return reply.status(503).send({ error: "Icons konnten nicht geladen werden" });
    }
  });
}
