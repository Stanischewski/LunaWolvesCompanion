import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export async function GET() {
  const token = (await cookies()).get("auth-token")?.value;
  if (!token) return redirect("/?error=not_logged_in");

  const apiUrl = process.env.API_URL ?? "http://localhost:3001";
  return redirect(`${apiUrl}/auth/discord/link?token=${token}`);
}
