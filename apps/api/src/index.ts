import Fastify from "fastify";
import type { Guild } from "@guild/shared-types";

const app = Fastify({ logger: true });

app.get("/api/v1/health", async () => {
  return { status: "ok", timestamp: new Date().toISOString() };
});

app.listen({ port: 3001, host: "0.0.0.0" }, (err, address) => {
  if (err) {
    app.log.error(err);
    process.exit(1);
  }
  app.log.info(`API Server läuft auf ${address}`);
});