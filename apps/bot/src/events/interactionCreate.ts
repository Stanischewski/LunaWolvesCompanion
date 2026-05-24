import { Events, ActionRowBuilder, StringSelectMenuBuilder } from "discord.js";
import type { Client, Interaction } from "discord.js";
import { commands } from "../commands/index.js";
import { api } from "../api.js";
import { updateCalendarMessage } from "../calendar.js";

const ROLE_LABELS: Record<string, string> = {
  tank: "🛡️ Tank",
  heal: "💚 Heiler",
  dps: "⚔️ DPS",
};

export const interactionCreateEvent = {
  name: Events.InteractionCreate as string,
  execute: async (interaction: Interaction) => {
    if (interaction.isAutocomplete()) {
      const command = commands.get(interaction.commandName);
      if (command?.autocomplete) {
        await command.autocomplete(interaction).catch(console.error);
      }
      return;
    }

    if (interaction.isChatInputCommand()) {
      const command = commands.get(interaction.commandName);
      if (!command) return;
      await command.execute(interaction).catch(async (err: unknown) => {
        console.error(err);
        const msg = err instanceof Error ? err.message : "Unbekannter Fehler";
        if (interaction.deferred || interaction.replied) {
          await interaction.editReply({ content: `❌ ${msg}` });
        } else {
          await interaction.reply({ content: `❌ ${msg}`, ephemeral: true });
        }
      });
      return;
    }

    // Kalender-Buttons: cal_signup:role:raidId  oder  cal_unregister:raidId
    if (interaction.isButton()) {
      const parts = interaction.customId.split(":");

      if (parts[0] === "cal_signup") {
        const role = parts[1];
        const raidId = parts[2];
        await interaction.deferReply({ ephemeral: true });
        try {
          const result = await api.raid.signupBot(raidId, {
            discordId: interaction.user.id,
            role,
          });
          if (result.status === "no_character") {
            await interaction.editReply({
              content:
                "❌ Dein Discord-Konto ist mit keinem Gildencharakter verknüpft. Melde dich einmal auf der Webseite an.",
            });
            return;
          }
          if (result.status === "select_character") {
            const select = new StringSelectMenuBuilder()
              .setCustomId(`cal_charselect:${role}:${raidId}`)
              .setPlaceholder("Charakter auswählen")
              .addOptions(
                result.characters!.map((c) => ({ label: c.name, value: c.id })),
              );
            const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);
            await interaction.editReply({
              content: "Welchen Charakter möchtest du anmelden?",
              components: [row],
            });
            return;
          }
          await interaction.editReply({
            content: `✅ **${result.character?.name}** als ${ROLE_LABELS[role] ?? role} angemeldet!`,
          });
          await updateCalendarMessage(interaction.client as Client<true>);
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Unbekannter Fehler";
          await interaction.editReply({ content: `❌ ${msg}` });
        }
        return;
      }

      if (parts[0] === "cal_unregister") {
        const raidId = parts[1];
        await interaction.deferReply({ ephemeral: true });
        try {
          await api.raid.unregisterBot(raidId, interaction.user.id);
          await interaction.editReply({ content: "✅ Du wurdest vom Raid abgemeldet." });
          await updateCalendarMessage(interaction.client as Client<true>);
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Unbekannter Fehler";
          await interaction.editReply({ content: `❌ ${msg}` });
        }
        return;
      }
    }

    // Charakter-Auswahl nach Klick auf Tank/Heiler/DPS mit mehreren Chars
    if (interaction.isStringSelectMenu() && interaction.customId.startsWith("cal_charselect:")) {
      const parts = interaction.customId.split(":");
      const role = parts[1];
      const raidId = parts[2];
      const characterId = interaction.values[0];
      await interaction.deferUpdate();
      try {
        await api.raid.signupBotByChar(raidId, { characterId, role });
        await interaction.editReply({
          content: `✅ Als ${ROLE_LABELS[role] ?? role} angemeldet!`,
          components: [],
        });
        await updateCalendarMessage(interaction.client as Client<true>);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unbekannter Fehler";
        await interaction.editReply({ content: `❌ ${msg}`, components: [] });
      }
    }
  },
};
