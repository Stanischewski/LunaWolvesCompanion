#!/bin/bash
# ============================================================
# CT 200 — lw-db: PostgreSQL 16 Setup
# ============================================================
# Ausführen auf dem Proxmox-Host:
#   pct start 200
#   pct push 200 02-setup-db.sh /root/setup.sh
#   pct exec 200 -- bash /root/setup.sh
# ============================================================

set -e

echo "=== CT 200: PostgreSQL 16 Setup ==="

# System aktualisieren
apt update && apt upgrade -y

# PostgreSQL 16 installieren (Debian 12 hat PG15, wir brauchen 16)
apt install -y curl ca-certificates gnupg lsb-release

# PostgreSQL APT Repository hinzufügen
curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc | \
    gpg --dearmor -o /usr/share/keyrings/postgresql-keyring.gpg

echo "deb [signed-by=/usr/share/keyrings/postgresql-keyring.gpg] \
http://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" \
    > /etc/apt/sources.list.d/pgdg.list

apt update
apt install -y postgresql-16

# PostgreSQL für Netzwerkzugriff konfigurieren
PG_CONF="/etc/postgresql/16/main/postgresql.conf"
PG_HBA="/etc/postgresql/16/main/pg_hba.conf"

# Auf allen internen Interfaces lauschen
sed -i "s/#listen_addresses = 'localhost'/listen_addresses = '10.10.10.200, 127.0.0.1'/" "$PG_CONF"

# Performance-Tuning für 2GB RAM Container
cat >> "$PG_CONF" <<'EOF'

# --- Luna Wolves Tuning ---
shared_buffers = 512MB
effective_cache_size = 1536MB
maintenance_work_mem = 128MB
work_mem = 4MB
wal_buffers = 16MB
max_connections = 50
EOF

# Zugriff vom internen Netz erlauben (nur 10.10.10.0/24)
cat >> "$PG_HBA" <<'EOF'

# Luna Wolves — internes Netz
host    lunawolves      lw_app          10.10.10.0/24           scram-sha-256
host    lunawolves      lw_admin        10.10.10.0/24           scram-sha-256
EOF

# PostgreSQL neu starten
systemctl restart postgresql

# Datenbank und User erstellen
LW_APP_PASS=$(openssl rand -hex 24)
LW_ADMIN_PASS=$(openssl rand -hex 24)

# SQL-Datei vorbereiten (Variablen werden vom Shell expandiert)
cat > /tmp/init-lw.sql <<EOF
CREATE USER lw_admin WITH PASSWORD '${LW_ADMIN_PASS}' CREATEDB;
CREATE USER lw_app WITH PASSWORD '${LW_APP_PASS}';
CREATE DATABASE lunawolves OWNER lw_admin;
\c lunawolves
GRANT CONNECT ON DATABASE lunawolves TO lw_app;
ALTER DEFAULT PRIVILEGES FOR ROLE lw_admin IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO lw_app;
ALTER DEFAULT PRIVILEGES FOR ROLE lw_admin IN SCHEMA public
    GRANT USAGE, SELECT ON SEQUENCES TO lw_app;
EOF

su - postgres -c "psql -f /tmp/init-lw.sql"
rm -f /tmp/init-lw.sql

# Passwörter sichern
cat > /root/db-credentials.txt <<EOF
# ============================================================
# Luna Wolves — PostgreSQL Credentials
# DIESE DATEI SICHER AUFBEWAHREN UND DANACH LÖSCHEN!
# ============================================================
# Host:     10.10.10.200:5432
# Database: lunawolves

# Admin (Migrations, Schema-Änderungen):
DB_ADMIN_USER=lw_admin
DB_ADMIN_PASS=${LW_ADMIN_PASS}
DB_ADMIN_URL=postgresql://lw_admin:${LW_ADMIN_PASS}@10.10.10.200:5432/lunawolves

# App (API-Zugriff, eingeschränkte Rechte):
DB_APP_USER=lw_app
DB_APP_PASS=${LW_APP_PASS}
DB_APP_URL=postgresql://lw_app:${LW_APP_PASS}@10.10.10.200:5432/lunawolves
EOF

chmod 600 /root/db-credentials.txt

echo ""
echo "✓ PostgreSQL 16 installiert und konfiguriert"
echo "✓ Datenbank 'lunawolves' erstellt"
echo "✓ Credentials gespeichert in /root/db-credentials.txt"
echo ""
echo "  WICHTIG: Credentials sichern und Datei dann löschen!"
