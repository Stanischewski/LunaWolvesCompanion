import "dotenv/config";
import Fastify from "fastify";
import fastifyOAuth2 from "@fastify/oauth2";
import fastifyJwt from "@fastify/jwt";
import fastifyCookie from "@fastify/cookie";
import { authRoutes } from "./routes/auth.js";
import { playerRoutes } from "./routes/players.js";
import { guildRoutes } from "./routes/guilds.js";
import { characterRoutes } from "./routes/characters.js";
import { raidRoutes } from "./routes/raids.js";
import { syncRoutes } from "./routes/sync.js";

const app = Fastify({ logger: true });

await app.register(fastifyCookie);

await app.register(fastifyJwt, {
  secret: process.env.JWT_SECRET ?? "dev-secret-change-me",
  cookie: { cookieName: "token", signed: false },
});

const region = process.env.BNET_REGION ?? "eu";

await app.register(fastifyOAuth2, {
  name: "bnetOAuth2",
  scope: ["openid", "wow.profile"],
  credentials: {
    client: {
      id: process.env.BNET_CLIENT_ID ?? "",
      secret: process.env.BNET_CLIENT_SECRET ?? "",
    },
    auth: {
      authorizeHost: `https://${region}.battle.net`,
      authorizePath: "/oauth/authorize",
      tokenHost: `https://${region}.battle.net`,
      tokenPath: "/oauth/token",
    },
  },
  startRedirectPath: "/auth/bnet",
  callbackUri: process.env.BNET_CALLBACK_URL ?? "http://localhost:3001/auth/bnet/callback",
});

app.decorate("authenticate", async function (request: any, reply: any) {
  try {
    await request.jwtVerify();
  } catch {
    reply.status(401).send({ error: "Nicht authentifiziert" });
  }
});

app.get("/api/v1/health", async () => {
  return { status: "ok", timestamp: new Date().toISOString() };
});

await app.register(authRoutes);
await app.register(playerRoutes, { prefix: "/api/v1" });
await app.register(guildRoutes, { prefix: "/api/v1" });
await app.register(characterRoutes, { prefix: "/api/v1" });
await app.register(raidRoutes, { prefix: "/api/v1" });
await app.register(syncRoutes, { prefix: "/api/v1" });

app.listen({ port: 3001, host: "0.0.0.0" }, (err, address) => {
  if (err) {
    app.log.error(err);
    process.exit(1);
  }
  app.log.info(`API Server läuft auf ${address}`);
});
