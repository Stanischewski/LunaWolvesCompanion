import { Events, REST, Routes } from "discord.js";
import type { Client } from "discord.js";
import { config } from "../config.js";
import { commands } from "../commands/index.js";
import { startScheduler } from "../scheduler.js";
import { loadClassEmojis } from "../emojis.js";

export const readyEvent = {
  name: Events.ClientReady as string,
  once: true,
  execute: async (client: Client<true>) => {
    const rest = new REST().setToken(config.token);
    const body = [...commands.values()].map((cmd) => cmd.data.toJSON());
    await rest.put(Routes.applicationGuildCommands(client.application.id, config.guildId), {
      body,
    });
    console.log(`✓ ${commands.size} Slash Commands registriert (Guild: ${config.guildId})`);
    console.log(`✓ Eingeloggt als ${client.user.tag}`);
    await loadClassEmojis(client);
    startScheduler(client);
  },
};
