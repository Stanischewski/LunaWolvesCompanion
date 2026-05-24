"use server";

import { revalidatePath } from "next/cache";
import { apiPut } from "@/lib/api";

export type ActionState = { error?: string; success?: string } | null;

export async function saveSettings(
  guildId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const raidChannelId = (formData.get("raidChannelId") as string)?.trim() || null;

  const parseIds = (raw: string) =>
    raw
      .split(/[\n,]/)
      .map((s) => s.trim())
      .filter(Boolean);

  const adminRoleIds = parseIds((formData.get("adminRoleIds") as string) ?? "");
  const editorRoleIds = parseIds((formData.get("editorRoleIds") as string) ?? "");

  try {
    await apiPut(`/guilds/${guildId}/settings`, { raidChannelId, adminRoleIds, editorRoleIds });
    revalidatePath("/dashboard/settings");
    return { success: "Einstellungen gespeichert." };
  } catch (e) {
    return { error: (e as Error).message };
  }
}
