import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";

const API_URL = process.env.API_URL ?? "http://localhost:3001";

/**
 * Loest den Einmal-Code der API gegen das JWT ein — serverseitig, per POST.
 *
 * Frueher stand das fertige Token als Query-Parameter in dieser URL und landete
 * damit in Browser-Verlauf und `Referer`-Headern. Der Code ist 60 Sekunden
 * gueltig und genau einmal einloesbar.
 */
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  if (!code) return redirect("/?error=no_code");

  let token: string;
  try {
    const res = await fetch(`${API_URL}/auth/exchange`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
      cache: "no-store",
    });
    if (!res.ok) return redirect("/?error=invalid_code");
    ({ token } = (await res.json()) as { token: string });
  } catch {
    return redirect("/?error=api_unreachable");
  }

  (await cookies()).set("auth-token", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });

  return redirect("/dashboard");
}
