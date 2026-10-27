# Luna Wolves — Setup auf Proxmox

## Übersicht

Alle drei Dienste laufen in **einem** Container, verwaltet von PM2. Die
Datenbank liegt in einem eigenen, bereits bestehenden Container.

```
┌──────────────────────────────────────────────────────────────┐
│  Proxmox VE Host                                             │
│                                                              │
│  CT  2xx  (bestehend)  PostgreSQL ≥ 14                       │
│                        Datenbank "lunawolves"                │
│                                                              │
│  CT  202  lw-app       PM2                                   │
│                        ├── lw-api   Fastify     :3001        │
│                        ├── lw-bot   Discord      —           │
│                        └── lw-web   Next.js     :3000        │
│                                                              │
│  ─── internes Netz ───────────────────────────────────────────│
└──────────────────────────────────────────────────────────────┘
```

Bot und Web-SSR erreichen die API über `127.0.0.1` — dieser Verkehr verlässt
den Container nicht mehr.

### Was weggefallen ist

| Früher | Jetzt |
|--------|-------|
| CT 200 `lw-db` | der bestehende DB-Container |
| CT 201 `lw-cache` (Redis) | entfällt, siehe unten |
| CT 202/203/204 getrennt | ein Container, drei PM2-Prozesse |
| CT 205 `lw-mon` (Uptime Kuma) | entfällt; `GET /api/v1/health` und `pm2 status` |
| drei `.env`-Dateien | eine, `/opt/lunawolves/.env` |
| Baseline-Schritt für die Migrationen | entfällt bei frischer Datenbank |

**Zu Redis:** Die API nutzt es für den Rollen-Cache und den Sync-Cooldown.
Ohne `REDIS_URL` greift ein begrenzter Cache im Prozessspeicher — bei
**einem** API-Prozess verhält der sich gleich. Erst wenn in
`ecosystem.config.cjs` `instances > 1` gesetzt wird, wird Redis zur Pflicht:
sonst hat jeder Worker seinen eigenen Rollen-Cache und seinen eigenen
Cooldown, womit die Drossel wirkungslos wäre. Darum steht dort bewusst
`instances: 1`.

## Voraussetzungen

- Proxmox VE 8.x, Bridge und Gateway vorhanden
- Ein laufender PostgreSQL-Container, **Version 14 oder neuer** (empfohlen 16)
- Die Domain zeigt per Reverse Proxy auf den App-Container:
  `/` → Port 3000, `/api` und `/auth` → Port 3001

## Ablauf

### 1. App-Container anlegen (auf dem PVE-Host)

```bash
CTID=202 IP=10.10.10.202/24 GW=10.10.10.1 bash 01-create-container.sh
```

Standard sind 2 Kerne, 4 GB RAM, 16 GB Platte. Mit 2 GB RAM kann der
Next.js-Build scheitern. Abweichend z.B.:
`CORES=4 MEMORY=6144 DISK=24 STORAGE=local-zfs ...`

### 2. Datenbank im bestehenden Container anlegen

Das Skript installiert **kein** PostgreSQL und ändert weder Tuning noch
`listen_addresses` eigenmächtig — in dem Container können andere Datenbanken
liegen. Es legt Rollen, Datenbank und Rechte an und ergänzt `pg_hba.conf` nur
um die eigenen Zeilen (mit Sicherungskopie).

```bash
pct push <DB_CTID> 02-create-database.sh /root/create-db.sh
pct exec <DB_CTID> -- bash -c "APP_HOST=10.10.10.202 bash /root/create-db.sh"
pct exec <DB_CTID> -- cat /root/lunawolves-db.txt    # Zugangsdaten
```

Es entstehen zwei Rollen: `lw_admin` besitzt das Schema und führt die
Migrationen aus, `lw_app` betreibt die API und darf nur lesen und schreiben,
nichts anlegen.

> Die Rolle `lw_app` muss **vor** den Migrationen existieren — Migration
> `0009` referenziert sie und bricht sonst ab.

Hört PostgreSQL nur auf `localhost`, weist das Skript darauf hin. Dann in
`postgresql.conf` anpassen und den Dienst neu starten.

### 3. App-Container provisionieren

```bash
pct exec 202 -- bash -c "curl -fsSL https://raw.githubusercontent.com/Stanischewski/LunaWolvesCompanion/main/deploy/lxc/setup.sh | bash -s all"
```

Beim ersten Lauf legt das Skript `/opt/lunawolves/.env` aus der Vorlage an und
hört dort auf — ohne Konfiguration baut es nicht.

### 4. Konfigurieren

```bash
pct exec 202 -- nano /opt/lunawolves/.env
```

Eine Datei für alle drei Dienste. `apps/{api,bot,web}/.env` werden darauf
verlinkt, `BOT_SECRET` und `DISCORD_BOT_TOKEN` können also nicht mehr
auseinanderlaufen.

`LUNA_GUILD_ID` bleibt zunächst **leer** — die Gilden-UUID gibt es erst nach
dem ersten Addon-Sync. Das Setup startet den Bot dann noch nicht, statt ihn in
eine Neustartschleife laufen zu lassen.

### 5. Bauen und starten

```bash
pct exec 202 -- bash /opt/lunawolves/deploy/lxc/setup.sh all
```

Das Skript prüft die DB-Verbindung, spielt die Migrationen ein, **zählt
gegen, dass alle verbucht wurden**, und startet dann PM2. Bleibt eine
Migration aus, bricht es ab, statt eine API zu starten, die später mit
HTTP 500 antwortet.

### 6. Bot nachziehen

Nach dem ersten Sync:

```bash
pct exec 202 -- psql "$DATABASE_URL" -tAc 'SELECT id, name FROM guilds'
# UUID in /opt/lunawolves/.env bei LUNA_GUILD_ID eintragen, dann:
pct exec 202 -- pm2 start /opt/lunawolves/deploy/lxc/ecosystem.config.cjs --only lw-bot
pct exec 202 -- pm2 save
```

## Pflichtvariablen

Die Rechteprüfung ist **fail closed**. Fehlen diese Werte, kann niemand DKP
buchen — auch kein Officer:

| Variable | Wirkung |
|---|---|
| `ADMIN_DISCORD_ROLE_ID` | erster Admin, solange in der UI keine Rollen hinterlegt sind |
| `OFFICER_ROLE_IDS` | ohne sie sind `/dkp award` und `/dkp spend` gesperrt |
| `WEB_URL` | CORS-Origin der API. Fehlt sie, erlaubt die API nur `localhost:3000` und der Browser blockiert jede Anfrage von der echten Domain |
| `JWT_SECRET` | **bei einem Neuaufbau aufbewahren.** Ein neuer Wert macht jeden ausgegebenen Token ungültig; der Desktop-Agent antwortet dann mit `401 Nicht authentifiziert` und muss sich neu anmelden |
| `TOKEN_ENCRYPTION_KEY` | ohne ihn liegen die Battle.net-Tokens im Klartext in der Datenbank |

`NEXT_PUBLIC_API_URL` wird beim **Build** in das Browser-Bundle gebacken.
Nachträglich geändert braucht es einen neuen Build, kein PM2-Restart genügt.

## Betrieb

```bash
pct exec 202 -- pm2 status
pct exec 202 -- pm2 logs lw-api --lines 100
pct exec 202 -- curl -s http://127.0.0.1:3001/api/v1/health
```

`health` nennt auch, welcher Cache greift (`redis` oder `memory`).

### Update einspielen

```bash
pct exec 202 -- bash /opt/lunawolves/deploy/lxc/setup.sh all
```

Holt den aktuellen `main`, baut neu, migriert und lädt PM2 neu.

### Einzelne Dienste

```bash
pct exec 202 -- bash /opt/lunawolves/deploy/lxc/setup.sh api
pct exec 202 -- pm2 restart lw-web
```

### Backup

```bash
vzdump 202 <DB_CTID> --storage local --compress zstd --mode snapshot
```

Die Datenbank zusätzlich logisch sichern, das ist beim Zurückspielen
flexibler:

```bash
pct exec <DB_CTID> -- su - postgres -c "pg_dump -Fc lunawolves" > lunawolves.dump
```

## Fehlersuche

| Symptom | Ursache |
|---|---|
| `401 Nicht authentifiziert` im Agent | Token passt nicht zum `JWT_SECRET` des Servers (neu aufgesetzt oder nach 7 Tagen abgelaufen). Im Agent abmelden und neu anmelden |
| `429 Sync-Cooldown aktiv` | greift wie vorgesehen, ein Upload pro Spieler je 60 s. Über `SYNC_COOLDOWN_MS` einstellbar, `0` schaltet ab |
| `500` mit `Failed query: ... left_guild_at` | Migrationen nicht vollständig eingespielt. `setup.sh` zählt das jetzt gegen; manuell: `psql "$DATABASE_ADMIN_URL" -c 'SELECT count(*) FROM drizzle.__drizzle_migrations'` gegen die Zahl der Einträge in `apps/api/drizzle/meta/_journal.json` |
| Web-App lädt, zeigt aber keine Daten | `WEB_URL` fehlt oder passt nicht zur Domain — CORS |
| Bot startet nicht | `LUNA_GUILD_ID` fehlt. Erst nach dem ersten Addon-Sync verfügbar |
| Next.js-Build bricht ab | zu wenig RAM. Container auf 4 GB oder mehr |
