#!/bin/bash
# ============================================================
# CT 201 — lw-cache: Redis 7 Setup
# ============================================================
# Ausführen auf dem Proxmox-Host:
#   pct start 201
#   pct push 201 03-setup-redis.sh /root/setup.sh
#   pct exec 201 -- bash /root/setup.sh
# ============================================================

set -e

echo "=== CT 201: Redis 7 Setup ==="

apt update && apt upgrade -y
apt install -y curl ca-certificates gnupg lsb-release

# Redis 7 aus dem offiziellen Repository
curl -fsSL https://packages.redis.io/gpg | \
    gpg --dearmor -o /usr/share/keyrings/redis-archive-keyring.gpg

echo "deb [signed-by=/usr/share/keyrings/redis-archive-keyring.gpg] \
https://packages.redis.io/deb $(lsb_release -cs) main" \
    > /etc/apt/sources.list.d/redis.list

apt update
apt install -y redis-server

# Redis-Passwort generieren (hex = keine Sonderzeichen)
REDIS_PASS=$(openssl rand -hex 32)

# Redis konfigurieren
REDIS_CONF="/etc/redis/redis.conf"

# Backup der Originalkonfiguration
cp "$REDIS_CONF" "${REDIS_CONF}.bak"

# Anpassungen (Pipe als sed-Delimiter, sicher bei Sonderzeichen)
sed -i "s|^bind 127.0.0.1.*|bind 10.10.10.201 127.0.0.1|" "$REDIS_CONF"
sed -i "s|^# requirepass .*|requirepass ${REDIS_PASS}|" "$REDIS_CONF"
sed -i "s|^# maxmemory .*|maxmemory 384mb|" "$REDIS_CONF"
sed -i "s|^# maxmemory-policy .*|maxmemory-policy allkeys-lru|" "$REDIS_CONF"

# Protected Mode bleibt an (Passwort ist gesetzt)
sed -i "s|^protected-mode .*|protected-mode yes|" "$REDIS_CONF"

# Persistence: AOF aktivieren für BullMQ Job-Daten
sed -i "s/^appendonly .*/appendonly yes/" "$REDIS_CONF"

systemctl restart redis-server
systemctl enable redis-server

# Test
redis-cli -a "$REDIS_PASS" ping

# Credentials sichern
cat > /root/redis-credentials.txt <<EOF
# ============================================================
# Luna Wolves — Redis Credentials
# ============================================================
# Host: 10.10.10.201:6379

REDIS_HOST=10.10.10.201
REDIS_PORT=6379
REDIS_PASSWORD=${REDIS_PASS}
REDIS_URL=redis://:${REDIS_PASS}@10.10.10.201:6379
EOF

chmod 600 /root/redis-credentials.txt

echo ""
echo "✓ Redis 7 installiert und konfiguriert"
echo "✓ Passwort gesetzt, Bind auf 10.10.10.201"
echo "✓ AOF Persistence aktiviert (für BullMQ)"
echo "✓ Max Memory: 384 MB mit LRU Eviction"
echo "✓ Credentials in /root/redis-credentials.txt"
