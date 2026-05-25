"use server";

import { revalidatePath } from "next/cache";
import { apiPost, apiPut } from "@/lib/api";

export type ActionState = { error?: string; success?: string } | null;

export async function saveSettings(
  guildId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const raidChannelId = (formData.get("raidChannelId") as string)?.trim() || null;
  const dkpChannelId = (formData.get("dkpChannelId") as string)?.trim() || null;

  const parseIds = (raw: string) =>
    raw
      .split(/[\n,]/)
      .map((s) => s.trim())
      .filter(Boolean);

  const adminRoleIds = parseIds((formData.get("adminRoleIds") as string) ?? "");
  const editorRoleIds = parseIds((formData.get("editorRoleIds") as string) ?? "");

  try {
    await apiPut(`/guilds/${guildId}/settings`, { raidChannelId, dkpChannelId, adminRoleIds, editorRoleIds });
    revalidatePath("/dashboard/settings");
    return { success: "Einstellungen gespeichert." };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function setPrimaryGuild(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const guildId = formData.get("guildId") as string;
  if (!guildId) return { error: "Keine Gilde ausgewählt." };
  try {
    await apiPost(`/guilds/${guildId}/set-primary`, {});
    revalidatePath("/dashboard/settings");
    return { success: "Primäre Gilde gesetzt." };
  } catch (e) {
    return { error: (e as Error).message };
  }
}
