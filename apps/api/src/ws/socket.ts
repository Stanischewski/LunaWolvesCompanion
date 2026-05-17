import type { Server } from "socket.io";
import type { FastifyBaseLogger } from "fastify";

export function setupSocketHandlers(io: Server, log: FastifyBaseLogger): void {
  io.on("connection", (socket) => {
    log.info(`[WS] Client verbunden: ${socket.id}`);

    socket.on("join:guild", (guildId: string) => {
      void socket.join(`guild:${guildId}`);
      log.info(`[WS] ${socket.id} → guild:${guildId}`);
    });

    socket.on("disconnect", () => {
      log.info(`[WS] Client getrennt: ${socket.id}`);
    });
  });
}
