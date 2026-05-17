"use server";

import { revalidatePath } from "next/cache";
import { apiPost } from "@/lib/api";

export type ActionState = { error?: string; success?: string } | null;

export async function awardDkp(
  guildId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const playerName = (formData.get("playerName") as string)?.trim();
  const amount = Number(formData.get("amount"));
  const reason = (formData.get("reason") as string)?.trim() || "Manuell";
  const entryType = (formData.get("entryType") as string) || "manual";

  if (!playerName) return { error: "Spielername erforderlich" };
  if (!(amount > 0)) return { error: "Betrag muss größer als 0 sein" };

  try {
    await apiPost(`/guilds/${guildId}/dkp/award`, { playerName, amount, reason, entryType });
    revalidatePath("/dashboard/dkp");
    return { success: `${amount} DKP an ${playerName} vergeben.` };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function spendDkp(
  guildId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const playerName = (formData.get("playerName") as string)?.trim();
  const amount = Number(formData.get("amount"));
  const reason = (formData.get("reason") as string)?.trim() || "Ausgabe";

  if (!playerName) return { error: "Spielername erforderlich" };
  if (!(amount > 0)) return { error: "Betrag muss größer als 0 sein" };

  try {
    await apiPost(`/guilds/${guildId}/dkp/spend`, { playerName, amount, reason });
    revalidatePath("/dashboard/dkp");
    return { success: `${amount} DKP von ${playerName} abgezogen.` };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function resetSeason(
  guildId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const seasonName = (formData.get("seasonName") as string)?.trim() || undefined;

  try {
    await apiPost(`/guilds/${guildId}/dkp/reset`, { seasonName });
    revalidatePath("/dashboard/dkp");
    return { success: `Season-Reset durchgeführt${seasonName ? `: ${seasonName}` : ""}.` };
  } catch (e) {
    return { error: (e as Error).message };
  }
}
