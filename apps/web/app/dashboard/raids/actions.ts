"use server";
import { apiPost, apiPatch } from "@/lib/api";
import { revalidatePath } from "next/cache";
import { resolveGuild } from "@/lib/guild";

export async function createRaidAction(formData: FormData) {
  const guild = await resolveGuild();
  if (!guild) throw new Error("Keine Gilde gefunden");

  const title = formData.get("title") as string;
  const scheduledAt = formData.get("scheduledAt") as string;
  const description = (formData.get("description") as string) || undefined;
  const raidType = (formData.get("raidType") as string) || undefined;
  const minIlvlStr = formData.get("minIlvl") as string;
  const minIlvl = minIlvlStr ? parseInt(minIlvlStr, 10) : undefined;

  await apiPost(`/guilds/${guild.id}/raids`, {
    title,
    scheduledAt: new Date(scheduledAt).toISOString(),
    ...(description && { description }),
    ...(raidType && { raidType }),
    ...(minIlvl !== undefined && !isNaN(minIlvl) && { minIlvl }),
  });

  revalidatePath("/dashboard/raids");
}

export async function editRaidAction(raidId: string, formData: FormData) {
  const title = formData.get("title") as string;
  const scheduledAt = formData.get("scheduledAt") as string;
  const description = (formData.get("description") as string) || null;
  const raidType = (formData.get("raidType") as string) || null;
  const minIlvlStr = formData.get("minIlvl") as string;
  const minIlvl = minIlvlStr ? parseInt(minIlvlStr, 10) : null;

  await apiPatch(`/raids/${raidId}`, {
    title,
    scheduledAt: new Date(scheduledAt).toISOString(),
    description,
    raidType,
    minIlvl: minIlvl !== null && !isNaN(minIlvl) ? minIlvl : null,
  });

  revalidatePath("/dashboard/raids");
}

export async function signupRaidAction(raidId: string, formData: FormData) {
  const characterId = formData.get("characterId") as string;
  const role = formData.get("role") as string;
  const status = (formData.get("status") as string) || "yes";

  await apiPost(`/raids/${raidId}/signup`, { characterId, role, status });
  revalidatePath("/dashboard/raids");
}
