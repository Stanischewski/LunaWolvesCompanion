import "@fastify/jwt";
import type { OAuth2Namespace } from "@fastify/oauth2";
import type { Server as SocketServer } from "socket.io";

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: { sub: string; bnetTag: string };
    user: { sub: string; bnetTag: string };
  }
}

declare module "fastify" {
  interface FastifyInstance {
    bnetOAuth2: OAuth2Namespace;
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<unknown>;
    io: SocketServer;
  }

  interface FastifyRequest {
    /** true, wenn der Request ueber das Bot-Secret authentifiziert wurde. */
    isBot: boolean;
  }
}
