import "dotenv/config";

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`Fehlende Umgebungsvariable: ${key}`);
  return value;
}

export const config = {
  token: requireEnv("DISCORD_BOT_TOKEN"),
  guildId: requireEnv("DISCORD_GUILD_ID"),
  botSecret: requireEnv("BOT_SECRET"),
  apiUrl: process.env.API_URL ?? "http://localhost:3001",
  lunaGuildId: requireEnv("LUNA_GUILD_ID"),
  // Optionale Channel-IDs für automatische Benachrichtigungen
  raidChannelId: process.env.RAID_CHANNEL_ID,
  officerChannelId: process.env.OFFICER_CHANNEL_ID,
};
