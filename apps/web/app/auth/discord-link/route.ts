import { cookies } from "next/headers";
import { redirect } from "next/navigation";

const API_URL = process.env.API_URL ?? "http://localhost:3001";

/**
 * Holt serverseitig ein kurzlebiges Ticket und schickt den Browser damit zur
 * API. Zuvor ging hier das komplette JWT als Query-Parameter an die API — und
 * damit in deren Logs, weil Fastify mit `logger: true` req.url protokolliert.
 */
export async function GET() {
  const token = (await cookies()).get("auth-token")?.value;
  if (!token) return redirect("/?error=not_logged_in");

  let ticket: string;
  try {
    const res = await fetch(`${API_URL}/auth/discord/ticket`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    if (!res.ok) return redirect("/dashboard?discord_error=ticket");
    ({ ticket } = (await res.json()) as { ticket: string });
  } catch {
    return redirect("/dashboard?discord_error=api");
  }

  return redirect(`${API_URL}/auth/discord/link?ticket=${encodeURIComponent(ticket)}`);
}
