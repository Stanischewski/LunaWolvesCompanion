import type { ChatInputCommandInteraction } from "discord.js";
import { config } from "./config.js";

/**
 * Officer-Pruefung fuer Discord-Befehle.
 *
 * Fail closed: Ist OFFICER_ROLE_IDS nicht gesetzt, darf niemand die
 * geschuetzten Befehle ausfuehren. Eine fehlende Konfiguration darf nie in
 * mehr Rechte muenden.
 */
export function isOfficer(interaction: ChatInputCommandInteraction): boolean {
  const roleIds = config.officerRoleIds;
  if (roleIds.length === 0) {
    console.warn("[Permissions] OFFICER_ROLE_IDS ist nicht gesetzt — Officer-Befehle sind gesperrt.");
    return false;
  }
  const roles = interaction.member?.roles;
  if (!roles) return false;
  if (Array.isArray(roles)) return roleIds.some((id) => roles.includes(id));
  if ("cache" in roles) return roleIds.some((id) => roles.cache.has(id));
  return false;
}

/** Name des ausfuehrenden Officers fuer Protokolleintraege. */
export function officerLabel(interaction: ChatInputCommandInteraction): string {
  return interaction.user.displayName;
}
