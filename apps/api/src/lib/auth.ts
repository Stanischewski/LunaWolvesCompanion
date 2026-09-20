import { timingSafeEqual } from "node:crypto";
import type { FastifyRequest, FastifyReply } from "fastify";

/**
 * Sentinel-`sub` fuer Requests, die ueber das Bot-Secret authentifiziert sind.
 * Bewusst keine UUID: Ein versehentlicher Insert in eine Spieler-Fremdschluessel-
 * spalte scheitert damit sofort, statt stillschweigend Muell zu schreiben.
 */
export const BOT_SUBJECT = "discord-bot";

/** Anzeigename, wenn der Bot keinen konkreten Officer mitliefert. */
export const BOT_DEFAULT_OFFICER = "Discord-Bot";

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Prueft das `x-bot-secret`-Header gegen BOT_SECRET.
 * Ist BOT_SECRET nicht gesetzt, gilt kein Request als Bot-Request — eine
 * fehlende Konfiguration darf niemals Rechte erteilen.
 */
export function isBotRequest(request: FastifyRequest): boolean {
  const secret = process.env.BOT_SECRET;
  if (!secret) return false;
  const header = request.headers["x-bot-secret"];
  if (typeof header !== "string" || header.length === 0) return false;
  return safeEqual(header, secret);
}

/**
 * Setzt `request.user` fuer den Bot-Pfad. Ohne das ist `request.user` null und
 * jeder Handler, der `request.user.bnetTag` liest, wirft einen TypeError (500).
 */
export function markBotRequest(request: FastifyRequest): void {
  request.isBot = true;
  request.user = { sub: BOT_SUBJECT, bnetTag: BOT_DEFAULT_OFFICER };
}

/**
 * Officer-Name fuer eine DKP-Buchung.
 *
 * Beim Bot steht im JWT kein Mensch — der ausfuehrende Discord-Officer kommt
 * deshalb aus dem Body. Ohne diese Angabe wuerde jede ueber Discord gebuchte
 * Transaktion als "Discord-Bot" protokolliert und waere nicht zurueckverfolgbar.
 */
export function resolveOfficerName(
  request: FastifyRequest,
  fromBody?: string | null,
): string {
  if (request.isBot) {
    const trimmed = fromBody?.trim();
    return trimmed && trimmed.length > 0 ? trimmed.slice(0, 64) : BOT_DEFAULT_OFFICER;
  }
  return request.user.bnetTag;
}

/**
 * Guard fuer Endpunkte, die einen echten Spieler-Account brauchen (alles, was
 * `request.user.sub` als players.id verwendet). Der Bot hat keinen solchen
 * Account und wird hier abgewiesen, statt spaeter an einem Fremdschluessel
 * zu scheitern.
 */
export async function requirePlayerAccount(request: FastifyRequest, reply: FastifyReply) {
  if (request.isBot) {
    return reply.status(403).send({ error: "Dieser Endpunkt erfordert ein Spieler-Konto" });
  }
}
