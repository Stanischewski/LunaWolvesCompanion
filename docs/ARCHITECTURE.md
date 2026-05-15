# WoW Guild Companion App — Architekturplan

## 1. Vision und Zielsetzung

Die Companion App erweitert das WoW Gilden-Addon um eine externe Plattform, die Gildendaten außerhalb des Spiels zugänglich macht. Die App schließt die Lücke zwischen den In-Game-Daten (via Addon) und den API-Daten (via Battle.net), aggregiert sie in einer zentralen Datenbank und stellt sie über Web-, Desktop-, Mobile-Clients und einen Discord-Bot bereit.

**Kernprinzip:** Das Addon sammelt Echtzeit-Daten im Spiel. Die Companion App macht diese Daten persistent, analysiert sie und liefert sie an alle Plattformen — auch wenn niemand im Spiel online ist.


---

## 2. Systemarchitektur — Überblick

### Infrastruktur (Proxmox VE + LXC Container)

```
┌─────────────────────────────────────────────────────────────┐
│  Proxmox VE Host                                            │
│                                                             │
│  VM  100  OPNsense       (Firewall, WireGuard, Gateway)     │
│                                                             │
│  CT  200  lw-db           PostgreSQL 16    10.10.10.200     │
│  CT  201  lw-cache        Redis 7          10.10.10.201     │
│  CT  202  lw-api          Fastify Backend  10.10.10.202     │
│  CT  203  lw-bot          Discord Bot      10.10.10.203     │
│  CT  204  lw-web          Next.js (SSR)    10.10.10.204     │
│  CT  205  lw-mon          Uptime Kuma      10.10.10.205     │
│                                                             │
│  ─── vmbr1 ─── 10.10.10.0/24 (internes Netz) ────────────── │
└─────────────────────────────────────────────────────────────┘
```

Alle Services laufen als eigenständige LXC Container auf einem Proxmox VE Host. Die Container kommunizieren über ein isoliertes internes Netz (`vmbr1`, `10.10.10.0/24`). OPNsense (VM 100) fungiert als Firewall und Gateway — nur die Ports 443 (HTTPS) und der WireGuard-Port werden nach außen freigegeben. Der gesamte interne Traffic zwischen den Containern bleibt im privaten Subnetz.

### Logische Architektur

```
┌─────────────────────────────────────────────────────────┐
│                    DATENQUELLEN                         │
│  WoW Addon ←→ SavedVariables → Upload Agent             │
│  Battle.net API (OAuth2, Profil, Gilde, M+, Raids)      │
│  Externe APIs (Raider.IO, Warcraftlogs)                 │
└────────────────────────┬────────────────────────────────┘
                         │
                         ▼
┌─ CT 202 (lw-api) ─────────────────────────────────────┐
│  ┌──────────┐  ┌──────────┐  ┌────────────┐           │
│  │Sync Svc  │  │ REST API │  │ WebSocket  │           │
│  └──────────┘  └──────────┘  └────────────┘           │
│  ┌──────────┐  ┌──────────┐                           │
│  │Auth Svc  │  │Scheduler │                           │
│  └──────────┘  └──────────┘                           │
└────────────────────────┬──────────────────────────────┘
                         │ 10.10.10.0/24
        ┌────────────────┼────────────────┐
        ▼                ▼                ▼
┌─ CT 200 ───┐   ┌─ CT 201 ──┐   ┌─ CT 203 ──┐
│ PostgreSQL │   │   Redis   │   │ Discord   │
│ lw-db      │   │ lw-cache  │   │ Bot       │
└────────────┘   └───────────┘   └───────────┘
                         │
                         ▼
┌─ CT 204 (lw-web) ──────────────────────────────────────┐
│  Next.js SSR → Clients (Web, Desktop, Mobile)          │
└────────────────────────────────────────────────────────┘
```


---

## 3. Technologie-Stack

### 3.1 Backend-Server

| Komponente       | Empfehlung              | Begründung |
|------------------|-------------------------|------------|
| Sprache          | **TypeScript (Node.js)**| Gleiche Sprache für Backend, Frontend und Discord Bot. Große Community, hervorragendes Ökosystem für APIs und Bots. |
| Framework        | **Fastify**             | Schneller als Express, native TypeScript-Unterstützung, Plugin-System, Schema-Validierung via JSON Schema. |
| ORM              | **Drizzle ORM**         | Type-safe, leichtgewichtig, SQL-nah. Gute PostgreSQL-Unterstützung ohne den Overhead von Prisma. |
| Authentifizierung| **Battle.net OAuth2 + JWT** | Spieler authentifizieren sich via Battle.net. Intern werden JWTs für Session-Management verwendet. |
| Task Scheduling  | **BullMQ (Redis-basiert)** | Robuste Job Queue für wiederkehrende API-Abfragen (Gilden-Roster-Polling, Raider.IO-Sync). |
| WebSocket        | **Socket.io** oder **ws** | Live-Updates für Online-Status, Raid-Events, Dashboard-Aktualisierungen. |
| API-Dokumentation| **Scalar (OpenAPI)**    | Auto-generierte API-Docs aus Fastify-Schemas. |

**Alternative:** Falls das Team Python bevorzugt, wäre FastAPI + SQLAlchemy + Celery eine vergleichbare Kombination. TypeScript hat hier den Vorteil der Code-Wiederverwendung zwischen Frontend und Backend (shared Types).


### 3.2 Datenbank

| Komponente  | Technologie     | Zweck |
|-------------|-----------------|-------|
| Primär-DB   | **PostgreSQL 16+** | Spieler, Charaktere, Gilden, Aktivitätslogs, Raid-Pläne, Loot-Tracking. Bewährt, JSONB für flexible Addon-Daten. |
| Cache/Queue | **Redis 7+**       | Session-Store, API-Response-Caching, BullMQ Job Queue, Pub/Sub für WebSocket-Events. |
| Migrations  | **Drizzle Kit**    | Schema-Migrationen versioniert im Git-Repository. |


### 3.3 Clients

| Client      | Technologie              | Begründung |
|-------------|--------------------------|------------|
| Web App     | **Next.js 15 (App Router)** | SSR für SEO (öffentliche Gildenprofile), React Server Components, API-Routes als BFF-Layer. |
| Desktop App | **Tauri 2**              | Deutlich leichtgewichtiger als Electron (~10 MB vs 150+ MB). Rust-Backend für den Upload Agent (SavedVariables parsen und hochladen). Native System-Tray-Integration. |
| Mobile App  | **React Native + Expo**  | Code-Sharing mit Web (shared UI-Komponenten via React). Push-Notifications für Raid-Einladungen, Gilden-Events. |
| UI Library  | **shadcn/ui + Tailwind CSS** | Konsistentes Design über alle React-Clients hinweg. |


### 3.4 Discord Bot

| Komponente  | Technologie     | Zweck |
|-------------|-----------------|-------|
| Framework   | **discord.js 14** | Ausgereiftes, gut dokumentiertes Framework für Discord Bots in TypeScript. |
| Commands    | **Slash Commands** | Moderne Discord-Integration, Auto-Complete, Berechtigungen. |
| Hosting     | Eigener LXC Container (CT 203 `lw-bot`), kommuniziert mit `lw-api` über internes Netz (`10.10.10.0/24`). |


### 3.5 Infrastruktur und Deployment

| Aspekt       | Empfehlung | Begründung |
|--------------|------------|------------|
| Virtualisierung | **Proxmox VE** | LXC Container für alle Services. Leichtgewichtiger als VMs, volle Isolation, einfache Snapshots und Backups. |
| Firewall/Gateway | **OPNsense (VM 100)** | Firewall, NAT, WireGuard VPN für Admin-Zugang, Reverse Proxy (HAProxy Plugin oder Caddy auf eigenem CT). |
| Netzwerk     | **vmbr1 (10.10.10.0/24)** | Isoliertes internes Netz. Nur OPNsense hat Zugang zum WAN. Container kommunizieren intern. |
| Reverse Proxy| **Caddy** (auf OPNsense oder eigenem CT) | Automatisches HTTPS via Let's Encrypt, leitet Requests an `lw-web` (204) und `lw-api` (202) weiter. |
| CI/CD        | **GitHub Actions** | Build und Test im CI. Deployment via SSH/rsync auf die jeweiligen LXC Container. |
| Monitoring   | **Uptime Kuma (CT 205 `lw-mon`)** | Überwacht alle Services im internen Netz. Benachrichtigung via Discord Webhook. |
| Backups      | **Proxmox Backup Server** oder **vzdump** | Tägliche Snapshots aller Container. PostgreSQL zusätzlich via `pg_dump` Cronjob. |
| Konfiguration | **Ansible** (optional) | Für reproduzierbare Container-Provisionierung. Alternativ Shell-Skripte pro Container. |

#### LXC Container-Spezifikationen

| CT ID | Hostname  | OS Template         | vCPU | RAM    | Disk  | Dienst |
|-------|-----------|----------------------|------|--------|-------|--------|
| 200   | lw-db     | Debian 12            | 2    | 2 GB   | 20 GB | PostgreSQL 16 |
| 201   | lw-cache  | Debian 12            | 1    | 512 MB | 4 GB  | Redis 7 |
| 202   | lw-api    | Debian 12            | 2    | 1 GB   | 10 GB | Node.js + Fastify Backend |
| 203   | lw-bot    | Debian 12            | 1    | 512 MB | 4 GB  | Node.js + discord.js Bot |
| 204   | lw-web    | Debian 12            | 2    | 1 GB   | 10 GB | Node.js + Next.js (SSR) |
| 205   | lw-mon    | Debian 12            | 1    | 512 MB | 4 GB  | Uptime Kuma |

**Gesamtbedarf:** ~9 vCPU, ~5,5 GB RAM, ~52 GB Disk — passt komfortabel auf einen dedizierten Server oder eine leistungsstarke Workstation.

#### Netzwerk- und Firewall-Regeln (OPNsense)

```
WAN → OPNsense:443 (HTTPS)      → HAProxy/Caddy → lw-web:3000 / lw-api:3001
WAN → OPNsense:51820 (WireGuard) → Admin VPN Zugang zum internen Netz

Internes Netz (vmbr1, 10.10.10.0/24):
  lw-api  (202) → lw-db    (200):5432   PostgreSQL
  lw-api  (202) → lw-cache (201):6379   Redis
  lw-bot  (203) → lw-api   (202):3001   REST API intern
  lw-web  (204) → lw-api   (202):3001   REST API / WebSocket
  lw-mon  (205) → alle CTs              HTTP Health Checks
```


---

## 4. Datenfluss im Detail

### 4.1 Addon → Backend (SavedVariables Upload)

Der Desktop-Client (Tauri) übernimmt die Brücke zwischen dem WoW Addon und dem Backend:

1. Das WoW Addon sammelt Daten (Online-Status, Aktivitäten, Raid-Teilnahmen) und speichert sie in `SavedVariables`.
2. Der Tauri Desktop-Client hat einen **Upload Agent**, der den SavedVariables-Ordner überwacht (`FileSystemWatcher`).
3. Bei Änderungen parst der Agent die Lua-Datei, extrahiert die Gildendaten und sendet sie als JSON an den Backend-Server (`POST /api/v1/sync/addon-data`).
4. Der Server validiert, dedupliziert und speichert die Daten in PostgreSQL.

```
WoW Client                  Desktop App (Tauri)           Backend
    │                              │                          │
    │── SavedVariables ──────────▶│                          │
    │   (Lua-Datei auf Disk)       │                          │
    │                              │── Parse Lua → JSON ────▶│
    │                              │   POST /api/v1/sync      │
    │                              │                          │── Validate & Store
    │                              │◀──── 200 OK ────────────│
```

**Wichtig:** Der Upload Agent wird im Tauri-Rust-Backend implementiert, nicht im Frontend-JavaScript. Rust bietet effizientes Filesystem-Watching und Lua-Parsing (via `mlua` oder einem einfachen Custom Parser).


### 4.2 Battle.net API → Backend (Scheduled Polling)

Der Scheduler (BullMQ) steuert periodische API-Abfragen:

| Job                    | Intervall  | Endpunkt                                  | Zweck |
|------------------------|------------|--------------------------------------------|-------|
| Guild Roster Sync      | 15 min     | `/data/wow/guild/{realm}/{name}/roster`     | Mitgliederliste, last_login |
| Character Profile Sync | 1 Stunde   | `/profile/wow/character/{realm}/{name}`     | Gear, M+ Score, Raid Progress |
| Achievement Scan       | 6 Stunden  | `/profile/wow/character/.../achievements`   | Neue Erfolge tracken |
| Raider.IO Enrichment   | 30 min     | `raider.io/api/v1/characters/profile`       | M+ Runs, Score Details |

Rate-Limiting wird zentral im Sync Service gehandhabt (Blizzard erlaubt 100 Requests/Sekunde pro Client-ID, Raider.IO hat ähnliche Limits).


### 4.3 Backend → Clients (REST + WebSocket)

**REST API** für Standard-Abfragen:

```
GET    /api/v1/guild/:id/members      → Mitgliederliste mit Aktivitätsstatus
GET    /api/v1/guild/:id/activity     → Aktivitätsfeed (letzte Logins, Runs, Loot)
GET    /api/v1/guild/:id/raids        → Raid-Kalender und Anmeldungen
POST   /api/v1/raids/:id/signup       → Raid-Anmeldung
GET    /api/v1/player/:id/characters  → Alle Chars eines Spielers
GET    /api/v1/player/:id/stats       → Aktivitätsstatistiken über Zeit
```

**WebSocket** für Echtzeit-Events:

```
Event: member_online     → Spieler ist online gegangen (via Addon-Sync)
Event: member_offline    → Spieler ist offline gegangen
Event: raid_signup       → Neue Raid-Anmeldung
Event: loot_dropped      → Neuer Loot im Raid (via Addon)
Event: achievement_new   → Neuer Erfolg
```

Redis Pub/Sub verteilt Events an alle verbundenen WebSocket-Clients.


---

## 5. Datenbankschema (Kernentitäten)

```
┌──────────────┐     ┌──────────────────┐     ┌──────────────┐
│   players    │     │   characters     │     │   guilds     │
│──────────────│     │──────────────────│     │──────────────│
│ id (PK)      │◀───│ player_id (FK)   │     │ id (PK)      │
│ bnet_id      │     │ id (PK)          │────▶│ name         │
│ bnet_tag     │     │ guild_id (FK)    │     │ realm        │
│ discord_id   │     │ name             │     │ faction      │
│ created_at   │     │ realm            │     │ member_count │
└──────────────┘     │ class            │     └──────────────┘
                     │ level            │
                     │ item_level       │            │
                     │ m_plus_score     │            │
                     │ last_login       │     ┌──────▼─────────┐
                     │ guild_rank       │     │  raid_events   │
                     └──────────────────┘     │────────────────│
                                              │ id (PK)        │
┌───────────────────┐                         │ guild_id (FK)  │
│ activity_logs     │                         │ title          │
│───────────────────│                         │ scheduled_at   │
│ id (PK)           │                         │ raid_type      │
│ character_id(FK)  │                         │ min_ilvl       │
│ event_type        │                         └────────────────┘
│ event_data (JSONB)│                                │
│ recorded_at       │                         ┌──────▼─────────┐
│ source (addon/api)│                         │ raid_signups   │
└───────────────────┘                         │────────────────│
                                              │ raid_event_id  │
┌──────────────────┐                          │ character_id   │
│ addon_snapshots  │                          │ role (tank/    │
│──────────────────│                          │   heal/dps)    │
│ id (PK)          │                          │ status (yes/   │
│ guild_id (FK)    │                          │   maybe/no)    │
│ uploaded_by (FK) │                          └────────────────┘
│ raw_data (JSONB) │
│ uploaded_at      │
└──────────────────┘
```

**Hinweise zum Schema:**
- `activity_logs.event_data` ist JSONB, weil die Addon-Daten unterschiedliche Strukturen haben können (Dungeon-Run, PvP-Match, Erfolg, etc.).
- `addon_snapshots` speichert die Rohdaten jedes Uploads für Debugging und Nachverarbeitung.
- `players.discord_id` ermöglicht die Verknüpfung zwischen Battle.net Account und Discord für den Bot.


---

## 6. Authentifizierung und Autorisierung

### Anmeldeflow

```
Spieler → Web/Desktop/Mobile → "Login mit Battle.net" Button
  → Redirect zu Battle.net OAuth2
  → Spieler gibt Zugriff frei
  → Callback mit Auth-Code
  → Backend tauscht Code gegen Access Token
  → Backend fragt /profile/user/wow ab (alle Charaktere)
  → Backend erstellt Player-Eintrag + verknüpfte Characters
  → Backend gibt JWT an Client zurück
```

### Rollenmodell

| Rolle          | Berechtigungen |
|----------------|----------------|
| **Mitglied**   | Eigenes Profil sehen, Gildenliste einsehen, Raid-Anmeldung, eigene Stats |
| **Offizier**   | Alles von Mitglied + Alle Spieler-Stats, Raid erstellen/bearbeiten, Notizen zu Spielern, Inaktive markieren |
| **Gildenleiter** | Alles von Offizier + Gildeneinstellungen, API-Keys, Bot-Konfiguration, Daten exportieren |

Die Rollenverteilung wird initial aus dem Gildenrang im Spiel abgeleitet (via API-Roster), kann aber im Dashboard manuell angepasst werden.


---

## 7. Discord Bot — Funktionsumfang

### Slash Commands

```
/guild status          → Aktueller Online-Status der Gilde (letzte Addon-Daten)
/guild activity        → Wer war diese Woche aktiv? Inaktive Spieler hervorheben
/guild roster          → Mitgliederliste mit Klasse, Level, Item-Level

/player info <name>    → Charakter-Infos, M+ Score, Raid-Progress
/player alts <name>    → Alle Chars dieses Spielers
/player compare <a> <b>→ Zwei Spieler vergleichen (ilvl, M+ Score, Aktivität)

/raid create <titel> <datum> <zeit>  → Neuen Raid-Event erstellen
/raid list                           → Kommende Raids anzeigen
/raid signup <raid_id> <rolle>       → Für Raid anmelden
/raid roster <raid_id>               → Angemeldete Spieler + Rollenverteilung

/loot recent           → Letzter Loot aus Raids (via Addon-Daten)
/stats weekly          → Wochenstatistik der Gilde
```

### Automatische Notifications (Discord Channel)

- **Raid-Erinnerungen:** 24h und 1h vor dem Raid an alle Angemeldeten.
- **Inaktivitäts-Warnungen:** Wöchentlicher Report an den Offiziers-Channel mit Spielern, die > 14 Tage inaktiv sind.
- **Progression-Updates:** Neuer Boss-Kill, neuer M+ Record → automatisch im Gilden-Channel posten.
- **Willkommensnachricht:** Neues Gildenmitglied erkannt → Bot begrüßt im Channel mit Link zur App.


---

## 8. Client-Features im Detail

### 8.1 Web App (Next.js)

**Öffentliche Seiten (ohne Login):**
- Gildenprofil-Seite mit Mitgliederzahl, Progression, aktueller Aktivität
- Charakter-Lookup (öffentliche Daten)

**Geschützter Bereich (nach Login):**
- **Dashboard:** Übersicht mit Online-Status (letzte Addon-Daten), anstehende Raids, Gilden-Aktivitätsfeed
- **Mitgliederverwaltung:** Sortierbare Liste aller Mitglieder mit Filtern (Klasse, Rolle, Aktivität, Item-Level)
- **Raid-Planer:** Kalenderansicht, Anmeldung, automatische Rollenverteilung (Tank/Heal/DPS mit Counts)
- **Spielerprofil:** Alle Chars, Aktivitätsgraph über Zeit, M+ History, Raid-Teilnahmen
- **Statistiken:** Gildenweite Trends (Durchschnitts-ilvl über Zeit, M+ Runs pro Woche, aktivste Spieler)
- **Einstellungen:** Gilden-Konfiguration, Discord-Bot-Setup, API-Key-Verwaltung

### 8.2 Desktop App (Tauri)

Alle Web-Features plus:
- **Upload Agent:** Automatischer SavedVariables-Upload im Hintergrund (System Tray)
- **WoW-Pfad-Erkennung:** Automatische Erkennung des WoW-Installationspfads
- **Offline-Modus:** Letzte Daten lokal gecacht, auch ohne Internetverbindung einsehbar

### 8.3 Mobile App (React Native)

Fokus auf schnellen Zugriff:
- **Push Notifications:** Raid-Erinnerungen, Gilden-Events
- **Quick Actions:** Raid-Anmeldung mit einem Tap
- **Übersichts-Dashboard:** Kompakte Darstellung der wichtigsten Daten


---

## 9. Projektstruktur (Monorepo)

```
guild-companion/
├── apps/
│   ├── api/                  # Fastify Backend → CT 202 (lw-api)
│   │   ├── src/
│   │   │   ├── routes/       # API-Endpunkte
│   │   │   ├── services/     # Business-Logik (sync, auth, raids)
│   │   │   ├── jobs/         # BullMQ Jobs (scheduled tasks)
│   │   │   ├── ws/           # WebSocket Handler
│   │   │   └── db/           # Drizzle Schema + Migrations
│   │   └── ecosystem.config.js  # PM2 Prozessmanager Config
│   ├── web/                  # Next.js Web App → CT 204 (lw-web)
│   │   ├── app/              # App Router Pages
│   │   ├── components/       # React Components
│   │   └── ecosystem.config.js
│   ├── desktop/              # Tauri Desktop App (Client-seitig)
│   │   ├── src-tauri/        # Rust Backend (Upload Agent)
│   │   └── src/              # React Frontend (shared with web)
│   ├── mobile/               # React Native App (Client-seitig)
│   │   └── src/
│   └── bot/                  # Discord Bot → CT 203 (lw-bot)
│       ├── src/
│       │   ├── commands/     # Slash Command Handler
│       │   ├── events/       # Discord Event Handler
│       │   └── embeds/       # Message Embed Builder
│       └── ecosystem.config.js
├── packages/
│   ├── shared-types/         # TypeScript Types (Player, Guild, Raid...)
│   ├── shared-ui/            # Shared React Components (shadcn/ui basiert)
│   ├── api-client/           # Type-safe API Client (aus OpenAPI generiert)
│   └── lua-parser/           # SavedVariables Parser (Lua → JSON)
├── deploy/
│   ├── lxc/
│   │   ├── 200-db.sh         # PostgreSQL Setup (CT 200)
│   │   ├── 201-cache.sh      # Redis Setup (CT 201)
│   │   ├── 202-api.sh        # Node.js + PM2 Setup (CT 202)
│   │   ├── 203-bot.sh        # Node.js + PM2 Setup (CT 203)
│   │   ├── 204-web.sh        # Node.js + PM2 Setup (CT 204)
│   │   └── 205-mon.sh        # Uptime Kuma Setup (CT 205)
│   ├── deploy-api.sh         # Build → rsync → PM2 reload auf lw-api
│   ├── deploy-web.sh         # Build → rsync → PM2 reload auf lw-web
│   ├── deploy-bot.sh         # Build → rsync → PM2 reload auf lw-bot
│   └── backup.sh             # pg_dump + vzdump Wrapper
├── turbo.json                # Turborepo Config
└── package.json
```

**Monorepo-Tool:** Turborepo. Verwaltet Build-Abhängigkeiten, shared Packages, und parallele Builds über alle Apps hinweg.

**Prozessmanager:** PM2 auf jedem Node.js-Container (CT 202, 203, 204). Automatischer Restart bei Crashes, Log-Management, Cluster-Mode für Next.js.

**Deployment-Workflow:** GitHub Actions baut die Apps, rsync überträgt die Build-Artefakte via SSH (WireGuard VPN) auf den jeweiligen Container, PM2 reload startet den Prozess ohne Downtime neu.


---

## 10. Entwicklungsphasen

### Phase 0 — Infrastruktur (1–2 Wochen)
- Proxmox VE Host aufsetzen, vmbr1 Bridge konfigurieren
- OPNsense VM installieren (Firewall-Regeln, WireGuard VPN, NAT)
- LXC Container erstellen (CT 200–205) mit Debian 12 Templates
- PostgreSQL auf lw-db, Redis auf lw-cache, Uptime Kuma auf lw-mon einrichten
- Node.js + PM2 auf lw-api, lw-bot, lw-web vorinstallieren
- Caddy/HAProxy als Reverse Proxy mit Let's Encrypt Zertifikat
- Backup-Strategie einrichten (vzdump + pg_dump Cronjobs)

### Phase 1 — Fundament (4–6 Wochen)
- PostgreSQL Schema + Drizzle ORM Setup
- Fastify Backend mit Battle.net OAuth2 Login
- REST API für Gilden-Roster und Spielerprofile
- Battle.net API Polling (Scheduled Jobs via BullMQ)
- Einfaches Web-Dashboard (Next.js) mit Login und Mitgliederliste

### Phase 2 — Addon-Integration (3–4 Wochen)
- SavedVariables Lua Parser (TypeScript/Rust)
- Tauri Desktop App mit Upload Agent
- Sync Service für Addon-Daten
- Online-Status-Tracking aus Addon-Daten

### Phase 3 — Discord Bot (2–3 Wochen)
- discord.js Bot mit Slash Commands
- Raid-Planer (Create, Signup, Roster)
- Automatische Notifications (Raid-Reminder, Inaktivität)

### Phase 4 — Echtzeit und Analytics (3–4 Wochen)
- WebSocket-Integration für Live-Updates
- Aktivitäts-Statistiken und Trend-Graphen
- Raider.IO / Warcraftlogs Enrichment
- Spieler-Vergleichs-Feature

### Phase 5 — Mobile und Polish (3–4 Wochen)
- React Native Mobile App
- Push Notifications
- Öffentliche Gildenprofile (SEO-optimiert)
- Onboarding-Flow für neue Gildenmitglieder


---

## 11. Sicherheit und Datenschutz

- **DSGVO:** Self-Hosted in DE auf eigenem Proxmox-Server. Volle Datenhoheit. Spieler können ihre Daten jederzeit löschen.
- **Netzwerk-Isolation:** Alle Services im privaten Subnetz (10.10.10.0/24). Nur OPNsense hat WAN-Zugang. Kein direkter Zugriff auf DB oder Redis von außen.
- **Admin-Zugang:** Ausschließlich via WireGuard VPN. SSH nur im internen Netz erreichbar.
- **Battle.net Tokens:** Access Tokens werden verschlüsselt in der DB gespeichert, nie an den Client gesendet.
- **JWT:** Short-lived Access Tokens (15 min) + Refresh Tokens (7 Tage). HttpOnly Cookies für Web.
- **Rate Limiting:** API-Endpoints sind rate-limitiert (Fastify-Plugin). OPNsense begrenzt zusätzlich Requests auf WAN-Ebene.
- **Input Validation:** Alle Inputs via JSON Schema validiert (Fastify Schema Validation).
- **CORS:** Strict Origin-Whitelist für API-Zugriffe.
- **Backups:** Tägliche vzdump-Snapshots aller Container + pg_dump der Datenbank. Rotation: 7 Tage lokal, optional Offsite-Backup.


---

## 12. Kosten-Schätzung (monatlich, Startphase)

| Posten                    | Kosten/Monat   |
|---------------------------|----------------|
| Proxmox Host (Strom)      | ~10–20 € (je nach Hardware) |
| Statische IP / DynDNS     | ~0–5 €         |
| Domain + SSL (Let's Encrypt) | ~1 €        |
| Discord Bot Hosting        | 0 € (CT 203)  |
| Apple Developer Acc.       | ~8 € (99 $/Jahr) |
| **Gesamt**                 | **~20–35 €**   |

**Hinweis:** Durch Self-Hosting auf eigenem Proxmox-Server entfallen Cloud-/VPS-Kosten. Die Hauptkosten sind Strom und eine statische IP oder DynDNS-Lösung. Bei Bedarf kann die Infrastruktur auf einen dedizierten Hetzner-Server (ab ~40 €/Monat) migriert werden — die LXC-Container lassen sich via vzdump 1:1 übertragen.


---

## 13. Zusammenfassung

Die Companion App verbindet zwei komplementäre Datenquellen — das In-Game-Addon für Echtzeit-Daten und die Battle.net API für Profil- und Progressionsdaten — in einem zentralen Backend. Alle Services laufen als isolierte LXC Container auf einem Proxmox VE Host, geschützt durch OPNsense als Firewall und Gateway. TypeScript als durchgehende Sprache minimiert den Kontextwechsel zwischen Backend, Frontend und Bot. Der Tauri Desktop-Client übernimmt die kritische Brücke vom Addon zum Server, während die Web- und Mobile-Clients den Zugriff von überall ermöglichen. Der Discord-Bot integriert sich nahtlos in den Kommunikationskanal, den die meisten Gilden ohnehin nutzen. Durch Self-Hosting bleibt die volle Datenhoheit erhalten, und die Container-Architektur erlaubt bei Bedarf eine unkomplizierte Migration auf dedizierte Hardware oder in die Cloud.
