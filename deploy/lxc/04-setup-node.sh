#!/bin/bash
# ============================================================
# CT 202/203/204 — Node.js Base Setup
# ============================================================
# Dieses Script installiert Node.js 22 LTS auf den
# App-Containern (lw-api, lw-bot, lw-web).
#
# Ausführen auf dem Proxmox-Host für jeden App-Container:
#   pct start 202
#   pct push 202 04-setup-node.sh /root/setup.sh
#   pct exec 202 -- bash /root/setup.sh
#
# Dann für 203 und 204 wiederholen.
# ============================================================

set -e

HOSTNAME=$(hostname)
echo "=== ${HOSTNAME}: Node.js 22 LTS Setup ==="

apt update && apt upgrade -y

# Grundlegende Tools
apt install -y curl ca-certificates gnupg git build-essential

# Node.js 22 LTS via NodeSource
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs

# pnpm installieren (aus dem Architekturplan: Monorepo mit Turborepo)
corepack enable
corepack prepare pnpm@latest --activate

# Versions-Check
echo ""
echo "--- Installierte Versionen ---"
node --version
npm --version
pnpm --version
echo "------------------------------"

# App-User erstellen (nicht als root laufen lassen)
if ! id "lw" &>/dev/null; then
    useradd -m -s /bin/bash lw
    echo "✓ User 'lw' erstellt"
fi

# App-Verzeichnis vorbereiten
mkdir -p /opt/lunawolves
chown lw:lw /opt/lunawolves

# Systemd Service Template vorbereiten
cat > /etc/systemd/system/lunawolves.service <<'EOF'
[Unit]
Description=Luna Wolves App Service
After=network.target

[Service]
Type=simple
User=lw
Group=lw
WorkingDirectory=/opt/lunawolves
EnvironmentFile=/opt/lunawolves/.env
ExecStart=/usr/bin/node dist/index.js
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=lunawolves

# Sicherheit
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=/opt/lunawolves
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF

echo ""
echo "✓ Node.js 22 LTS installiert"
echo "✓ pnpm aktiviert"
echo "✓ User 'lw' erstellt"
echo "✓ App-Verzeichnis: /opt/lunawolves"
echo "✓ Systemd Service Template: lunawolves.service"
echo ""
echo "  Nächster Schritt: Code deployen nach /opt/lunawolves"
