import { Client, GatewayIntentBits } from "discord.js";
import { config } from "./config.js";
import { events } from "./events/index.js";

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

for (const event of events) {
  const fn = (...args: unknown[]) => event.execute(...args);
  if (event.once) {
    client.once(event.name, fn as never);
  } else {
    client.on(event.name, fn as never);
  }
}

client.login(config.token).catch((err: unknown) => {
  console.error("Login fehlgeschlagen:", err);
  process.exit(1);
});
