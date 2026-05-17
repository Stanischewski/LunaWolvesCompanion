import { SlashCommandBuilder } from "discord.js";
import type { ChatInputCommandInteraction, AutocompleteInteraction } from "discord.js";
import { api } from "../api.js";
import { playerEmbed, compareEmbed } from "../embeds.js";
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
    )
    .addSubcommand((sub) =>
      sub
        .setName("compare")
        .setDescription("Zwei Charaktere vergleichen")
        .addStringOption((opt) =>
          opt
            .setName("charakter_a")
            .setDescription("Erster Charakter")
            .setRequired(true)
            .setAutocomplete(true),
        )
        .addStringOption((opt) =>
          opt
            .setName("charakter_b")
            .setDescription("Zweiter Charakter")
            .setRequired(true)
            .setAutocomplete(true),
        ),
    ),

  execute: async (interaction: ChatInputCommandInteraction) => {
    const sub = interaction.options.getSubcommand();
    await interaction.deferReply();

    try {
      const members = await api.guild.members();

      if (sub === "info") {
        const name = interaction.options.getString("name", true);
        const member = members.find((m) => m.name.toLowerCase() === name.toLowerCase());
        if (!member) {
          await interaction.editReply({ content: `❌ Charakter **${name}** nicht in der Gilde gefunden.` });
          return;
        }
        await interaction.editReply({ embeds: [playerEmbed(member)] });
      } else if (sub === "compare") {
        const nameA = interaction.options.getString("charakter_a", true);
        const nameB = interaction.options.getString("charakter_b", true);
        const memberA = members.find((m) => m.name.toLowerCase() === nameA.toLowerCase());
        const memberB = members.find((m) => m.name.toLowerCase() === nameB.toLowerCase());

        if (!memberA) {
          await interaction.editReply({ content: `❌ Charakter **${nameA}** nicht in der Gilde gefunden.` });
          return;
        }
        if (!memberB) {
          await interaction.editReply({ content: `❌ Charakter **${nameB}** nicht in der Gilde gefunden.` });
          return;
        }
        if (memberA.id === memberB.id) {
          await interaction.editReply({ content: "❌ Bitte zwei verschiedene Charaktere auswählen." });
          return;
        }
        await interaction.editReply({ embeds: [compareEmbed(memberA, memberB)] });
      }
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
