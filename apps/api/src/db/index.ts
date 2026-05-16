import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";
import * as relations from "./relations.js";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL ist nicht gesetzt");

const client = postgres(url);
export const db = drizzle(client, { schema: { ...schema, ...relations } });
export type Db = typeof db;
