import { cookies } from "next/headers";

const API_URL = process.env.API_URL ?? "http://localhost:3001";

export async function apiFetch<T>(path: string): Promise<T> {
  const token = (await cookies()).get("auth-token")?.value;
  const res = await fetch(`${API_URL}/api/v1${path}`, {
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${path}`);
  return res.json();
}
