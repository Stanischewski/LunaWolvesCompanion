/**
 * Gemeinsamer Cache fuer Rollen, Sync-Cooldowns und Gem-Auflösungen.
 *
 * Zuvor hielt jedes Modul seine eigene `Map`, die nie aufgeraeumt wurde
 * (`roleCache`, `syncCooldowns`, `gemStatCache`). Zwei Probleme:
 *
 *  1. Sie wuchsen monoton — jeder je gesehene Spieler blieb bis zum Neustart.
 *  2. Sie sind prozesslokal. Sobald die API in PM2 auf `instances > 1`
 *     laeuft, greifen Sync-Cooldown und Rollen-Cache pro Worker
 *     unterschiedlich — ein Nutzer koennte den Cooldown durch Wiederholung
 *     umgehen, je nachdem welcher Worker antwortet.
 *
 * Ist REDIS_URL gesetzt, liegen die Werte in Redis (CT 201 ist laut
 * deploy/lxc/README.md bereitgestellt, wurde bisher aber von keiner App
 * genutzt). Ohne REDIS_URL greift ein LRU-Speicher mit fester Obergrenze —
 * gleiches Verhalten im Einzelprozess, nur eben nicht geteilt.
 */

import type { Redis } from "ioredis";

const MAX_ENTRIES = 5_000;
const PREFIX = "lw:";

interface Entry {
  value: string;
  expiresAt: number;
}

/** LRU ueber die Einfuegereihenfolge von Map — aelteste zuerst. */
class MemoryStore {
  private readonly entries = new Map<string, Entry>();

  get(key: string): string | null {
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
      this.entries.delete(key);
      return null;
    }
    // Zugriff macht den Eintrag wieder "frisch"
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  set(key: string, value: string, ttlMs: number): void {
    this.entries.delete(key);
    this.entries.set(key, { value, expiresAt: Date.now() + ttlMs });
    while (this.entries.size > MAX_ENTRIES) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      this.entries.delete(oldest.value);
    }
  }

  delete(key: string): void {
    this.entries.delete(key);
  }

  get size(): number {
    return this.entries.size;
  }
}

const memory = new MemoryStore();
let redis: Redis | null = null;
let redisReady = false;

/**
 * Baut die Redis-Verbindung auf, sofern REDIS_URL gesetzt ist.
 * Faellt bei jedem Fehler still auf den Speicher-Store zurueck — ein
 * ausgefallener Cache darf die API nicht mitreissen.
 */
export async function initCache(log?: {
  info: (msg: string) => void;
  warn: (msg: string) => void;
}): Promise<void> {
  const url = process.env.REDIS_URL;
  if (!url) {
    log?.info("[Cache] REDIS_URL nicht gesetzt — nutze begrenzten Speicher-Cache.");
    return;
  }

  try {
    const { default: Redis } = await import("ioredis");
    redis = new Redis(url, {
      lazyConnect: true,
      maxRetriesPerRequest: 2,
      // Ein langsamer Cache darf Anfragen nicht blockieren
      connectTimeout: 3_000,
    });
    redis.on("error", (err: Error) => {
      if (redisReady) {
        redisReady = false;
        log?.warn(`[Cache] Redis-Fehler, falle auf Speicher-Cache zurück: ${err.message}`);
      }
    });
    redis.on("ready", () => {
      redisReady = true;
      log?.info("[Cache] Redis verbunden.");
    });
    await redis.connect();
    redisReady = true;
  } catch (err) {
    redis = null;
    redisReady = false;
    log?.warn(
      `[Cache] Redis nicht erreichbar (${(err as Error).message}) — nutze Speicher-Cache.`,
    );
  }
}

export async function cacheGet(key: string): Promise<string | null> {
  if (redis && redisReady) {
    try {
      return await redis.get(PREFIX + key);
    } catch {
      redisReady = false;
    }
  }
  return memory.get(key);
}

export async function cacheSet(key: string, value: string, ttlMs: number): Promise<void> {
  if (redis && redisReady) {
    try {
      await redis.set(PREFIX + key, value, "PX", ttlMs);
      return;
    } catch {
      redisReady = false;
    }
  }
  memory.set(key, value, ttlMs);
}

export async function cacheDelete(key: string): Promise<void> {
  if (redis && redisReady) {
    try {
      await redis.del(PREFIX + key);
    } catch {
      redisReady = false;
    }
  }
  memory.delete(key);
}

/**
 * Setzt einen Wert nur, wenn der Schluessel frei ist. Gibt true zurueck, wenn
 * das gelungen ist. Grundlage fuer Rate-Limits, die auch ueber mehrere
 * Prozesse hinweg greifen.
 */
export async function cacheSetIfAbsent(
  key: string,
  value: string,
  ttlMs: number,
): Promise<boolean> {
  if (redis && redisReady) {
    try {
      const res = await redis.set(PREFIX + key, value, "PX", ttlMs, "NX");
      return res === "OK";
    } catch {
      redisReady = false;
    }
  }
  if (memory.get(key) !== null) return false;
  memory.set(key, value, ttlMs);
  return true;
}

export function cacheStatus(): { backend: "redis" | "memory"; memoryEntries: number } {
  return {
    backend: redis && redisReady ? "redis" : "memory",
    memoryEntries: memory.size,
  };
}

export async function closeCache(): Promise<void> {
  if (redis) {
    await redis.quit().catch(() => undefined);
    redis = null;
    redisReady = false;
  }
}
