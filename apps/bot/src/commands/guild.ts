import { SlashCommandBuilder } from "discord.js";
import type { ChatInputCommandInteraction } from "discord.js";
import { api } from "../api.js";
import { guildStatusEmbed, rosterEmbed, activityEmbed } from "../embeds.js";
import type { Command } from "./index.js";

export const guildCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("guild")
    .setDescription("Gilden-Informationen")
    .addSubcommand((sub) =>
      sub.setName("status").setDescription("Aktueller Gildenstatus"),
    )
    .addSubcommand((sub) =>
      sub.setName("roster").setDescription("Mitgliederliste sortiert nach Item-Level"),
    )
    .addSubcommand((sub) =>
      sub.setName("activity").setDescription("Zuletzt aktive Mitglieder"),
    ),

  execute: async (interaction: ChatInputCommandInteraction) => {
    await interaction.deferReply();
    try {
      const sub = interaction.options.getSubcommand();
      if (sub === "status") {
        const guild = await api.guild.get();
        await interaction.editReply({ embeds: [guildStatusEmbed(guild)] });
      } else if (sub === "roster") {
        const [guild, members] = await Promise.all([api.guild.get(), api.guild.members()]);
        await interaction.editReply({ embeds: [rosterEmbed(guild, members)] });
      } else if (sub === "activity") {
        const [guild, members] = await Promise.all([api.guild.get(), api.guild.members()]);
        await interaction.editReply({ embeds: [activityEmbed(guild, members)] });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unbekannter Fehler";
      await interaction.editReply({ content: `❌ ${msg}` });
    }
  },
};
