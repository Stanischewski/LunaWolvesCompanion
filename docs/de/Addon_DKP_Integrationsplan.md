# Addon-Integration & DKP-System — Integrationsplan

## 1. Ausgangslage

Das LunaWolves-Addon hat bereits ein ausgereiftes DKP-System (`Modules/DKP.lua`) mit Points, History, Tombstones, Auto-Award bei Bosskills, Season-Resets und einem Sync-Protokoll zwischen Officers via `SendAddonMessage`. Allerdings leben diese Daten ausschließlich in den SavedVariables der einzelnen Spieler-Clients — es gibt keinen zentralen, persistenten Speicher.

Die Companion App löst drei Probleme:

1. **Datenpersistenz** — DKP-Daten überleben Addon-Reinstalls, PC-Wechsel und sind auch ohne das Spiel verfügbar.
2. **Zentrale Wahrheit** — Statt N Kopien auf N Rechnern gibt es eine autoritative Datenbank.
3. **Zugänglichkeit** — DKP-Stände einsehbar via Web, Discord und Mobile, nicht nur in-game.


---

## 2. Neues Addon-Modul: Modules/Roster.lua

Das bestehende Addon hat kein Modul, das den Gildenroster automatisch in `LunaWolvesDB` schreibt. Der Sync-Endpoint erwartet aber genau dieses Format. Daher wird ein neues Modul `Roster.lua` benötigt.

### Aufgabe

Bei `GUILD_ROSTER_UPDATE` den kompletten Gildenroster scannen und in `LunaWolvesDB` im Format ablegen, das der Backend-Server (`POST /sync/addon-data`) erwartet.

### SavedVariables-Zielstruktur

```lua
LunaWolvesDB = {
    -- ... bestehende Felder (DKP, Versions, debug, etc.) ...

    ["version"]   = 1,
    ["scannedAt"] = 1747500000,       -- Unix-Timestamp des letzten Scans

    ["guild"] = {
        ["name"]    = "Luna Wolves",
        ["realm"]   = "Antonidas",
        ["faction"] = "Horde",
    },

    ["members"] = {
        ["Arthas-Antonidas"] = {
            ["name"]      = "Arthas",
            ["realm"]     = "Antonidas",
            ["class"]     = "DEATHKNIGHT",   -- WoW Klassentoken (uppercase)
            ["level"]     = 80,
            ["itemLevel"] = 630,
            ["guildRank"] = 2,
            ["online"]    = true,
            ["lastSeen"]  = 1747500000,
        },
        -- ...
    },

    ["DKP"] = {
        ["points"]  = { ... },        -- bestehendes DKP-Modul
        ["history"] = { ... },        -- bestehendes DKP-Modul
        ["deleted"] = { ... },        -- Tombstones
        ["archive"] = { ... },        -- Season-Archiv
    },
}
```

### Kern-Logik

```
Event: GUILD_ROSTER_UPDATE
  → GuildRoster() aufrufen (löst serverseitigen Scan aus)
  → GetNumGuildMembers() iterieren
  → Pro Member: Name, Klasse, Level, Rang, Online-Status
  → Item-Level: nur für den eigenen Char direkt verfügbar,
    für andere über GetGuildRosterInfo() begrenzt (ohne ilvl)
  → In LunaWolvesDB.members schreiben
  → LunaWolvesDB.scannedAt = time()
```

### Einschränkungen

- `GetGuildRosterInfo()` liefert kein Item-Level für andere Spieler. Das Item-Level wird über die Battle.net API (Character Profile Sync) ergänzt, nicht über das Addon.
- `lastSeen` wird beim Scan auf `time()` gesetzt wenn der Spieler online ist. Für Offline-Spieler wird der zuletzt bekannte Wert beibehalten.
- Der Scan wird auf maximal alle 60 Sekunden gedrosselt (Throttle), um unnötige Schreibvorgänge zu vermeiden.


---

## 3. Erweiterter Sync-Endpoint

Der bestehende `POST /sync/addon-data` verarbeitet bereits den Roster. Er muss erweitert werden, um die DKP-Daten aus `LunaWolvesDB.DKP` mitzunehmen.

### Aktueller Flow

```
Tauri → POST /sync/addon-data (rohes Lua)
  → parseLua() → LunaWolvesDB extrahieren
  → Roster parsen (guild, members)
  → Characters in DB upserten
  → Addon-Snapshot speichern
```

### Erweiterter Flow

```
Tauri → POST /sync/addon-data (rohes Lua)
  → parseLua() → LunaWolvesDB extrahieren
  → Roster parsen (guild, members)          ← bestehend
  → Characters in DB upserten               ← bestehend
  → DKP parsen (points, history, deleted)    ← NEU
  → DKP-Einträge in DB mergen               ← NEU
  → Addon-Snapshot speichern                 ← bestehend
```

### DKP-Merge-Logik

Der Merge ist nicht trivial, weil mehrere Spieler unabhängig voneinander Daten hochladen können und das Addon sein eigenes Sync-Protokoll hat. Die Datenbank ist die **zentrale Wahrheit** — die Addon-Daten werden als Input behandelt, nicht als Überschreibung.

```
Für jeden DKP-History-Eintrag im Upload:
  1. Prüfe ob entry.id bereits in der DB existiert → skip (Duplikat)
  2. Prüfe ob ein Tombstone für entry.player existiert mit ts >= entry.timestamp → skip
  3. Prüfe ob der Officer berechtigt war (guild_rank <= officer_threshold) → skip wenn nicht
  4. Eintrag in dkp_entries einfügen
  5. dkp_standings.current und .lifetime für den Spieler neu berechnen

Für jeden Tombstone im Upload:
  1. Prüfe ob bereits vorhanden → skip
  2. Tombstone in dkp_tombstones einfügen
  3. Betroffene dkp_entries als gelöscht markieren
  4. dkp_standings für den Spieler auf 0 setzen
```


---

## 4. Neue Datenbank-Tabellen

### Schema-Erweiterung (Drizzle)

```typescript
// === DKP-System ===

export const dkpEntryTypeEnum = pgEnum("dkp_entry_type", [
  "manual",    // Manuell von Officer vergeben
  "boss",      // Auto-Award bei Bosskill
  "spend",     // Ausgabe (Loot gekauft)
  "correction" // Korrektur
]);

export const dkpEntries = pgTable("dkp_entries", {
  id: uuid("id").primaryKey().defaultRandom(),
  guildId: uuid("guild_id")
    .notNull()
    .references(() => guilds.id, { onDelete: "cascade" }),
  addonEntryId: varchar("addon_entry_id", { length: 128 }).notNull(),
  playerName: varchar("player_name", { length: 64 }).notNull(),
  delta: integer("delta").notNull(),
  reason: varchar("reason", { length: 256 }).notNull().default(""),
  entryType: dkpEntryTypeEnum("entry_type").notNull(),
  officerName: varchar("officer_name", { length: 64 }).notNull(),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
  source: varchar("source", { length: 16 }).notNull().default("addon"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const dkpStandings = pgTable("dkp_standings", {
  id: uuid("id").primaryKey().defaultRandom(),
  guildId: uuid("guild_id")
    .notNull()
    .references(() => guilds.id, { onDelete: "cascade" }),
  playerName: varchar("player_name", { length: 64 }).notNull(),
  current: integer("current").notNull().default(0),
  lifetime: integer("lifetime").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const dkpTombstones = pgTable("dkp_tombstones", {
  id: uuid("id").primaryKey().defaultRandom(),
  guildId: uuid("guild_id")
    .notNull()
    .references(() => guilds.id, { onDelete: "cascade" }),
  playerName: varchar("player_name", { length: 64 }).notNull(),
  deletedBy: varchar("deleted_by", { length: 64 }).notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

export const dkpSeasons = pgTable("dkp_seasons", {
  id: uuid("id").primaryKey().defaultRandom(),
  guildId: uuid("guild_id")
    .notNull()
    .references(() => guilds.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 128 }).notNull(),
  archivedBy: varchar("archived_by", { length: 64 }).notNull(),
  archivedAt: timestamp("archived_at", { withTimezone: true }).notNull(),
  snapshotData: jsonb("snapshot_data").notNull(),
});
```

### Beziehungen

```
guilds ──1:N──▶ dkp_entries
guilds ──1:N──▶ dkp_standings
guilds ──1:N──▶ dkp_tombstones
guilds ──1:N──▶ dkp_seasons

dkp_standings.playerName ◀──── dkp_entries.playerName (logisch, keine FK)
```

DKP-Daten referenzieren Spieler per `playerName` (String), nicht per `characters.id` (UUID). Das ist bewusst: im Addon sind DKP-Punkte an den Spieler (WoW-Charaktername) gebunden, nicht an die Battle.net-ID. Ein Spieler kann mehrere Chars haben, aber DKP läuft auf dem Main. Die Zuordnung Name → Player geschieht in der Web-UI über den Roster.


---

## 5. API-Endpoints

### DKP lesen (alle Rollen)

```
GET /guilds/:guildId/dkp/standings
  → Alle Spieler mit current, lifetime, sortiert nach current desc
  → Response: [{ playerName, current, lifetime, updatedAt, class?, rank? }]

GET /guilds/:guildId/dkp/standings/:playerName
  → DKP eines einzelnen Spielers

GET /guilds/:guildId/dkp/history
  → Query-Params: ?player=Name, ?type=boss, ?limit=50, ?offset=0
  → Response: [{ id, playerName, delta, reason, entryType, officerName, occurredAt }]

GET /guilds/:guildId/dkp/seasons
  → Archivierte Seasons mit Namen und Zeitpunkt
```

### DKP schreiben (nur Officer / Gildenleiter)

```
POST /guilds/:guildId/dkp/award
  → Body: { playerName, amount, reason, entryType }
  → Erstellt einen neuen DKP-Eintrag mit source="web"
  → Berechnet standings neu
  → Feuert WebSocket-Event "dkp_update"

POST /guilds/:guildId/dkp/spend
  → Body: { playerName, amount, reason }
  → Negativer Eintrag (Loot-Kauf)

POST /guilds/:guildId/dkp/adjust
  → Body: { playerName, amount, reason }
  → Korrektur-Eintrag (kann positiv oder negativ sein)

DELETE /guilds/:guildId/dkp/players/:playerName
  → Tombstone erstellen, Standings auf 0, Entries markieren
  → 90-Tage-TTL auf dem Tombstone

POST /guilds/:guildId/dkp/reset
  → Season-Reset: aktuellen Stand archivieren, alles auf 0
  → Body: { seasonName? }
```

### Sync (automatisch via Tauri)

```
POST /sync/addon-data
  → Bestehender Endpoint, erweitert um DKP-Daten-Merge
  → Verarbeitet LunaWolvesDB.DKP.points, .history, .deleted
```


---

## 6. Datenfluss: Addon ↔ Server ↔ Clients

### 6.1 Addon → Server (Upload)

```
WoW Addon                    Tauri Desktop                  lw-api (CT 202)
    │                              │                              │
    │ GUILD_ROSTER_UPDATE          │                              │
    │ ENCOUNTER_END (Bosskill)     │                              │
    │ Officer: /lw dkp add         │                              │
    │                              │                              │
    │── SavedVariables ──────────▶│                              │
    │   LunaWolvesDB enthält:      │                              │
    │   - guild, members (Roster)  │                              │
    │   - DKP.points, .history     │                              │
    │   - DKP.deleted (Tombstones) │                              │
    │                              │                              │
    │                              │── POST /sync/addon-data ───▶│
    │                              │   Body: rohes Lua            │
    │                              │                              │── Parse Roster → upsert characters
    │                              │                              │── Parse DKP → merge dkp_entries
    │                              │                              │── Recalc dkp_standings
    │                              │                              │── Store addon_snapshot
    │                              │                              │── Emit WS: "dkp_update"
    │                              │◀── 201 { processed } ───────│
```

### 6.2 Server → Clients (Lesen + Live)

```
Web Dashboard                  lw-api (CT 202)
    │                              │
    │── GET /dkp/standings ──────▶│── SELECT dkp_standings
    │◀── [{ name, current, ... }]──│
    │                              │
    │── WebSocket connect ────────▶│
    │◀── Event: "dkp_update" ──────│  (wenn neuer Sync oder Web-Award)
    │   { playerName, delta, ... } │
    │── UI auto-refresh ───────────│

Discord Bot (CT 203)           lw-api (CT 202)
    │                              │
    │── GET /dkp/standings ──────▶│
    │◀── Daten ────────────────────│
    │── Embed bauen + antworten    │
```

### 6.3 Web → Server → Addon (Rückkanal)

DKP-Änderungen aus der Web-UI (Officer vergibt Punkte via Dashboard) müssen zurück ins Addon. Da es keinen Push-Kanal ins Spiel gibt, wird ein Pull-Mechanismus verwendet:

```
Officer vergibt DKP im Web
    │
    ▼
lw-api: POST /dkp/award
    │── dkp_entries einfügen (source="web")
    │── dkp_standings aktualisieren
    │── WebSocket: "dkp_update" an alle Clients
    │
    ▼
Nächster Addon-Upload (Tauri)
    │── POST /sync/addon-data
    │── Response enthält: pendingWebEntries[]
    │
    ▼
Tauri Desktop zeigt Notification:
    "3 neue DKP-Einträge aus der Web-App"
    (Spieler muss sie im Addon manuell bestätigen
     oder das Addon holt sie beim nächsten Login-Sync)
```

Langfristig kann der Tauri-Client einen `GET /sync/pending-entries` Endpoint pollen und die Einträge direkt in die SavedVariables schreiben, damit das Addon sie beim nächsten Laden findet. Das ist Phase 2 der Integration.


---

## 7. Web-UI: DKP-Dashboard

### 7.1 Seiten-Struktur

```
/dashboard/dkp                → DKP-Übersicht (Standings-Tabelle)
/dashboard/dkp/history        → Globale History (alle Einträge)
/dashboard/dkp/player/:name   → Einzelspieler-Ansicht
/dashboard/dkp/seasons        → Archivierte Seasons
/dashboard/dkp/manage         → Officer-Panel (nur mit Berechtigung)
```

### 7.2 Standings-Tabelle (Hauptansicht)

```
┌──────────────────────────────────────────────────────────┐
│  DKP-Übersicht                        [Season: Aktuell]  │
│                                                          │
│  Suche: [____________]    Filter: [Alle Klassen ▼]       │
│                                                          │
│  ┌──────────┬────────┬──────────┬──────────┬──────────┐  │
│  │ Spieler  │ Klasse │ Aktuell  │ Lifetime │ Letzter  │  │
│  │          │        │          │          │ Eintrag  │  │
│  ├──────────┼────────┼──────────┼──────────┼──────────┤  │
│  │ Arthas   │ DK     │   420    │   1250   │ vor 2h   │  │
│  │ Thrall   │ Shaman │   380    │   1100   │ vor 1d   │  │
│  │ Jaina    │ Mage   │   350    │    980   │ vor 3h   │  │
│  │ ...      │        │          │          │          │  │
│  └──────────┴────────┴──────────┴──────────┴──────────┘  │
│                                                          │
│  Klick auf Spieler → /dkp/player/:name                   │
└──────────────────────────────────────────────────────────┘
```

### 7.3 Einzelspieler-Ansicht

```
┌──────────────────────────────────────────────────────────┐
│  ← Zurück                                                │
│                                                          │
│  Arthas                          Aktuell: 420 DKP        │
│  Death Knight · Rang 2           Lifetime: 1250 DKP      │
│                                                          │
│  ┌── History ──────────────────────────────────────────┐ │
│  │ 15.05.2026 14:22  +10  Bosskill: Raszageth  [Auto]  │ │
│  │ 15.05.2026 14:15  +10  Bosskill: Kurog      [Auto]  │ │
│  │ 14.05.2026 20:30  -50  Tier-Helm gekauft    [Manu]  │ │
│  │ 14.05.2026 20:10  +10  Bosskill: Eranog     [Auto]  │ │
│  │ ...                                                 │ │
│  └─────────────────────────────────────────────────────┘ │
│                                                          │
│  [DKP-Trend-Graph über die letzten 30 Tage]              │
└──────────────────────────────────────────────────────────┘
```

### 7.4 Officer-Panel

```
┌──────────────────────────────────────────────────────────┐
│  DKP verwalten (nur Officers)                            │
│                                                          │
│  ┌── DKP vergeben ───────────────────────────────────┐   │
│  │ Spieler: [Autocomplete ▼]                         │   │
│  │ Betrag:  [____]   Grund: [________________]       │   │
│  │ Typ:     (●) Manuell  ( ) Bosskill  ( ) Ausgabe   │   │
│  │                                    [Vergeben]     │   │
│  └───────────────────────────────────────────────────┘   │
│                                                          │
│  ┌── Batch-Award ────────────────────────────────────┐   │
│  │ Alle Raid-Teilnehmer vom letzten Raid:            │   │
│  │ ☑ Arthas  ☑ Thrall  ☑ Jaina  ☐ Garrosh          │   │
│  │ Betrag: [10]  Grund: [Anwesenheit]                │   │
│  │                                [Alle vergeben]    │   │
│  └───────────────────────────────────────────────────┘   │
│                                                          │
│  ┌── Aktionen ───────────────────────────────────────┐   │
│  │ [Season Reset]  [DKP exportieren (CSV)]           │   │
│  └───────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────┘
```


---

## 8. Discord Bot: DKP-Commands

### Slash Commands

```
/dkp standings                → Top-20 DKP-Standings als Embed
/dkp standings full           → Alle Spieler (paginated)
/dkp player <name>            → DKP + letzte History eines Spielers
/dkp history                  → Letzte 10 globale DKP-Einträge
/dkp award <name> <amount> <reason>  → DKP vergeben (Officer only)
/dkp spend <name> <amount> <reason>  → DKP abziehen (Officer only)
```

### Automatische Notifications

```
Event: dkp_update (via WebSocket von lw-api)
  → #dkp-log Channel:
    "⚔️ Bosskill: Raszageth — 18 Spieler erhalten je 10 DKP"

Event: dkp_reset
  → #officer Channel:
    "🔄 Season-Reset durchgeführt von Arthas. Archiv: Saison-2026-05-15"

Event: dkp_milestone
  → #gilden-chat Channel:
    "🏆 Thrall hat 1000 Lifetime-DKP erreicht!"
```

### Embed-Beispiel: Standings

```
┌──────────────────────────────────────┐
│  📊 DKP-Standings — Luna Wolves     │
│                                      │
│   #  Spieler      Aktuell  Lifetime  │
│   1  Arthas (DK)    420     1250     │
│   2  Thrall (SHA)   380     1100     │
│   3  Jaina (MAG)    350      980     │
│   ...                                │
│                                      │
│  Letzte Aktualisierung: vor 5 Min.   │
│  Quelle: Addon-Sync + Web            │
└──────────────────────────────────────┘
```


---

## 9. Konsistenzmodell: Addon vs. Server

Das zentrale Spannungsfeld: das Addon hat sein eigenes Sync-Protokoll (Peer-to-Peer zwischen Officers via `SendAddonMessage`), und der Server hat seine eigene Datenbank. Beide müssen koexistieren.

### Prinzipien

1. **Der Server ist die Wahrheit.** Wenn ein Spieler die Web-UI öffnet, sieht er die Server-Daten. Diskrepanzen zum Addon werden nicht angezeigt.

2. **Das Addon bleibt autonom.** Das DKP-System im Addon funktioniert weiterhin vollständig ohne Server — wichtig, falls der Server offline ist oder Spieler die Companion App nicht nutzen.

3. **Merge, nicht Überschreiben.** Jeder Upload merged Addon-Daten in die DB (via `addonEntryId`-Deduplizierung). Die DB kann Einträge haben, die das Addon nicht kennt (Web-Einträge), und umgekehrt.

4. **Tombstones werden bidirektional synchronisiert.** Ein Tombstone aus dem Addon wird in die DB übernommen. Ein Tombstone aus der Web-UI wird beim nächsten Sync-Response an den Tauri-Client übergeben.

5. **Season-Resets sind einmalig.** Ein Reset im Addon archived den Stand lokal und broadcastet. Der Server erkennt den Reset anhand leerer Points + vorhandenem Archive-Eintrag und führt seinen eigenen Reset durch.

### Konfliktszenario

```
Zeitpunkt T1: Officer A vergibt 10 DKP an Spieler X im Spiel
Zeitpunkt T2: Officer B vergibt 20 DKP an Spieler X im Web
Zeitpunkt T3: Tauri-Upload von Officer A

Ergebnis: Server hat beide Einträge (unterschiedliche Entry-IDs).
Spieler X hat 30 DKP. Kein Konflikt — Merge by Entry-ID.
```

```
Zeitpunkt T1: Officer A löscht Spieler X im Spiel (Tombstone)
Zeitpunkt T2: Officer B vergibt DKP an Spieler X im Web (vor Tombstone-Sync)
Zeitpunkt T3: Tauri-Upload enthält Tombstone

Ergebnis: Server übernimmt Tombstone, markiert Spieler X als gelöscht.
Der Web-Eintrag von T2 wird rückwirkend invalidiert (Tombstone-ts >= entry-ts).
```


---

## 10. Entwicklungsreihenfolge

### Schritt 1 — Roster.lua (Addon)
- Neues Modul erstellen und in Core.lua registrieren
- Roster-Scan bei GUILD_ROSTER_UPDATE mit 60s Throttle
- Daten in LunaWolvesDB.guild und .members schreiben
- Testen: /reload → SavedVariables prüfen

### Schritt 2 — DKP-Datenbank (Backend)
- Drizzle-Schema erweitern (dkp_entries, dkp_standings, dkp_tombstones, dkp_seasons)
- Migration generieren und auf lw-db (CT 200) ausführen
- Relations definieren

### Schritt 3 — Sync-Endpoint erweitern (Backend)
- POST /sync/addon-data um DKP-Merge-Logik erweitern
- parseDkp()-Funktion analog zu parseRoster()
- Duplikat-Erkennung via addonEntryId
- Tombstone-Handling
- Standings-Neuberechnung nach jedem Merge

### Schritt 4 — DKP REST API (Backend)
- GET /dkp/standings, /dkp/history, /dkp/player/:name
- POST /dkp/award, /dkp/spend (Officer-only, source="web")
- DELETE /dkp/players/:name (Tombstone)
- POST /dkp/reset (Season-Reset)
- WebSocket-Events für Live-Updates

### Schritt 5 — DKP Web-UI (Frontend)
- Standings-Tabelle mit Sortierung, Filter, Suche
- Einzelspieler-Ansicht mit History und Trend-Graph
- Officer-Panel für Web-Awards und Batch-Awards
- Season-Archiv-Ansicht

### Schritt 6 — Discord Bot DKP-Commands
- /dkp standings, /dkp player, /dkp history
- /dkp award, /dkp spend (Officer-only)
- Automatische Notifications im DKP-Log-Channel

### Schritt 7 — Rückkanal Web → Addon
- GET /sync/pending-entries Endpoint
- Tauri-Client pollt Pending-Entries
- Einträge in SavedVariables schreiben
- Addon lädt sie beim nächsten Login


---

## 11. Zusammenfassung

```
                    ┌─────────────────┐
                    │   WoW Addon     │
                    │  DKP.lua        │◀──── Officers vergeben DKP
                    │  Roster.lua     │◀──── Roster-Scan
                    └────────┬────────┘
                             │ SavedVariables
                    ┌────────▼────────┐
                    │  Tauri Desktop  │
                    │  Upload Agent   │
                    └────────┬────────┘
                             │ POST /sync/addon-data
                    ┌────────▼────────┐
                    │   lw-api        │
                    │  Roster Merge   │
                    │  DKP Merge      │◀──── Web-Awards (source="web")
                    │  REST API       │
                    │  WebSocket      │
                    └───┬────┬──────┬─┘
                        │    │      │
              ┌─────────▼┐ ┌─▼───┐ ┌▼────────┐
              │ Web-UI   │ │ Bot │ │ Tauri   │
              │ Dashboard│ │     │ │ Pending │
              │ DKP-Panel│ │/dkp │ │ Sync    │
              └──────────┘ └─────┘ └─────────┘
```

Das DKP-System im Addon bleibt voll funktionsfähig und unabhängig. Der Server ist ein additiver Layer, der Persistenz, Web-Zugang und Discord-Integration bringt — aber nie eine Voraussetzung für den In-Game-Betrieb ist.
