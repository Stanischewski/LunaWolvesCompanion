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

    reply.setCookie("token", jwt, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 7,
    });

    return reply.send({ ok: true, bnetTag: player.bnetTag });
  });

  app.get("/auth/me", { onRequest: [app.authenticate] }, async (request) => {
    return request.user;
  });
}
