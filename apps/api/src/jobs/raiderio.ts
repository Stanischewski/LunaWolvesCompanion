import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { characters } from "../db/schema.js";

const RAIDERIO_URL = "https://raider.io/api/v1/characters/profile";
const DELAY_MS = 600;

interface RaiderIOProfile {
  mythic_plus_scores_by_season?: {
    season: string;
    scores: { all: number };
  }[];
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchScore(name: string, realm: string, region = "eu"): Promise<number | null> {
  const url =
    `${RAIDERIO_URL}?region=${region}&realm=${encodeURIComponent(realm)}` +
    `&name=${encodeURIComponent(name)}&fields=mythic_plus_scores_by_season:current`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const data = (await res.json()) as RaiderIOProfile;
    const season = data.mythic_plus_scores_by_season?.[0];
    return season ? Math.round(season.scores.all) : null;
  } catch {
    return null;
  }
}

export async function enrichMPlusScores(): Promise<void> {
  const allChars = await db
    .select({ id: characters.id, name: characters.name, realm: characters.realm, mPlusScore: characters.mPlusScore })
    .from(characters);

  let updated = 0;
  for (const char of allChars) {
    const score = await fetchScore(char.name, char.realm);
    if (score !== null && score !== char.mPlusScore) {
      await db.update(characters).set({ mPlusScore: score }).where(eq(characters.id, char.id));
      updated++;
    }
    await sleep(DELAY_MS);
  }

  console.log(`[Raider.IO] M+ Scores aktualisiert: ${updated}/${allChars.length}`);
}
