import type { FastifyInstance } from "fastify";
import { db } from "../db/index.js";
import { players } from "../db/schema.js";
import { eq } from "drizzle-orm";

interface BnetUserInfo {
  sub: string;
  battletag: string;
}

export async function authRoutes(app: FastifyInstance) {
  app.get("/auth/bnet/callback", async (request, reply) => {
    const token =
      await app.bnetOAuth2.getAccessTokenFromAuthorizationCodeFlow(request, reply);

    const region = process.env.BNET_REGION ?? "eu";
    const res = await fetch(`https://${region}.battle.net/oauth/userinfo`, {
      headers: { Authorization: `Bearer ${token.token.access_token}` },
    });

    if (!res.ok) {
      return reply.status(502).send({ error: "Battle.net userinfo fehlgeschlagen" });
    }

    const userinfo = (await res.json()) as BnetUserInfo;

    let player = await db.query.players.findFirst({
      where: eq(players.bnetId, userinfo.sub),
    });

    if (!player) {
      const [created] = await db
        .insert(players)
        .values({ bnetId: userinfo.sub, bnetTag: userinfo.battletag })
        .returning();
      player = created;
    }

    const jwt = app.jwt.sign(
      { sub: player.id, bnetTag: player.bnetTag },
      { expiresIn: "7d" }
    );

    // Desktop-Agent: kam der Flow von /auth/desktop, wird das Token an den
    // lokalen Loopback-Server des Agents weitergeleitet (Host fest 127.0.0.1).
    const desktopPort = request.cookies.desktop_port;
    if (desktopPort) {
      reply.clearCookie("desktop_port", { path: "/" });
      const port = Number(desktopPort);
      if (Number.isInteger(port) && port >= 1024 && port <= 65535) {
        return reply.redirect(`http://127.0.0.1:${port}/?token=${jwt}`);
      }
    }

    const frontendUrl = process.env.FRONTEND_URL;
    if (frontendUrl) {
      return reply.redirect(`${frontendUrl}/auth/callback?token=${jwt}`);
    }

    reply.setCookie("token", jwt, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 7,
    });

    return reply.send({ ok: true, bnetTag: player.bnetTag });
  });

  // Startpunkt fuer den Desktop-Agent: merkt sich den Loopback-Port in einem
  // Cookie und startet dann den normalen Battle.net-OAuth-Flow.
  app.get<{ Querystring: { port?: string } }>("/auth/desktop", async (request, reply) => {
    const port = Number(request.query.port);
    if (!Number.isInteger(port) || port < 1024 || port > 65535) {
      return reply.status(400).send({ error: "Ungueltiger Port" });
    }
    reply.setCookie("desktop_port", String(port), {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 600,
    });
    return reply.redirect("/auth/bnet");
  });

  app.get("/auth/me", { onRequest: [app.authenticate] }, async (request) => {
    return request.user;
  });
}
