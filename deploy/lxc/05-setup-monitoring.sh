#!/bin/bash
# ============================================================
# CT 205 — lw-mon: Uptime Kuma Setup
# ============================================================
# Ausführen auf dem Proxmox-Host:
#   pct start 205
#   pct push 205 05-setup-monitoring.sh /root/setup.sh
#   pct exec 205 -- bash /root/setup.sh
# ============================================================

set -e

echo "=== CT 205: Uptime Kuma Setup ==="

apt update && apt upgrade -y
apt install -y curl ca-certificates gnupg git

# Node.js 22 LTS
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs

# Uptime Kuma installieren
git clone https://github.com/louislam/uptime-kuma.git /opt/uptime-kuma
cd /opt/uptime-kuma

# Letztes stabiles Release nutzen
LATEST_TAG=$(git describe --tags --abbrev=0)
git checkout "$LATEST_TAG"

npm run setup

# Uptime Kuma User
useradd -r -s /bin/false uptimekuma || true
chown -R uptimekuma:uptimekuma /opt/uptime-kuma

# Systemd Service
cat > /etc/systemd/system/uptime-kuma.service <<'EOF'
[Unit]
Description=Uptime Kuma Monitoring
After=network.target

[Service]
Type=simple
User=uptimekuma
Group=uptimekuma
WorkingDirectory=/opt/uptime-kuma
ExecStart=/usr/bin/node server/server.js
Restart=on-failure
RestartSec=5
Environment=UPTIME_KUMA_HOST=0.0.0.0
Environment=UPTIME_KUMA_PORT=3001
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable uptime-kuma
systemctl start uptime-kuma

echo ""
echo "✓ Uptime Kuma installiert (${LATEST_TAG})"
echo "✓ Erreichbar unter: http://10.10.10.205:3001"
echo ""
echo "  Beim ersten Aufruf Admin-Account erstellen."
echo "  Dann Monitors hinzufügen für:"
echo "    - PostgreSQL: 10.10.10.200:5432 (TCP)"
echo "    - Redis:      10.10.10.201:6379 (TCP)"
echo "    - API:        10.10.10.202:3000 (HTTP)"
echo "    - Bot:        10.10.10.203:3000 (HTTP, Health-Endpoint)"
echo "    - Web:        10.10.10.204:3000 (HTTP)"
