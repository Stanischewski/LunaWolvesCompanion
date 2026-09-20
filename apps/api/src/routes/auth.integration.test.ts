/**
 * Integrationstest fuer den OAuth-Rueckweg.
 *
 * Laeuft ohne Datenbank: geprueft wird der Code-Tausch, nicht der
 * Battle.net-Flow. Die DB-gestuetzten Routen haben eigene Tests, die eine
 * Postgres-Instanz brauchen (siehe .github/workflows/ci.yml).
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Fastify, { type FastifyInstance } from "fastify";
import fastifyJwt from "@fastify/jwt";
import fastifyCookie from "@fastify/cookie";
import { issueCode, _resetCodes } from "../lib/authCodes.js";

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(fastifyCookie);
  await app.register(fastifyJwt, { secret: "test-secret" });

  // Nur die beiden Routen nachbilden, die den Code-Tausch ausmachen —
  // authRoutes selbst zieht die Datenbank mit herein.
  app.post<{ Body: { code?: unknown } }>("/auth/exchange", async (request, reply) => {
    const { redeemCode } = await import("../lib/authCodes.js");
    const { code } = request.body ?? {};
    if (typeof code !== "string" || !code) {
      return reply.status(400).send({ error: "code erforderlich" });
    }
    const token = redeemCode(code);
    if (!token) return reply.status(400).send({ error: "Code ungültig oder abgelaufen" });
    return { token };
  });

  return app;
}

describe("POST /auth/exchange", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    _resetCodes();
    app = await buildApp();
  });

  it("tauscht einen gültigen Code gegen das Token", async () => {
    const code = issueCode("das-jwt");
    const res = await app.inject({ method: "POST", url: "/auth/exchange", payload: { code } });
    assert.equal(res.statusCode, 200);
    assert.equal(JSON.parse(res.body).token, "das-jwt");
  });

  it("lehnt denselben Code beim zweiten Mal ab", async () => {
    const code = issueCode("das-jwt");
    await app.inject({ method: "POST", url: "/auth/exchange", payload: { code } });
    const res = await app.inject({ method: "POST", url: "/auth/exchange", payload: { code } });
    assert.equal(res.statusCode, 400);
  });

  it("lehnt erfundene Codes ab", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/auth/exchange",
      payload: { code: "frei-erfunden" },
    });
    assert.equal(res.statusCode, 400);
  });

  it("verlangt einen code im Body", async () => {
    for (const payload of [{}, { code: 42 }, { code: "" }]) {
      const res = await app.inject({ method: "POST", url: "/auth/exchange", payload });
      assert.equal(res.statusCode, 400, `Body ${JSON.stringify(payload)} muss 400 geben`);
    }
  });

  it("nimmt den Code aus dem Body, nicht aus der Query", async () => {
    // Der Sinn der Umstellung: Query-Parameter landen in Logs und Verläufen.
    const code = issueCode("jwt");
    const res = await app.inject({
      method: "POST",
      url: `/auth/exchange?code=${code}`,
      payload: {},
    });
    assert.equal(res.statusCode, 400);
  });
});
