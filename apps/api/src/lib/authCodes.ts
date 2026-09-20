import { randomBytes, timingSafeEqual, createHash } from "node:crypto";

/**
 * Kurzlebige Einmal-Codes fuer den OAuth-Rueckweg.
 *
 * Frueher ging das fertige JWT als Query-Parameter zurueck
 * (`/auth/callback?token=…`, `/auth/discord/link?token=…`). Ein sieben Tage
 * gueltiges Token landete damit in Browser-Verlauf, `Referer`-Headern und —
 * weil die API mit `logger: true` laeuft und Fastify `req.url` protokolliert —
 * im Klartext in den PM2-Logs.
 *
 * Stattdessen wandert jetzt nur ein Code durch die URL, der
 *   - genau einmal einloesbar ist,
 *   - nach CODE_TTL_MS verfaellt,
 *   - und serverseitig nur als Hash liegt.
 *
 * Bewusst im Prozessspeicher: Die Lebensdauer betraegt Sekunden, und der
 * Einloesevorgang folgt unmittelbar auf die Ausstellung. Laeuft die API
 * irgendwann mehrfach, gehoert der Store nach Redis (siehe lib/cache.ts).
 */

const CODE_TTL_MS = 60_000;
const MAX_CODES = 10_000;

interface CodeEntry {
  payload: string;
  expiresAt: number;
}

const codes = new Map<string, CodeEntry>();

function hash(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

function prune(): void {
  const now = Date.now();
  for (const [key, entry] of codes) {
    if (entry.expiresAt <= now) codes.delete(key);
  }
  // Notbremse gegen unbegrenztes Wachstum, falls Codes nie eingeloest werden.
  if (codes.size > MAX_CODES) {
    const excess = codes.size - MAX_CODES;
    let removed = 0;
    for (const key of codes.keys()) {
      codes.delete(key);
      if (++removed >= excess) break;
    }
  }
}

/** Stellt einen Einmal-Code fuer die uebergebene Nutzlast aus. */
export function issueCode(payload: string): string {
  prune();
  const code = randomBytes(32).toString("base64url");
  codes.set(hash(code), { payload, expiresAt: Date.now() + CODE_TTL_MS });
  return code;
}

/**
 * Loest einen Code ein. Gibt die Nutzlast zurueck oder null, wenn der Code
 * unbekannt, bereits benutzt oder abgelaufen ist. Der Code ist danach
 * in jedem Fall verbraucht.
 */
export function redeemCode(code: string): string | null {
  if (typeof code !== "string" || code.length === 0 || code.length > 256) return null;
  prune();

  const key = hash(code);
  const entry = codes.get(key);
  if (!entry) return null;
  codes.delete(key);
  if (entry.expiresAt <= Date.now()) return null;
  return entry.payload;
}

/**
 * Zeitkonstanter Vergleich zweier Zeichenketten gleicher Bedeutung
 * (z. B. eines `state`-Nonce).
 */
export function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/** Nur fuer Tests: leert den Speicher. */
export function _resetCodes(): void {
  codes.clear();
}
