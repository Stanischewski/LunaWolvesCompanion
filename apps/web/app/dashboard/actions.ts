"use server";
import { apiPatch } from "@/lib/api";
import { revalidatePath } from "next/cache";

export async function setDisplayNameAction(formData: FormData) {
  const displayName = (formData.get("displayName") as string).trim() || null;
  await apiPatch("/players/me", { displayName });
  revalidatePath("/dashboard");
}
