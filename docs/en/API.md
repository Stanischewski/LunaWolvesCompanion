# Luna Wolves Companion — API Documentation

Base URL: `http://localhost:3001/api/v1`

## Authentication

Most endpoints require a JWT passed as an `Authorization: Bearer <token>` header
or as a `token` cookie. The token is issued after a successful Battle.net OAuth login.

---

## Auth

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/auth/bnet` | — | Start Battle.net OAuth flow |
| `GET` | `/auth/bnet/callback` | — | OAuth2 callback (automatic) |
| `GET` | `/auth/desktop?port=<port>` | — | OAuth for desktop agent (local loopback) |
| `GET` | `/auth/me` | ✓ | Current logged-in user |
| `GET` | `/auth/discord/link?token=<jwt>` | — | Start Discord account linking |
| `GET` | `/auth/discord/callback` | — | Discord OAuth callback (automatic) |

---

## Players

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/v1/players/me` | ✓ | Own profile with characters and guilds |
| `PATCH` | `/api/v1/players/me` | ✓ | Set display name |

**PATCH `/players/me` — Body:**
```json
{ "displayName": "My Name" }
```

---

## Guilds

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/v1/guilds` | — | List all guilds |
| `POST` | `/api/v1/guilds` | ✓ | Create a guild |
| `GET` | `/api/v1/guilds/:id` | — | Get a single guild |
| `GET` | `/api/v1/guilds/:id/members` | — | Guild roster with player links |
| `GET` | `/api/v1/guilds/:id/stats` | — | Guild statistics |

**POST `/guilds` — Body:**
```json
{ "name": "The last Luna Wolves", "realm": "Eredar", "faction": "horde" }
```

**GET `/guilds/:id/stats` — Response:**
```json
{
  "totalMembers": 42,
  "avgItemLevel": 636,
  "activeMembers7d": 18,
  "activityByDay": [{ "day": "2026-05-19", "events": 7 }],
  "ilvlDistribution": [{ "bucket": 630, "count": 12 }]
}
```

---

## Characters

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/v1/characters/:id` | — | Character with equipment |
| `GET` | `/api/v1/characters` | ✓ | Own characters |
| `POST` | `/api/v1/characters` | ✓ | Create a character |
| `PATCH` | `/api/v1/characters/:id` | ✓ | Update a character |

**POST `/characters` — Body:**
```json
{
  "name": "Stanischewski",
  "realm": "Eredar",
  "class": "death_knight",
  "guildId": "<uuid>",
  "level": 80,
  "itemLevel": 636
}
```

Available classes:
`warrior`, `paladin`, `hunter`, `rogue`, `priest`, `shaman`, `mage`, `warlock`,
`monk`, `druid`, `demon_hunter`, `death_knight`, `evoker`

---

## Raids

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/v1/guilds/:guildId/raids` | — | All raids with signups |
| `POST` | `/api/v1/guilds/:guildId/raids` | ✓ | Create a raid |
| `GET` | `/api/v1/raids/:id` | — | Single raid |
| `PATCH` | `/api/v1/raids/:id` | ✓ | Edit a raid |
| `POST` | `/api/v1/raids/:id/signup` | ✓ | Sign up (upsert) |
| `PATCH` | `/api/v1/raids/:id/signup` | ✓ | Update signup status |

**POST `/guilds/:guildId/raids` — Body:**
```json
{
  "title": "Nerub'ar Palace HC",
  "scheduledAt": "2026-05-24T19:30:00.000Z",
  "description": "Please bring 635+ ilvl.",
  "raidType": "heroic",
  "minIlvl": 635
}
```

**POST `/raids/:id/signup` — Body:**
```json
{ "characterId": "<uuid>", "role": "dps", "status": "yes" }
```

Roles: `tank`, `heal`, `dps`
Status: `yes`, `maybe`, `no`

> A player can only sign up to a raid with one character.
> Signing up with a different character automatically removes the previous signup.

---

## DKP

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/v1/guilds/:guildId/dkp/standings` | — | All standings (sorted by points) |
| `GET` | `/api/v1/guilds/:guildId/dkp/standings/:playerName` | — | Single player standing |
| `GET` | `/api/v1/guilds/:guildId/dkp/history` | — | DKP history (filterable) |
| `GET` | `/api/v1/guilds/:guildId/dkp/seasons` | — | Past seasons |
| `POST` | `/api/v1/guilds/:guildId/dkp/award` | ✓ | Award DKP |
| `POST` | `/api/v1/guilds/:guildId/dkp/spend` | ✓ | Spend DKP |
| `POST` | `/api/v1/guilds/:guildId/dkp/adjust` | ✓ | Adjust DKP (correction) |
| `DELETE` | `/api/v1/guilds/:guildId/dkp/players/:playerName` | ✓ | Remove player from DKP |
| `POST` | `/api/v1/guilds/:guildId/dkp/reset` | ✓ | Reset season |

**GET `/guilds/:guildId/dkp/history` — Query parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `player` | string | Filter by player name |
| `type` | string | `manual`, `boss`, `spend`, `correction` |
| `limit` | number | Max entries (1–200, default 50) |
| `offset` | number | Pagination offset |

---

## Sync

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/api/v1/sync/addon-data` | ✓ | Upload addon data (Lua, max 2 MB) |
| `GET` | `/api/v1/guilds/:guildId/activity` | — | Activity log |
| `GET` | `/api/v1/guilds/:guildId/sync/pending-entries` | ✓ | Pending web DKP entries |
| `GET` | `/api/v1/guilds/:guildId/sync/latest` | — | Latest addon snapshot |

**POST `/sync/addon-data`:**
- Content-Type: `text/plain`
- Body: Contents of the WoW SavedVariables file (`LunaWolvesDB.lua`)

---

## WebSocket

Connection: `ws://localhost:3001` (Path: `/ws`)

Join a room:
```js
socket.emit("join_guild", "<guildId>");
```

| Event | Direction | Payload |
|-------|-----------|---------|
| `raid_signup` | Server → Client | `{ raidId, characterId, role, status }` |
| `dkp_update` | Server → Client | `{ guildId, playerName, delta, type }` |
| `dkp_reset` | Server → Client | `{ guildId, seasonName, resetBy }` |
| `member_seen` | Server → Client | `{ guildId, updated, scannedAt }` |

---

## External APIs

| Service | Purpose | Link |
|---------|---------|------|
| Battle.net OAuth2 | Login, character data | https://community.developer.battle.net |
| Battle.net Game Data API | Item icons (Client Credentials) | https://develop.battle.net/access/clients |
| Battle.net Profile API | Equipment (`wow.profile` scope) | https://develop.battle.net/access/clients |
| Discord Developer Portal | OAuth2, bot token | https://discord.com/developers/applications |
| Raider.IO | M+ scores (no token required) | https://raider.io/api |
