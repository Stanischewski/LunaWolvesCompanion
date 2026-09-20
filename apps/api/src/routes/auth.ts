import type { FastifyInstance } from "fastify";
import { db } from "../db/index.js";
import { players } from "../db/schema.js";
import { eq } from "drizzle-orm";
import { issueCode, redeemCode } from "../lib/authCodes.js";
import { encryptToken } from "../lib/crypto.js";

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

    const bnetAccessToken = token.token.access_token as string;
    const expiresIn = (token.token.expires_in as number | undefined) ?? 86400;
    const bnetTokenExpiry = new Date(Date.now() + expiresIn * 1000);

    let player = await db.query.players.findFirst({
      where: eq(players.bnetId, userinfo.sub),
    });

    if (!player) {
      const [created] = await db
        .insert(players)
        .values({
          bnetId: userinfo.sub,
          bnetTag: userinfo.battletag,
          bnetAccessToken: encryptToken(bnetAccessToken),
          bnetTokenExpiry,
        })
        .returning();
      player = created;
    } else {
      const [updated] = await db
        .update(players)
        .set({
          bnetTag: userinfo.battletag,
          bnetAccessToken: encryptToken(bnetAccessToken),
          bnetTokenExpiry,
        })
        .where(eq(players.bnetId, userinfo.sub))
        .returning();
      player = updated;
    }

    const jwt = app.jwt.sign(
      { sub: player.id, bnetTag: player.bnetTag },
      { expiresIn: "7d" }
    );

    // Desktop-Agent: kam der Flow von /auth/desktop, wird das Ergebnis an den
    // lokalen Loopback-Server des Agents weitergeleitet (Host fest 127.0.0.1).
    //
    // Unterwegs ist nur ein Einmal-Code, kein JWT: der Code ist 60 Sekunden
    // gültig, genau einmal einlösbar und liegt serverseitig nur als Hash.
    // Der `state`-Nonce bindet die Rückleitung an genau die Anmeldung, die der
    // Agent gestartet hat — ohne ihn könnte ein lokaler Prozess, der die Ports
    // durchprobiert, dem Agent ein fremdes Token unterschieben.
    const desktopPort = request.cookies.desktop_port;
    const desktopState = request.cookies.desktop_state;
    if (desktopPort) {
      reply.clearCookie("desktop_port", { path: "/" });
      reply.clearCookie("desktop_state", { path: "/" });
      const port = Number(desktopPort);
      if (Number.isInteger(port) && port >= 1024 && port <= 65535 && desktopState) {
        const code = issueCode(jwt);
        return reply.redirect(
          `http://127.0.0.1:${port}/?code=${encodeURIComponent(code)}` +
            `&state=${encodeURIComponent(desktopState)}`,
        );
      }
      return reply.status(400).send({ error: "Ungueltige Desktop-Anmeldung" });
    }

    const frontendUrl = process.env.FRONTEND_URL;
    if (frontendUrl) {
      const code = issueCode(jwt);
      return reply.redirect(`${frontendUrl}/auth/callback?code=${encodeURIComponent(code)}`);
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
  app.get<{ Querystring: { port?: string; state?: string } }>(
    "/auth/desktop",
    async (request, reply) => {
      const port = Number(request.query.port);
      if (!Number.isInteger(port) || port < 1024 || port > 65535) {
        return reply.status(400).send({ error: "Ungueltiger Port" });
      }

      // Der Agent erzeugt den state-Nonce und vergleicht ihn beim Rücklauf.
      const state = request.query.state;
      if (typeof state !== "string" || state.length < 16 || state.length > 128) {
        return reply.status(400).send({ error: "Ungueltiger state-Parameter" });
      }

      const cookieOpts = {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax" as const,
        path: "/",
        maxAge: 600,
      };
      reply.setCookie("desktop_port", String(port), cookieOpts);
      reply.setCookie("desktop_state", state, cookieOpts);
      return reply.redirect("/auth/bnet");
    },
  );

  // Tauscht einen Einmal-Code gegen das JWT. Bewusst POST: Query-Parameter
  // landen in Logs und Verläufen, ein Request-Body nicht.
  app.post<{ Body: { code?: unknown } }>("/auth/exchange", async (request, reply) => {
    const { code } = request.body ?? {};
    if (typeof code !== "string" || !code) {
      return reply.status(400).send({ error: "code erforderlich" });
    }
    const token = redeemCode(code);
    if (!token) {
      return reply.status(400).send({ error: "Code ungültig oder abgelaufen" });
    }
    return { token };
  });

  app.get("/auth/me", { onRequest: [app.authenticate] }, async (request) => {
    return request.user;
  });

  // --- Discord Account Linking ---

  // Initiates the Discord OAuth flow for an already-logged-in player.
  // The JWT is passed as a query param from the web proxy route.
  // Stellt ein kurzlebiges Ticket für den Discord-Link aus. Der Aufruf kommt
  // vom Web-Server (mit Authorization-Header), nicht aus dem Browser.
  app.post("/auth/discord/ticket", { onRequest: [app.authenticate] }, async (request) => {
    return { ticket: issueCode(request.user.sub) };
  });

  app.get<{ Querystring: { ticket?: string } }>("/auth/discord/link", async (request, reply) => {
    const clientId = process.env.DISCORD_CLIENT_ID;
    const callbackUrl = process.env.DISCORD_CALLBACK_URL ?? "http://localhost:3001/auth/discord/callback";

    if (!clientId) {
      return reply.status(501).send({ error: "Discord OAuth nicht konfiguriert" });
    }

    // Früher stand hier das komplette JWT als Query-Parameter — und damit im
    // Klartext in den Fastify-Logs, weil `logger: true` req.url protokolliert.
    const { ticket } = request.query;
    if (!ticket) return reply.status(400).send({ error: "Kein Ticket" });

    const playerId = redeemCode(ticket);
    if (!playerId) {
      return reply.status(401).send({ error: "Ticket ungültig oder abgelaufen" });
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
