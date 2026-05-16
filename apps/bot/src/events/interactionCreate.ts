import { Events } from "discord.js";
import type { Interaction } from "discord.js";
import { commands } from "../commands/index.js";

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

    if (!interaction.isChatInputCommand()) return;

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
  },
};
