/**
 * Wiederverwendbare JSON-Schemas fuer Routen-Parameter.
 *
 * Fastify validiert damit vor dem Handler und antwortet selbst mit 400.
 * Zuvor landete eine ungueltige UUID ungeprueft in der Abfrage, Postgres
 * meldete `invalid input syntax for type uuid` (22P02) und der Aufrufer bekam
 * einen 500er — ein Eingabefehler, der wie ein Serverfehler aussah.
 */

const uuid = { type: "string", format: "uuid" } as const;

/** `/guilds/:guildId/...` */
export const guildIdParams = {
  type: "object",
  required: ["guildId"],
  properties: { guildId: uuid },
} as const;

/** `/guilds/:id/...` */
export const idParams = {
  type: "object",
  required: ["id"],
  properties: { id: uuid },
} as const;

/** `/guilds/:guildId/dkp/.../:playerName` */
export const guildIdAndPlayerParams = {
  type: "object",
  required: ["guildId", "playerName"],
  properties: {
    guildId: uuid,
    playerName: { type: "string", minLength: 1, maxLength: 64 },
  },
} as const;

/** `/raids/:raidId/...` */
export const raidIdParams = {
  type: "object",
  required: ["raidId"],
  properties: { raidId: uuid },
} as const;

/** `/bot/players/:discordId/...` */
export const discordIdParams = {
  type: "object",
  required: ["discordId"],
  properties: { discordId: { type: "string", pattern: "^[0-9]{5,32}$" } },
} as const;
