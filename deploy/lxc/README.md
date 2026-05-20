# Luna Wolves — Proxmox LXC Setup

## Übersicht

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

## Voraussetzungen

- Proxmox VE 8.x
- vmbr1 Bridge existiert (10.10.10.0/24)
- OPNsense VM läuft als Gateway (10.10.10.1)
- IONOS VPS mit WireGuard-Tunnel zur OPNsense

## Reihenfolge

### 1. Container erstellen (auf dem PVE-Host)

```bash
# Script anpassen (Storage, Gateway, Passwort!)
nano 01-create-containers.sh

# Ausführen
bash 01-create-containers.sh

# Alle Container starten
pct start 200 && pct start 201 && pct start 202 && \
pct start 203 && pct start 204 && pct start 205
```

### 2. Datenbank einrichten (CT 200)

```bash
pct push 200 02-setup-db.sh /root/setup.sh
pct exec 200 -- bash /root/setup.sh

# Credentials auslesen und sichern
pct exec 200 -- cat /root/db-credentials.txt
```

### 3. Redis einrichten (CT 201)

```bash
pct push 201 03-setup-redis.sh /root/setup.sh
pct exec 201 -- bash /root/setup.sh

# Credentials auslesen
pct exec 201 -- cat /root/redis-credentials.txt
```

### 4. App-Container einrichten (CT 202, 203, 204)

`setup.sh` installiert Node.js, pnpm, PM2, clont das Repo und baut die App.
Wenn `.env` noch fehlt, gibt es eine Warnung — PM2 startet erst nach Schritt 5.

```bash
pct exec 202 -- bash -c "curl -fsSL https://raw.githubusercontent.com/Stanischewski/LunaWolvesCompanion/main/deploy/lxc/setup.sh | bash -s api"
pct exec 203 -- bash -c "curl -fsSL https://raw.githubusercontent.com/Stanischewski/LunaWolvesCompanion/main/deploy/lxc/setup.sh | bash -s bot"
pct exec 204 -- bash -c "curl -fsSL https://raw.githubusercontent.com/Stanischewski/LunaWolvesCompanion/main/deploy/lxc/setup.sh | bash -s web"
```

### 5. Environment konfigurieren

Die `.env.example`-Dateien als Vorlage auf die Container kopieren und anpassen:

```bash
pct push 202 apps/api/.env.example /opt/lunawolves/apps/api/.env
pct exec 202 -- nano /opt/lunawolves/apps/api/.env

pct push 203 apps/bot/.env.example /opt/lunawolves/apps/bot/.env
pct exec 203 -- nano /opt/lunawolves/apps/bot/.env

pct push 204 apps/web/.env.example /opt/lunawolves/apps/web/.env
pct exec 204 -- nano /opt/lunawolves/apps/web/.env
```

### 6. PM2 starten (falls .env beim Setup fehlte)

Falls setup.sh in Schritt 4 ohne `.env` gelaufen ist, jetzt nach dem Konfigurieren
setup.sh erneut ausführen — es erkennt das vorhandene Repo und startet PM2:

```bash
pct exec 202 -- bash /opt/lunawolves/deploy/lxc/setup.sh api
pct exec 203 -- bash /opt/lunawolves/deploy/lxc/setup.sh bot
pct exec 204 -- bash /opt/lunawolves/deploy/lxc/setup.sh web
```

### 7. Monitoring (CT 205)

```bash
pct push 205 05-setup-monitoring.sh /root/setup.sh
pct exec 205 -- bash /root/setup.sh
```

Dann im Browser: http://10.10.10.205:3001

---

## Ports (intern)

| Container | Service        | Port  |
|-----------|----------------|-------|
| CT 200    | PostgreSQL     | 5432  |
| CT 201    | Redis          | 6379  |
| CT 202    | Fastify API    | 3001  |
| CT 203    | Discord Bot    | —     |
| CT 204    | Next.js        | 3000  |
| CT 205    | Uptime Kuma    | 3001  |

## Updates einspielen

```bash
# App neu bauen und PM2 neu starten (auf dem Proxmox-Host ausführen):
pct exec 202 -- bash /opt/lunawolves/deploy/lxc/setup.sh api
pct exec 203 -- bash /opt/lunawolves/deploy/lxc/setup.sh bot
pct exec 204 -- bash /opt/lunawolves/deploy/lxc/setup.sh web
```

## Backup-Strategie

```bash
# Alle LW-Container sichern (auf dem PVE-Host)
for CT in 200 201 202 203 204 205; do
    vzdump $CT --storage local --compress zstd --mode snapshot
done
```

## Nützliche Befehle

```bash
# Status aller Container
for CT in 200 201 202 203 204 205; do
    echo "CT $CT: $(pct status $CT)"
done

# In einen Container einloggen
pct enter 202

# PM2 Status / Logs eines Containers
pct exec 202 -- pm2 status
pct exec 202 -- pm2 logs lw-api

# Container neu starten
pct reboot 202
```
