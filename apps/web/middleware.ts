import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Prueft, ob das JWT abgelaufen ist — ohne Signaturpruefung, die gehoert in die
 * API. Zuvor reichte die blosse Existenz des Cookies: nach Ablauf der sieben
 * Tage kam der Nutzer ins Dashboard und sah dort eine Fehlerseite, weil jeder
 * API-Aufruf warf, statt zur Anmeldung geschickt zu werden.
 */
function isExpired(token: string): boolean {
  const parts = token.split(".");
  if (parts.length !== 3) return true;
  try {
    const payload = JSON.parse(
      Buffer.from(parts[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"),
    ) as { exp?: number };
    if (typeof payload.exp !== "number") return false;
    return payload.exp * 1000 <= Date.now();
  } catch {
    return true;
  }
}

export function middleware(request: NextRequest) {
  const token = request.cookies.get("auth-token")?.value;

  if (!token || isExpired(token)) {
    const response = NextResponse.redirect(new URL("/?error=session_expired", request.url));
    if (token) response.cookies.delete("auth-token");
    return response;
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*"],
};
