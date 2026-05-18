import { Collection } from "discord.js";
import type { ChatInputCommandInteraction, AutocompleteInteraction } from "discord.js";
import { guildCommand } from "./guild.js";
import { playerCommand } from "./player.js";
import { raidCommand } from "./raid.js";
import { dkpCommand } from "./dkp.js";

export interface Command {
  data: { name: string; toJSON(): object };
  execute: (interaction: ChatInputCommandInteraction) => Promise<void>;
  autocomplete?: (interaction: AutocompleteInteraction) => Promise<void>;
}

export const commands = new Collection<string, Command>([
  [guildCommand.data.name, guildCommand],
  [playerCommand.data.name, playerCommand],
  [raidCommand.data.name, raidCommand],
  [dkpCommand.data.name, dkpCommand],
]);
