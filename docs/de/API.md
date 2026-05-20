# Luna Wolves Companion — API Dokumentation

Basis-URL: `http://localhost:3001/api/v1`

## Authentifizierung

Die meisten Endpunkte erfordern ein JWT, das als `Authorization: Bearer <token>` Header
oder als `token`-Cookie übermittelt wird.
Der Token wird nach dem Battle.net OAuth-Login ausgestellt.

---

## Auth

| Methode | Pfad | Auth | Beschreibung |
|---------|------|------|--------------|
| `GET` | `/auth/bnet` | — | Battle.net OAuth starten |
| `GET` | `/auth/bnet/callback` | — | OAuth2 Callback (automatisch) |
| `GET` | `/auth/desktop?port=<port>` | — | OAuth für Desktop-Agent (lokaler Loopback) |
| `GET` | `/auth/me` | ✓ | Eingeloggter Nutzer |
| `GET` | `/auth/discord/link?token=<jwt>` | — | Discord-Verknüpfung starten |
| `GET` | `/auth/discord/callback` | — | Discord OAuth Callback (automatisch) |

---

## Players

| Methode | Pfad | Auth | Beschreibung |
|---------|------|------|--------------|
| `GET` | `/api/v1/players/me` | ✓ | Eigenes Profil mit Characters und Gilden |
| `PATCH` | `/api/v1/players/me` | ✓ | Anzeigenamen setzen |

**PATCH `/players/me` — Body:**
```json
{ "displayName": "Mein Name" }
```

---

## Guilds

| Methode | Pfad | Auth | Beschreibung |
|---------|------|------|--------------|
| `GET` | `/api/v1/guilds` | — | Alle Gilden |
| `POST` | `/api/v1/guilds` | ✓ | Gilde erstellen |
| `GET` | `/api/v1/guilds/:id` | — | Einzelne Gilde |
| `GET` | `/api/v1/guilds/:id/members` | — | Gilden-Roster mit Spieler-Verlinkung |
| `GET` | `/api/v1/guilds/:id/stats` | — | Gilden-Statistiken |

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

| Methode | Pfad | Auth | Beschreibung |
|---------|------|------|--------------|
| `GET` | `/api/v1/characters/:id` | — | Character mit Ausrüstung |
| `GET` | `/api/v1/characters` | ✓ | Eigene Characters |
| `POST` | `/api/v1/characters` | ✓ | Character anlegen |
| `PATCH` | `/api/v1/characters/:id` | ✓ | Character aktualisieren |

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

Verfügbare Klassen:
`warrior`, `paladin`, `hunter`, `rogue`, `priest`, `shaman`, `mage`, `warlock`,
`monk`, `druid`, `demon_hunter`, `death_knight`, `evoker`

---

## Raids

| Methode | Pfad | Auth | Beschreibung |
|---------|------|------|--------------|
| `GET` | `/api/v1/guilds/:guildId/raids` | — | Alle Raids mit Anmeldungen |
| `POST` | `/api/v1/guilds/:guildId/raids` | ✓ | Raid erstellen |
| `GET` | `/api/v1/raids/:id` | — | Einzelner Raid |
| `PATCH` | `/api/v1/raids/:id` | ✓ | Raid bearbeiten |
| `POST` | `/api/v1/raids/:id/signup` | ✓ | Anmelden (upsert) |
| `PATCH` | `/api/v1/raids/:id/signup` | ✓ | Anmeldestatus ändern |

**POST `/guilds/:guildId/raids` — Body:**
```json
{
  "title": "Nerub'ar Palace HC",
  "scheduledAt": "2026-05-24T19:30:00.000Z",
  "description": "Bitte 635+ ilvl mitbringen.",
  "raidType": "heroic",
  "minIlvl": 635
}
```

**POST `/raids/:id/signup` — Body:**
```json
{ "characterId": "<uuid>", "role": "dps", "status": "yes" }
```

Rollen: `tank`, `heal`, `dps`
Status: `yes`, `maybe`, `no`

> Ein Spieler kann sich pro Raid nur mit einem Character anmelden.
> Meldet man sich mit einem anderen Character an, wird der vorherige automatisch entfernt.

---

## DKP

| Methode | Pfad | Auth | Beschreibung |
|---------|------|------|--------------|
| `GET` | `/api/v1/guilds/:guildId/dkp/standings` | — | Alle Standings (sortiert nach Punkten) |
| `GET` | `/api/v1/guilds/:guildId/dkp/standings/:playerName` | — | Einzelner Spieler |
| `GET` | `/api/v1/guilds/:guildId/dkp/history` | — | DKP-Historie (filterbar) |
| `GET` | `/api/v1/guilds/:guildId/dkp/seasons` | — | Vergangene Saisonen |
| `POST` | `/api/v1/guilds/:guildId/dkp/award` | ✓ | DKP vergeben |
| `POST` | `/api/v1/guilds/:guildId/dkp/spend` | ✓ | DKP ausgeben |
| `POST` | `/api/v1/guilds/:guildId/dkp/adjust` | ✓ | DKP korrigieren |
| `DELETE` | `/api/v1/guilds/:guildId/dkp/players/:playerName` | ✓ | Spieler aus DKP entfernen |
| `POST` | `/api/v1/guilds/:guildId/dkp/reset` | ✓ | Saison zurücksetzen |

**GET `/guilds/:guildId/dkp/history` — Query-Parameter:**
| Parameter | Typ | Beschreibung |
|-----------|-----|--------------|
| `player` | string | Nach Spielername filtern |
| `type` | string | `manual`, `boss`, `spend`, `correction` |
| `limit` | number | Max. Einträge (1–200, Standard 50) |
| `offset` | number | Pagination-Offset |

---

## Sync

| Methode | Pfad | Auth | Beschreibung |
|---------|------|------|--------------|
| `POST` | `/api/v1/sync/addon-data` | ✓ | Addon-Daten hochladen (Lua, max 2 MB) |
| `GET` | `/api/v1/guilds/:guildId/activity` | — | Aktivitätslog |
| `GET` | `/api/v1/guilds/:guildId/sync/pending-entries` | ✓ | Ausstehende Web-DKP-Einträge |
| `GET` | `/api/v1/guilds/:guildId/sync/latest` | — | Letzter Addon-Snapshot |

**POST `/sync/addon-data`:**
- Content-Type: `text/plain`
- Body: Inhalt der WoW SavedVariables-Datei (`LunaWolvesDB.lua`)

---

## WebSocket

Verbindung: `ws://localhost:3001` (Pfad: `/ws`)

Raum beitreten:
```js
socket.emit("join_guild", "<guildId>");
```

| Event | Richtung | Payload |
|-------|----------|---------|
| `raid_signup` | Server → Client | `{ raidId, characterId, role, status }` |
| `dkp_update` | Server → Client | `{ guildId, playerName, delta, type }` |
| `dkp_reset` | Server → Client | `{ guildId, seasonName, resetBy }` |
| `member_seen` | Server → Client | `{ guildId, updated, scannedAt }` |

---

## Externe APIs

| Dienst | Zweck | Link |
|--------|-------|------|
| Battle.net OAuth2 | Login, Character-Daten | https://community.developer.battle.net |
| Battle.net Game Data API | Item-Icons (Client Credentials) | https://develop.battle.net/access/clients |
| Battle.net Profile API | Ausrüstung (`wow.profile` Scope) | https://develop.battle.net/access/clients |
| Discord Developer Portal | OAuth2, Bot-Token | https://discord.com/developers/applications |
| Raider.IO | M+ Scores (kein Token nötig) | https://raider.io/api |
