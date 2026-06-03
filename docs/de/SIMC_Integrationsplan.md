# SimulationCraft Self-Hosted — Integrationsplan

## 1. Vision und Zielsetzung

Dieser Plan beschreibt die Integration eines **selbst gehosteten SimulationCraft (SimC)**-Dienstes in die bestehende LunaWolvesCompanion-Infrastruktur. Ziel ist es, Gildenmitgliedern DPS-Simulationen für ihre Charaktere direkt im Companion-Ökosystem bereitzustellen — über das Web-Dashboard und den Discord-Bot — ohne Abhängigkeit von externen Diensten wie Raidbots.

**Kernprinzip:** SimulationCraft ist Open Source und auf Linux trivial selbst kompilierbar. Der neue Dienst läuft als eigenständiger LXC Container (CT 206 `lw-sim`) und fügt sich nahtlos in den bestehenden Stack ein. Die Simulation wird als Job über die vorhandene BullMQ-Queue (Redis, CT 201) abgewickelt, die Ergebnisse landen in der bestehenden PostgreSQL-Datenbank (CT 200). Es ist **kein separates Frontend** und **kein neuer WAN-Zugang** nötig.

**Warum self-hosted statt Raidbots-API?** Raidbots bietet keine offizielle, dokumentierte Drittanbieter-API. Inoffizielle Wrapper existieren, werden aber nicht mehr gepflegt und können jederzeit brechen. Self-Hosting bringt volle Kontrolle, ToS-Konformität, persistente Ergebnis-Speicherung in der eigenen DB und keine Rate-Limits durch Dritte.


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
│  CT  206  lw-sim          SimC Worker      10.10.10.206  ◀── NEU
│                                                             │
│  ─── vmbr1 ─── 10.10.10.0/24 (internes Netz) ────────────── │
└─────────────────────────────────────────────────────────────┘
```

Der neue Container `lw-sim` (CT 206) reiht sich in das bestehende isolierte Netz ein. Er benötigt keinen WAN-Zugang — alle Aufträge kommen intern über die Queue, alle Ergebnisse fließen intern in die DB. Die einzige Außenverbindung ist beim nächtlichen SimC-Update (Git-Pull von GitHub), das über das OPNsense-Gateway läuft.

### Logische Architektur

```
┌────────────────────────────────────────────────────────┐
│                    AUSLÖSER                            │
│  Web-Dashboard  (Button "Quick Sim")                   │
│  Discord-Bot    (/sim @Spieler)                        │
│  Addon          (/simc-String aus SavedVariables)      │
└────────────────────────┬───────────────────────────────┘
                         │
                         ▼
┌─ CT 202 (lw-api) ─────────────────────────────────────┐
│  POST /sim/start  → validiert simc-String             │
│                   → legt Job in BullMQ-Queue an       │
└────────────────────────┬──────────────────────────────┘
                         │ enqueue
                         ▼
┌─ CT 201 (lw-cache) ───────────────────────────────────┐
│  Redis · BullMQ Queue "simc-jobs"                     │
└────────────────────────┬──────────────────────────────┘
                         │ dequeue (concurrency = 1)
                         ▼
┌─ CT 206 (lw-sim) ──────────────────────────────────────┐
│  ┌──────────────┐   ┌──────────────────┐               │
│  │ BullMQ       │──▶│  simc CLI         │              │
│  │ Consumer     │   │  (Child Process)  │              │
│  └──────────────┘   └────────┬──────────┘              │
│         │ JSON-Result          │                       │
└─────────┼─────────────────────┼────────────────────────┘
          │                     │ schreibt
          ▼                     ▼
┌─ CT 200 (lw-db) ──────────────────────────────────────┐
│  PostgreSQL · Tabelle sim_results                     │
└────────────────────────┬──────────────────────────────┘
                         │ WebSocket-Push (via lw-api)
                         ▼
┌─ CT 204 (lw-web) / CT 203 (lw-bot) ───────────────────┐
│  Dashboard zeigt DPS-Karte · Bot postet Embed         │
└───────────────────────────────────────────────────────┘
```


---

## 3. Technologie-Stack

### 3.1 Simulation Engine

| Komponente       | Empfehlung              | Begründung |
|------------------|-------------------------|------------|
| Engine           | **SimulationCraft (simc CLI)** | Open Source, Industriestandard für WoW-DPS-Simulation. Command-Line-Variante ist die empfohlene, gepflegte Schnittstelle (die GUI ist weitgehend unmaintained). |
| Build            | **Nightly aus Git (`make`)** | Es gibt keinen offiziellen Linux-Release. SimC wird laut Projekt-Doku auf Linux einfach selbst gebaut. Nightly-Builds enthalten die neuesten Spec-Fixes pro WoW-Patch. |
| Worker-Sprache   | **TypeScript (Node.js)** | Konsistent mit dem restlichen Stack. Spawnt `simc` als Child Process, parst das JSON-Result. |
| Job-Queue        | **BullMQ (Redis-basiert)** | Bereits im Stack vorhanden (CT 201). Concurrency-Limit verhindert CPU-Überlastung. |
| Output-Format    | **JSON (`json2=`)** | Maschinell auswertbar — DPS, Konfidenzintervall, Buff-Uptimes etc. landen strukturiert in der DB. |

**Hinweis zur CPU-Last:** SimulationCraft ist außerhalb von dedizierten CPU-Benchmarks eines der rechenintensivsten Programme überhaupt. Es ist sequenziell pro Fight, parallelisiert aber über Iterationen via `threads=N`. Deshalb: Concurrency in der Queue auf 1 begrenzen, `process_priority=below_normal` setzen, damit der Sim-Job andere Container nicht ausbremst.


### 3.2 Datenbank-Erweiterung

| Komponente  | Technologie     | Zweck |
|-------------|-----------------|-------|
| Neue Tabelle | **`sim_results`** | Speichert Sim-Aufträge und -Ergebnisse pro Charakter. |
| Snapshot    | **`sim_inputs` (optional)** | Speichert den rohen `/simc`-String pro Auftrag — analog zu `addon_snapshots`, für Debugging und Re-Sim. |
| Migration   | **Drizzle Kit**    | Schema-Migration versioniert im Git-Repo, wie der bestehende Stack. |


### 3.3 Clients (keine neuen)

| Client      | Erweiterung              | Begründung |
|-------------|--------------------------|------------|
| Web App     | **Neue Route `/roster/[character]/sim`** | Sim starten, Live-Status, DPS-Ergebnis-Karte. Nutzt bestehendes Next.js + shadcn/ui. |
| Discord Bot | **Neuer Slash Command `/sim`** | Stößt Sim an, postet Ergebnis als Embed. Nutzt bestehende discord.js-Infrastruktur. |
| Desktop App | **`/simc`-Export-Sync** | Tauri-Client liest den `/simc`-String aus SavedVariables und schickt ihn beim Sync mit. Keine neue App nötig. |


---

## 4. Datenfluss im Detail

### 4.1 Addon → Backend (`/simc`-String)

Der `/simc`-String ist die Standard-Ausgabe des SimulationCraft-Addons im Spiel. Er enthält Charakter, Spec, Gear, Talente und Inventar. Das Companion-Addon übernimmt diesen String und speichert ihn in den SavedVariables.

1. Spieler hat das SimulationCraft-Addon installiert (Standard in den meisten Gilden) **oder** das LunaWolves-Addon generiert den String selbst aus den Charakterdaten.
2. Der String wird in den SavedVariables abgelegt (neues Feld neben Roster- und DKP-Daten).
3. Der Tauri Desktop-Client liest ihn beim nächsten Sync mit und sendet ihn an das Backend (`POST /api/v1/sync/addon-data`, erweitert um das Feld `simc_string`).
4. Das Backend legt den String pro Charakter ab — bereit für Sims.

```
WoW Client                  Desktop App (Tauri)           Backend
    │                              │                          │
    │── /simc-String ─────────────▶│                          │
    │   (in SavedVariables)        │                          │
    │                              │── beim Sync ───────────▶│
    │                              │   simc_string-Feld       │
    │                              │                          │── speichern pro Char
    │                              │◀──── 200 OK ────────────│
```

**Wichtig:** Der `/simc`-String bleibt an den Charakter-Namen gebunden (konsistent mit dem bestehenden Prinzip, dass DKP-Daten an Namens-Strings binden, nicht an UUIDs).


### 4.2 Auftrag → Queue → Worker

```
Dashboard / Bot           lw-api (CT 202)        Redis (CT 201)      lw-sim (CT 206)
    │                          │                      │                   │
    │── POST /sim/start ──────▶│                      │                   │
    │   { character }          │                      │                   │
    │                          │── enqueue Job ──────▶│                   │
    │                          │   "simc-jobs"        │                   │
    │◀── 202 Accepted ─────────│   { jobId }          │                   │
    │   { jobId }              │                      │── dequeue ───────▶│
    │                          │                      │  (concurrency=1)  │
    │                          │                      │                   │── spawn simc
    │                          │                      │                   │   (5–300 Sek.)
    │                          │                      │◀── JSON-Result ───│
    │                          │◀── speichern in DB ──│                   │
    │◀── WS: sim_done ─────────│                      │                   │
```

Der Worker auf CT 206 schreibt ein temporäres `.simc`-Profil aus dem String, hängt die Sim-Parameter an (Iterationen, Fight-Länge, JSON-Output) und ruft `simc` als Child Process auf. Das JSON-Result wird geparst, das relevante DPS-Feld extrahiert und über `lw-api` in PostgreSQL geschrieben.


### 4.3 Backend → Clients (Status + Ergebnis)

**REST API** (neue Endpoints auf `lw-api`):

```
POST   /api/v1/sim/start         → startet Sim, gibt jobId zurück
GET    /api/v1/sim/:jobId        → Status (queued/running/done/failed) + Ergebnis
GET    /api/v1/sim/character/:name → letzte Sim-Ergebnisse eines Charakters
```

**WebSocket** (neue Events, via bestehendes Redis Pub/Sub):

```
Event: sim_queued     → Auftrag in Queue aufgenommen
Event: sim_running    → Sim läuft (mit optionalem Fortschritt)
Event: sim_done       → Sim fertig, DPS-Ergebnis im Payload
Event: sim_failed     → Sim fehlgeschlagen (Grund im Payload)
```


---

## 5. Datenbankschema (neue Entitäten)

```
┌──────────────────────┐          ┌──────────────────────┐
│   sim_results        │          │   characters         │
│──────────────────────│          │──────────────────────│
│ id (PK)              │          │ id (PK)              │
│ character_name (FK*) │─────────▶│ name                 │
│ job_id (unique)      │          │ ...                  │
│ sim_type             │          └──────────────────────┘
│   (quick/top_gear)   │           * Bindung an Namens-
│ status               │             String, konsistent
│   (queued/running/   │             mit DKP-Prinzip
│    done/failed)      │
│ dps                  │
│ dps_error            │   ┌──────────────────────┐
│ report_json (JSONB)  │   │   sim_inputs         │
│ simc_version         │   │──────────────────────│
│ created_at           │   │ id (PK)              │
│ completed_at         │   │ job_id (FK)          │
└──────────────────────┘   │ simc_string (TEXT)   │
                           │ created_at           │
                           └──────────────────────┘
```

**`sim_results`** ist die Kerntabelle: ein Eintrag pro Sim-Auftrag, mit Status-Verlauf, DPS-Wert, Fehlerbalken (Konfidenz) und dem vollständigen JSON-Report in JSONB für Detailauswertungen.

**`sim_inputs`** (optional, empfohlen) speichert den rohen `/simc`-String je Auftrag — analog zur bestehenden `addon_snapshots`-Idee. Erlaubt Re-Sims ohne erneuten Addon-Export und ist nützlich beim Debugging.


---

## 6. CT 206 (lw-sim) — Container-Spezifikation

| Attribut   | Wert        | Begründung |
|------------|-------------|------------|
| CT ID      | **206**     | Nächste freie ID nach dem bestehenden Stack. |
| Hostname   | **lw-sim**  | Konsistent mit dem Naming-Schema (`lw-*`). |
| IP         | **10.10.10.206** | Internes Netz, kein WAN-Exposure. |
| OS         | Debian 12   | Wie alle anderen Container. |
| vCPU       | **4**       | SimC ist CPU-gebunden; mehr Threads = kürzere Sim-Zeit. 4 Kerne sind ein guter Kompromiss für eine Gilde. |
| RAM        | **4 GB**    | Ein Sim-Prozess belegt ~50–300 MB je nach Typ; Rest für OS, Node.js und Build-Cache. |
| Disk       | **20 GB**   | SimC-Binary + Quellcode (~1–2 GB inkl. Build) + JSON-Ergebnisse. |

**Aktualisierung des Gesamtbedarfs (mit CT 206):** ~13 vCPU, ~9,5 GB RAM, ~72 GB Disk. Liegt weiterhin im Rahmen eines dedizierten Servers oder einer leistungsstarken Workstation.

### Laufzeit-Richtwerte (4 vCPU, ~1.000 Iterationen)

| Sim-Typ      | Beschreibung                              | Dauer (Richtwert) |
|--------------|-------------------------------------------|-------------------|
| Quick Sim    | Einzelner DPS-Wert, aktuelles Gear        | ~5–15 Sekunden    |
| Stat Weights | Stat-Gewichte berechnen                   | ~30–90 Sekunden   |
| Top Gear     | Viele Gear-Kombinationen vergleichen      | ~2–5 Minuten      |

Für den Gildeneinsatz unkritisch: Aufträge laufen sequenziell in der Queue, der Status wird live ins Dashboard gepusht.


---

## 7. Netzwerk- und Firewall-Regeln (Ergänzung)

```
Internes Netz (vmbr1, 10.10.10.0/24):
  lw-sim  (206) → lw-cache (201):6379   Redis / BullMQ (Job-Abruf)
  lw-sim  (206) → lw-api   (202):3001   Ergebnis zurückschreiben (intern)
  lw-mon  (205) → lw-sim   (206)        HTTP Health Check

WAN (nur für Updates):
  lw-sim  (206) → github.com:443        SimC Nightly Git-Pull (über OPNsense)
```

`lw-sim` nimmt **keine** eingehenden WAN-Verbindungen an. Aufträge kommen ausschließlich intern über die Queue.


---

## 8. SimC Installation & Updates

### Erstinstallation (CT 206)

```bash
# Build-Abhängigkeiten
apt update && apt install -y git cmake g++ libcurl4-openssl-dev default-jre

# SimC Nightly klonen und bauen
cd /opt
git clone --depth=1 https://github.com/simulationcraft/simc.git
cd simc && make -j4 OPENSSL=1

# Binary liegt unter /opt/simc/engine/simc
```

### Automatische Updates

SimulationCraft veröffentlicht nur noch Nightly-Builds, da manuelle Releases im WoW-Patch-Rhythmus schnell veralten. Ein täglicher Cronjob (oder GitHub-Actions-getriggert) auf CT 206 hält die Engine aktuell:

```bash
#!/bin/bash
# /opt/update-simc.sh  — täglich via Cron
cd /opt/simc
git pull --depth=1
make -j4 OPENSSL=1
pm2 restart lw-sim   # Worker neu starten, damit neue Binary greift
```

```
# Crontab (täglich um 05:00)
0 5 * * * /opt/update-simc.sh >> /var/log/simc-update.log 2>&1
```

Die in jedem Sim-Result gespeicherte `simc_version` (Git-Commit-Hash) macht nachvollziehbar, mit welcher Engine-Version ein Ergebnis erzeugt wurde.


---

## 9. Projektstruktur (Ergänzung zum Monorepo)

```
guild-companion/
├── apps/
│   ├── api/
│   │   └── src/
│   │       ├── routes/
│   │       │   └── sim.ts        # NEU: POST /sim/start, GET /sim/:jobId
│   │       └── jobs/
│   │           └── simc.queue.ts # NEU: BullMQ Queue-Definition "simc-jobs"
│   ├── web/
│   │   └── app/
│   │       └── roster/[character]/sim/  # NEU: Sim-Page
│   ├── bot/
│   │   └── src/commands/
│   │       └── sim.ts            # NEU: /sim Slash Command
│   └── sim/                      # NEU: SimC Worker → CT 206 (lw-sim)
│       ├── src/
│       │   ├── worker.ts         # BullMQ Consumer
│       │   ├── runner.ts         # simc Child-Process-Wrapper
│       │   └── parser.ts         # JSON-Result → DPS + Felder extrahieren
│       └── ecosystem.config.js   # PM2 Config
├── packages/
│   └── shared-types/
│       └── sim.ts                # NEU: SimJob, SimResult Types
└── deploy/
    └── lxc/
        ├── 206-sim.sh            # NEU: SimC Build + Node.js + PM2 Setup
        └── update-simc.sh        # NEU: Nightly Update-Script
```

**Prozessmanager:** PM2 auf CT 206, wie auf den anderen Node.js-Containern. Worker startet automatisch neu bei Crashes und nach SimC-Updates.

**Deployment-Workflow:** Identisch zum bestehenden Stack — GitHub Actions baut den Worker, rsync überträgt via SSH (WireGuard), PM2 reload startet ohne Downtime neu.


---

## 10. Entwicklungsphasen

### Phase A — Container & Engine (1 Woche)
- CT 206 (`lw-sim`) auf Proxmox erstellen, in vmbr1 einbinden
- SimC aus Git bauen, Test-Sim manuell mit einem `/simc`-String verifizieren
- Update-Cronjob einrichten
- Uptime-Kuma-Monitor für CT 206 hinzufügen

### Phase B — Worker & Queue (1–2 Wochen)
- BullMQ Queue `simc-jobs` in `lw-api` definieren
- SimC Worker (`apps/sim`) implementieren: Consumer, Child-Process-Runner, JSON-Parser
- DB-Migration für `sim_results` (+ optional `sim_inputs`) via Drizzle
- Ergebnis-Persistierung testen (End-to-End: enqueue → simc → DB)

### Phase C — API & Echtzeit (1 Woche)
- REST-Endpoints `POST /sim/start`, `GET /sim/:jobId` in `lw-api`
- WebSocket-Events `sim_queued / sim_running / sim_done / sim_failed`
- Rate-Limiting / Quota pro Charakter

### Phase D — Clients (1–2 Wochen)
- Addon: `/simc`-Export in SavedVariables, Sync-Erweiterung im Tauri-Client
- Web: Sim-Page mit Button, Live-Status und DPS-Karte
- Discord: `/sim @Spieler` Command mit Ergebnis-Embed


---

## 11. Sicherheit, Limits und Betrieb

- **Netzwerk-Isolation:** `lw-sim` ist nur intern erreichbar. Aufträge kommen ausschließlich über die Queue — keine offene API nach außen.
- **Input-Behandlung:** Der `/simc`-String wird vom Worker als Datei in einem isolierten Temp-Verzeichnis geschrieben. SimC führt keinen beliebigen Code aus, aber „low-level"-Optionen (Datei-/Thread-/Proxy-Befehle) werden serverseitig herausgefiltert, bevor der String an `simc` übergeben wird.
- **Concurrency-Limit:** BullMQ-Concurrency = 1. Aufträge laufen sequenziell, ein einzelner Sim kann den Host nicht über mehrere Jobs hinweg auslasten.
- **Quota:** Optional eine tägliche Sim-Quota pro Charakter (z. B. 10/Tag), um Missbrauch durch wiederholtes Antriggern zu verhindern. Für eine Gilde meist nicht nötig, aber als Schutz sinnvoll.
- **Timeout:** Jeder Sim-Job bekommt ein hartes Zeitlimit (z. B. 10 Minuten). Hängende Prozesse werden vom Worker beendet und der Job als `failed` markiert.
- **Prozesspriorität:** `process_priority=below_normal` im Sim-Profil, damit der Sim andere Container nicht ausbremst.
- **Monitoring:** Uptime Kuma (CT 205) prüft die Erreichbarkeit des Workers. BullMQ liefert Queue-Metriken (Wartende/Fehlgeschlagene Jobs).
- **Backups:** CT 206 wird in die bestehende vzdump-Rotation aufgenommen. Da die Engine jederzeit neu baubar ist und Ergebnisse in der DB liegen, ist der Container weitgehend zustandslos.


---

## 12. Kosten-Schätzung

Die Integration verursacht **keine zusätzlichen laufenden Kosten** über den bestehenden Stack hinaus. CT 206 läuft auf derselben Proxmox-Hardware. Der zusätzliche Strombedarf durch die CPU-Last während Sims ist minimal (Sims laufen nur auf Anforderung, nicht dauerhaft).

| Posten                       | Kosten/Monat |
|------------------------------|--------------|
| Zusätzliche Cloud-/Lizenzkosten | 0 €        |
| Zusätzlicher Strom (sporadische CPU-Last) | vernachlässigbar |
| **Gesamt (zusätzlich)**      | **~0 €**     |

Falls die Sim-Last später stark steigt (große Gilde, viele parallele Top-Gear-Sims), lässt sich CT 206 problemlos auf mehr vCPU hochskalieren oder via vzdump auf dedizierte Hardware auslagern.


---

## 13. Zusammenfassung

Der self-hosted SimulationCraft-Dienst fügt der Companion-App eine wertvolle DPS-Optimierungsfunktion hinzu, ohne die Architektur-Prinzipien zu verletzen. Ein einzelner neuer Container (CT 206 `lw-sim`) nutzt die bereits vorhandene Redis-Queue und PostgreSQL-Datenbank — es braucht weder ein eigenes Frontend noch einen neuen WAN-Zugang. SimulationCraft als Open-Source-Engine wird nächtlich aus Git gebaut und bleibt damit im WoW-Patch-Rhythmus aktuell. Aufträge fließen sequenziell durch die Queue, Ergebnisse werden persistent in der DB gespeichert und live ins Dashboard sowie an den Discord-Bot gepusht. Im Gegensatz zur inoffiziellen Raidbots-API bleibt der Dienst voll unter eigener Kontrolle, ToS-konform und unabhängig von externen Rate-Limits. Die Integration gliedert sich in vier überschaubare Phasen und verursacht praktisch keine zusätzlichen Betriebskosten.
