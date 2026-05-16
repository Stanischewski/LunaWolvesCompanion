import { SlashCommandBuilder } from "discord.js";
import type { ChatInputCommandInteraction, AutocompleteInteraction } from "discord.js";
import { api } from "../api.js";
import { raidListEmbed, raidRosterEmbed } from "../embeds.js";
import type { Command } from "./index.js";

export const raidCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("raid")
    .setDescription("Raid-Verwaltung")
    .addSubcommand((sub) =>
      sub.setName("list").setDescription("Anstehende Raids anzeigen"),
    )
    .addSubcommand((sub) =>
      sub
        .setName("create")
        .setDescription("Neuen Raid erstellen")
        .addStringOption((opt) =>
          opt.setName("title").setDescription("Raid-Titel").setRequired(true),
        )
        .addStringOption((opt) =>
          opt.setName("date").setDescription("Datum (JJJJ-MM-TT)").setRequired(true),
        )
        .addStringOption((opt) =>
          opt.setName("time").setDescription("Uhrzeit (HH:MM)").setRequired(true),
        )
        .addStringOption((opt) =>
          opt.setName("type").setDescription("Raid-Typ (z.B. Mythic, Heroic)"),
        )
        .addIntegerOption((opt) =>
          opt.setName("min_ilvl").setDescription("Mindest Item-Level"),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("signup")
        .setDescription("Für einen Raid anmelden")
        .addStringOption((opt) =>
          opt
            .setName("raid_id")
            .setDescription("Raid auswählen")
            .setRequired(true)
            .setAutocomplete(true),
        )
        .addStringOption((opt) =>
          opt
            .setName("character")
            .setDescription("Charaktername")
            .setRequired(true)
            .setAutocomplete(true),
        )
        .addStringOption((opt) =>
          opt
            .setName("role")
            .setDescription("Rolle")
            .setRequired(true)
            .addChoices(
              { name: "🛡️ Tank", value: "tank" },
              { name: "💚 Heiler", value: "heal" },
              { name: "⚔️ DPS", value: "dps" },
            ),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("roster")
        .setDescription("Angemeldete Spieler anzeigen")
        .addStringOption((opt) =>
          opt
            .setName("raid_id")
            .setDescription("Raid auswählen")
            .setRequired(true)
            .setAutocomplete(true),
        ),
    ),

  execute: async (interaction: ChatInputCommandInteraction) => {
    await interaction.deferReply();
    try {
      const sub = interaction.options.getSubcommand();

      if (sub === "list") {
        const raids = await api.guild.raids();
        await interaction.editReply({ embeds: [raidListEmbed(raids)] });
      } else if (sub === "create") {
        const title = interaction.options.getString("title", true);
        const date = interaction.options.getString("date", true);
        const time = interaction.options.getString("time", true);
        const raidType = interaction.options.getString("type") ?? undefined;
        const minIlvl = interaction.options.getInteger("min_ilvl") ?? undefined;
        const scheduledAt = new Date(`${date}T${time}:00`).toISOString();
        if (isNaN(new Date(scheduledAt).getTime())) {
          await interaction.editReply({
            content: "❌ Ungültiges Datum oder Uhrzeit. Format: `JJJJ-MM-TT` und `HH:MM`.",
          });
          return;
        }
        const raid = await api.raid.create({ title, scheduledAt, raidType, minIlvl });
        await interaction.editReply({
          content: `✅ Raid **${raid.title}** erstellt!\nID: \`${raid.id}\``,
        });
      } else if (sub === "signup") {
        const raidId = interaction.options.getString("raid_id", true);
        const charName = interaction.options.getString("character", true);
        const role = interaction.options.getString("role", true);
        const members = await api.guild.members();
        const member = members.find((m) => m.name.toLowerCase() === charName.toLowerCase());
        if (!member) {
          await interaction.editReply({
            content: `❌ Charakter **${charName}** nicht in der Gilde gefunden.`,
          });
          return;
        }
        await api.raid.signup(raidId, { characterId: member.id, role });
        const roleLabel = { tank: "🛡️ Tank", heal: "💚 Heiler", dps: "⚔️ DPS" }[role] ?? role;
        await interaction.editReply({
          content: `✅ **${member.name}** als ${roleLabel} angemeldet.`,
        });
      } else if (sub === "roster") {
        const raidId = interaction.options.getString("raid_id", true);
        const raid = await api.raid.get(raidId);
        await interaction.editReply({ embeds: [raidRosterEmbed(raid)] });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unbekannter Fehler";
      await interaction.editReply({ content: `❌ ${msg}` });
    }
  },

  autocomplete: async (interaction: AutocompleteInteraction) => {
    const focused = interaction.options.getFocused(true);

    if (focused.name === "raid_id") {
      const raids = await api.guild.raids().catch(() => []);
      const upcoming = raids.filter((r) => new Date(r.scheduledAt) > new Date());
      const query = focused.value.toLowerCase();
      const choices = upcoming
        .filter((r) => r.title.toLowerCase().includes(query))
        .slice(0, 25)
        .map((r) => ({
          name: `${r.title} — ${new Date(r.scheduledAt).toLocaleDateString("de-DE")}`,
          value: r.id,
        }));
      await interaction.respond(choices);
    } else if (focused.name === "character") {
      const members = await api.guild.members().catch(() => []);
      const query = focused.value.toLowerCase();
      const choices = members
        .filter((m) => m.name.toLowerCase().startsWith(query))
        .slice(0, 25)
        .map((m) => ({ name: m.name, value: m.name }));
      await interaction.respond(choices);
    }
  },
};
