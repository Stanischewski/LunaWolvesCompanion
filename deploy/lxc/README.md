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

### 4. Node.js auf App-Containern (CT 202, 203, 204)

```bash
# Für jeden App-Container wiederholen:
for CT in 202 203 204; do
    pct push $CT 04-setup-node.sh /root/setup.sh
    pct exec $CT -- bash /root/setup.sh
done
```

### 5. Monitoring (CT 205)

```bash
pct push 205 05-setup-monitoring.sh /root/setup.sh
pct exec 205 -- bash /root/setup.sh
```

Dann im Browser: http://10.10.10.205:3001

### 6. Environment einrichten

```bash
# .env Template auf die App-Container kopieren
for CT in 202 203 204; do
    pct push $CT env.template /opt/lunawolves/.env
    # Dann im Container die Werte anpassen:
    pct exec $CT -- nano /opt/lunawolves/.env
done
```

## Ports (intern)

| Container | Service        | Port  |
|-----------|----------------|-------|
| CT 200    | PostgreSQL     | 5432  |
| CT 201    | Redis          | 6379  |
| CT 202    | Fastify API    | 3000  |
| CT 203    | Discord Bot    | 3000  |
| CT 204    | Next.js        | 3000  |
| CT 205    | Uptime Kuma    | 3001  |

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

# Logs eines Containers ansehen
pct exec 202 -- journalctl -u lunawolves -f

# Container neu starten
pct reboot 202
```
