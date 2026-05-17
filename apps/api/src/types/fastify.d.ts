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
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    io: SocketServer;
  }
}
