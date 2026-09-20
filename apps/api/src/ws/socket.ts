import type { Server, Socket } from "socket.io";
import type { FastifyBaseLogger, FastifyInstance } from "fastify";
import { eq, and } from "drizzle-orm";
import { db } from "../db/index.js";
import { characters } from "../db/schema.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Obergrenze, damit ein Client nicht beliebig viele Räume belegt. */
const MAX_ROOMS_PER_SOCKET = 5;

interface SocketUser {
  sub: string;
  bnetTag: string;
}

/**
 * WebSocket-Handler.
 *
 * Zuvor konnte sich jeder anonyme Client verbinden und mit `join:guild`
 * jedem beliebigen Gildenraum beitreten — und bekam damit `dkp_update`,
 * `raid_signup` und `member_seen` einer fremden Gilde live mit. Geschützt war
 * das nur durch die Unkenntnis der Gilden-UUID.
 *
 * Jetzt:
 *  - Das JWT wird beim Handshake geprüft (`auth.token` oder Authorization-Header)
 *  - `join:guild` verlangt, dass der Spieler einen Charakter in dieser Gilde hat
 *  - Die Zahl der Räume je Verbindung ist begrenzt
 */
export function setupSocketHandlers(
  io: Server,
  log: FastifyBaseLogger,
  app: FastifyInstance,
): void {
  io.use((socket, next) => {
    const raw =
      (socket.handshake.auth as { token?: unknown } | undefined)?.token ??
      socket.handshake.headers.authorization?.replace(/^Bearer /i, "");

    if (typeof raw !== "string" || !raw) {
      return next(new Error("Nicht authentifiziert"));
    }

    try {
      const user = app.jwt.verify<SocketUser>(raw);
      (socket.data as { user?: SocketUser }).user = user;
      return next();
    } catch {
      return next(new Error("Ungültiges Token"));
    }
  });

  io.on("connection", (socket: Socket) => {
    const user = (socket.data as { user: SocketUser }).user;
    log.info(`[WS] Client verbunden: ${socket.id} (${user.bnetTag})`);

    socket.on("join:guild", async (guildId: unknown, ack?: (res: unknown) => void) => {
      const reply = (ok: boolean, error?: string) => {
        if (typeof ack === "function") ack(ok ? { ok: true } : { ok: false, error });
      };

      if (typeof guildId !== "string" || !UUID_RE.test(guildId)) {
        return reply(false, "Ungültige Gilden-ID");
      }

      // socket.rooms enthält immer den eigenen Socket-Raum — der zählt nicht.
      if (socket.rooms.size - 1 >= MAX_ROOMS_PER_SOCKET) {
        return reply(false, "Zu viele Räume");
      }

      const member = await db.query.characters.findFirst({
        where: and(eq(characters.guildId, guildId), eq(characters.playerId, user.sub)),
        columns: { id: true },
      });

      if (!member) {
        log.warn(`[WS] ${user.bnetTag} ohne Charakter in Gilde ${guildId} abgewiesen.`);
        return reply(false, "Kein Charakter in dieser Gilde");
      }

      void socket.join(`guild:${guildId}`);
      log.info(`[WS] ${socket.id} → guild:${guildId}`);
      reply(true);
    });

    socket.on("disconnect", () => {
      log.info(`[WS] Client getrennt: ${socket.id}`);
    });
  });
}
