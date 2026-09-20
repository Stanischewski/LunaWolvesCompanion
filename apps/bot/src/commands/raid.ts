import { SlashCommandBuilder } from "discord.js";
import type { ChatInputCommandInteraction, AutocompleteInteraction, Client } from "discord.js";
import { api } from "../api.js";
import { raidListEmbed, raidRosterEmbed } from "../embeds.js";
import { updateCalendarMessage } from "../calendar.js";
import { isOfficer } from "../permissions.js";
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
            .setDescription("Eigener Charakter (nur nötig bei mehreren)")
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
        if (!isOfficer(interaction)) {
          await interaction.editReply({ content: "❌ Nur Officers können Raids erstellen." });
          return;
        }
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
        updateCalendarMessage(interaction.client as Client<true>).catch(console.error);
      } else if (sub === "signup") {
        // Anmeldung laeuft ueber die Discord-Verknuepfung. Frueher konnte hier
        // ein beliebiger Gildencharakter per Name angemeldet werden.
        const raidId = interaction.options.getString("raid_id", true);
        const charName = interaction.options.getString("character") ?? undefined;
        const role = interaction.options.getString("role", true);
        const roleLabel = { tank: "🛡️ Tank", heal: "💚 Heiler", dps: "⚔️ DPS" }[role] ?? role;

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
          const options = result.characters ?? [];
          const match = charName
            ? options.find((c) => c.name.toLowerCase() === charName.toLowerCase())
            : undefined;
          if (!match) {
            const names = options.map((c) => `\`${c.name}\``).join(", ");
            await interaction.editReply({
              content: charName
                ? `❌ **${charName}** ist keiner deiner Charaktere. Verfügbar: ${names}`
                : `Du hast mehrere Charaktere. Bitte mit der Option \`character\` wählen: ${names}`,
            });
            return;
          }
          await api.raid.signupBotByChar(raidId, {
            characterId: match.id,
            role,
            discordId: interaction.user.id,
          });
          await interaction.editReply({
            content: `✅ **${match.name}** als ${roleLabel} angemeldet.`,
          });
          return;
        }

        await interaction.editReply({
          content: `✅ **${result.character?.name}** als ${roleLabel} angemeldet.`,
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
      // Nur die eigenen verknuepften Charaktere vorschlagen — fremde anzubieten
      // wuerde eine Anmeldung suggerieren, die der Server ablehnt.
      const mine = await api.player.charactersOf(interaction.user.id).catch(() => []);
      const query = focused.value.toLowerCase();
      const choices = mine
        .filter((c) => c.name.toLowerCase().startsWith(query))
        .slice(0, 25)
        .map((c) => ({ name: c.name, value: c.name }));
      await interaction.respond(choices);
    }
  },
};
