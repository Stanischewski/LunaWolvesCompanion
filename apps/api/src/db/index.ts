import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";
import * as relations from "./relations.js";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL ist nicht gesetzt");

const client = postgres(url, {
  idle_timeout: 20,       // Verbindung nach 20s Idle schliessen (Firewall killt nach 30min)
  max_lifetime: 1800,     // Verbindung spätestens nach 30min recyceln (nach CT-Neustart)
  connect_timeout: 10,    // Verbindungsaufbau nach 10s abbrechen statt endlos hängen
  keep_alive: 10,         // TCP Keepalive nach 10s Idle: haelt OPNsense State-Table-Eintrag am Leben
});
export const db = drizzle(client, { schema: { ...schema, ...relations } });
export type Db = typeof db;
