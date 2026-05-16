import { SlashCommandBuilder } from "discord.js";
import type { ChatInputCommandInteraction, AutocompleteInteraction } from "discord.js";
import { api } from "../api.js";
import { playerEmbed } from "../embeds.js";
import type { Command } from "./index.js";

export const playerCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("player")
    .setDescription("Spieler-Informationen")
    .addSubcommand((sub) =>
      sub
        .setName("info")
        .setDescription("Charakter-Infos anzeigen")
        .addStringOption((opt) =>
          opt
            .setName("name")
            .setDescription("Charaktername")
            .setRequired(true)
            .setAutocomplete(true),
        ),
    ),

  execute: async (interaction: ChatInputCommandInteraction) => {
    await interaction.deferReply();
    try {
      const name = interaction.options.getString("name", true);
      const members = await api.guild.members();
      const member = members.find((m) => m.name.toLowerCase() === name.toLowerCase());
      if (!member) {
        await interaction.editReply({
          content: `❌ Charakter **${name}** nicht in der Gilde gefunden.`,
        });
        return;
      }
      await interaction.editReply({ embeds: [playerEmbed(member)] });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unbekannter Fehler";
      await interaction.editReply({ content: `❌ ${msg}` });
    }
  },

  autocomplete: async (interaction: AutocompleteInteraction) => {
    const focused = interaction.options.getFocused().toLowerCase();
    const members = await api.guild.members().catch(() => []);
    const choices = members
      .filter((m) => m.name.toLowerCase().startsWith(focused))
      .slice(0, 25)
      .map((m) => ({ name: m.name, value: m.name }));
    await interaction.respond(choices);
  },
};
