import { SlashCommandBuilder } from "discord.js";
import type { ChatInputCommandInteraction, AutocompleteInteraction } from "discord.js";
import { api } from "../api.js";
import { config } from "../config.js";
import { dkpStandingsEmbed, dkpPlayerEmbed, dkpHistoryEmbed } from "../embeds.js";
import type { Command } from "./index.js";

function isOfficer(interaction: ChatInputCommandInteraction): boolean {
  const roleIds = config.officerRoleIds;
  if (roleIds.length === 0) return true;
  const roles = interaction.member?.roles;
  if (!roles) return false;
  if (Array.isArray(roles)) return roleIds.some((id) => roles.includes(id));
  if ("cache" in roles) return roleIds.some((id) => roles.cache.has(id));
  return false;
}

export const dkpCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("dkp")
    .setDescription("DKP-Verwaltung")
    .addSubcommand((sub) =>
      sub.setName("standings").setDescription("DKP-Rangliste anzeigen"),
    )
    .addSubcommand((sub) =>
      sub
        .setName("player")
        .setDescription("DKP eines Spielers anzeigen")
        .addStringOption((opt) =>
          opt
            .setName("name")
            .setDescription("Spielername")
            .setRequired(true)
            .setAutocomplete(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("history")
        .setDescription("Letzte DKP-Einträge anzeigen")
        .addStringOption((opt) =>
          opt
            .setName("player")
            .setDescription("Spieler filtern (optional)")
            .setAutocomplete(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("award")
        .setDescription("DKP vergeben (Officer)")
        .addStringOption((opt) =>
          opt
            .setName("player")
            .setDescription("Spielername")
            .setRequired(true)
            .setAutocomplete(true),
        )
        .addIntegerOption((opt) =>
          opt.setName("amount").setDescription("Menge (> 0)").setRequired(true).setMinValue(1),
        )
        .addStringOption((opt) => opt.setName("reason").setDescription("Grund")),
    )
    .addSubcommand((sub) =>
      sub
        .setName("spend")
        .setDescription("DKP abziehen (Officer)")
        .addStringOption((opt) =>
          opt
            .setName("player")
            .setDescription("Spielername")
            .setRequired(true)
            .setAutocomplete(true),
        )
        .addIntegerOption((opt) =>
          opt.setName("amount").setDescription("Menge (> 0)").setRequired(true).setMinValue(1),
        )
        .addStringOption((opt) => opt.setName("reason").setDescription("Grund")),
    ),

  execute: async (interaction: ChatInputCommandInteraction) => {
    await interaction.deferReply();
    try {
      const sub = interaction.options.getSubcommand();

      if (sub === "standings") {
        const standings = await api.dkp.standings();
        await interaction.editReply({ embeds: [dkpStandingsEmbed(standings)] });
      } else if (sub === "player") {
        const name = interaction.options.getString("name", true);
        const standing = await api.dkp.player(name);
        await interaction.editReply({ embeds: [dkpPlayerEmbed(standing)] });
      } else if (sub === "history") {
        const player = interaction.options.getString("player") ?? undefined;
        const entries = await api.dkp.history(player);
        await interaction.editReply({ embeds: [dkpHistoryEmbed(entries, player)] });
      } else if (sub === "award") {
        if (!isOfficer(interaction)) {
          await interaction.editReply({ content: "❌ Nur Officers können DKP vergeben." });
          return;
        }
        const player = interaction.options.getString("player", true);
        const amount = interaction.options.getInteger("amount", true);
        const reason = interaction.options.getString("reason") ?? "Discord Award";
        await api.dkp.award(player, amount, reason);
        await interaction.editReply({
          content: `✅ **${player}** hat **+${amount} DKP** erhalten. Grund: ${reason}`,
        });
      } else if (sub === "spend") {
        if (!isOfficer(interaction)) {
          await interaction.editReply({ content: "❌ Nur Officers können DKP abziehen." });
          return;
        }
        const player = interaction.options.getString("player", true);
        const amount = interaction.options.getInteger("amount", true);
        const reason = interaction.options.getString("reason") ?? "Discord Spend";
        await api.dkp.spend(player, amount, reason);
        await interaction.editReply({
          content: `✅ **${player}** hat **-${amount} DKP** ausgegeben. Grund: ${reason}`,
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unbekannter Fehler";
      await interaction.editReply({ content: `❌ ${msg}` });
    }
  },

  autocomplete: async (interaction: AutocompleteInteraction) => {
    const standings = await api.dkp.standings().catch(() => []);
    const query = interaction.options.getFocused().toLowerCase();
    const choices = standings
      .filter((s) => s.playerName.toLowerCase().startsWith(query))
      .slice(0, 25)
      .map((s) => ({ name: s.playerName, value: s.playerName }));
    await interaction.respond(choices);
  },
};
