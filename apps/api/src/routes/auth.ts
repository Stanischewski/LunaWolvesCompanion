import type { FastifyInstance } from "fastify";
import { db } from "../db/index.js";
import { players } from "../db/schema.js";
import { eq } from "drizzle-orm";

interface BnetUserInfo {
  sub: string;
  battletag: string;
}

interface DiscordUserInfo {
  id: string;
  username: string;
  global_name: string | null;
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

  // --- Discord Account Linking ---

  // Initiates the Discord OAuth flow for an already-logged-in player.
  // The JWT is passed as a query param from the web proxy route.
  app.get<{ Querystring: { token?: string } }>("/auth/discord/link", async (request, reply) => {
    const clientId = process.env.DISCORD_CLIENT_ID;
    const callbackUrl = process.env.DISCORD_CALLBACK_URL ?? "http://localhost:3001/auth/discord/callback";

    if (!clientId) {
      return reply.status(501).send({ error: "Discord OAuth nicht konfiguriert" });
    }

    const { token } = request.query;
    if (!token) return reply.status(400).send({ error: "Kein Token" });

    let playerId: string;
    try {
      const decoded = app.jwt.verify<{ sub: string }>(token);
      playerId = decoded.sub;
    } catch {
      return reply.status(401).send({ error: "Ungültiger Token" });
    }

    reply.setCookie("discord_link_player", playerId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 300,
    });

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: callbackUrl,
      response_type: "code",
      scope: "identify",
    });

    return reply.redirect(`https://discord.com/oauth2/authorize?${params}`);
  });

  app.get<{ Querystring: { code?: string; error?: string } }>(
    "/auth/discord/callback",
    async (request, reply) => {
      const frontendUrl = process.env.FRONTEND_URL ?? "http://localhost:3000";
      const { code, error } = request.query;

      if (error || !code) {
        return reply.redirect(`${frontendUrl}/dashboard?discord_error=1`);
      }

      const playerId = request.cookies.discord_link_player;
      if (!playerId) {
        return reply.redirect(`${frontendUrl}/dashboard?discord_error=session`);
      }

      reply.clearCookie("discord_link_player", { path: "/" });

      const clientId = process.env.DISCORD_CLIENT_ID ?? "";
      const clientSecret = process.env.DISCORD_CLIENT_SECRET ?? "";
      const callbackUrl = process.env.DISCORD_CALLBACK_URL ?? "http://localhost:3001/auth/discord/callback";

      // Exchange code for access token
      const tokenRes = await fetch("https://discord.com/api/oauth2/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          grant_type: "authorization_code",
          code,
          redirect_uri: callbackUrl,
        }),
      });

      if (!tokenRes.ok) {
        return reply.redirect(`${frontendUrl}/dashboard?discord_error=token`);
      }

      const tokenData = (await tokenRes.json()) as { access_token: string };

      // Fetch Discord user info
      const userRes = await fetch("https://discord.com/api/users/@me", {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
      });

      if (!userRes.ok) {
        return reply.redirect(`${frontendUrl}/dashboard?discord_error=userinfo`);
      }

      const discordUser = (await userRes.json()) as DiscordUserInfo;
      const discordTag = discordUser.global_name ?? discordUser.username;

      await db
        .update(players)
        .set({ discordId: discordUser.id, discordTag })
        .where(eq(players.id, playerId));

      return reply.redirect(`${frontendUrl}/dashboard?discord_linked=1`);
    },
  );
}
