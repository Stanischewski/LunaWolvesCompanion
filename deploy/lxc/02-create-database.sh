#!/bin/bash
# =============================================================================
# Datenbank in einem BESTEHENDEN PostgreSQL-Container anlegen
# =============================================================================
# Fuer den Fall, dass schon ein DB-Container laeuft (evtl. mit anderen
# Datenbanken). Das Skript installiert kein PostgreSQL und aendert weder
# Tuning noch listen_addresses eigenmaechtig — es legt Rollen, Datenbank und
# Rechte an und ergaenzt pg_hba.conf nur um die eigenen Zeilen.
#
# Ausfuehren IM DB-Container (als root):
#   APP_HOST=10.10.10.202 bash 02-create-database.sh
#
# APP_HOST ist die IP des App-Containers, der sich verbinden darf.
# Mehrere/Netz auch moeglich:  APP_HOST=10.10.10.0/24
#
# Mehrfaches Ausfuehren ist unschaedlich: vorhandene Rollen und die
# Datenbank werden erkannt und uebersprungen, Passwoerter bleiben dann wie
# sie sind (das Skript kann sie nicht auslesen und setzt sie nicht neu).
# =============================================================================

set -euo pipefail

DB_NAME="${DB_NAME:-lunawolves}"
APP_HOST="${APP_HOST:-}"

GREEN="\033[0;32m"; YELLOW="\033[1;33m"; RED="\033[0;31m"; NC="\033[0m"
step() { echo -e "\n${GREEN}==>${NC} $*"; }
warn() { echo -e "${YELLOW}[!]${NC} $*"; }
die()  { echo -e "${RED}[Fehler]${NC} $*" >&2; exit 1; }

[[ -n "$APP_HOST" ]] || die "APP_HOST ist nicht gesetzt. Beispiel: APP_HOST=10.10.10.202 bash $0"
command -v psql >/dev/null || die "psql nicht gefunden — laeuft das Skript im DB-Container?"
id postgres &>/dev/null || die "Benutzer 'postgres' existiert nicht — laeuft das Skript im DB-Container?"

psql_su() { su - postgres -c "psql -v ON_ERROR_STOP=1 $*"; }

step "PostgreSQL-Version pruefen ..."
PG_FULL=$(psql_su -tAc "'SHOW server_version'" | tr -d '[:space:]')
PG_MAJOR="${PG_FULL%%.*}"
echo "    Server-Version: $PG_FULL"
if (( PG_MAJOR < 14 )); then
  die "PostgreSQL $PG_MAJOR ist zu alt. Das Schema braucht mindestens 14 (empfohlen: 16)."
fi

# --- Rollen ------------------------------------------------------------------
# lw_admin besitzt das Schema und fuehrt die Migrationen aus.
# lw_app betreibt die API und bekommt nur DML-Rechte.
step "Rollen anlegen ..."
CREATED_ADMIN=0; CREATED_APP=0
LW_ADMIN_PASS=""; LW_APP_PASS=""

if [[ "$(psql_su -tAc "\"SELECT 1 FROM pg_roles WHERE rolname='lw_admin'\"")" == "1" ]]; then
  warn "Rolle lw_admin existiert bereits — Passwort bleibt unveraendert."
else
  LW_ADMIN_PASS=$(openssl rand -hex 24)
  psql_su -c "\"CREATE ROLE lw_admin LOGIN PASSWORD '${LW_ADMIN_PASS}' CREATEDB\""
  CREATED_ADMIN=1
  echo "    lw_admin angelegt."
fi

if [[ "$(psql_su -tAc "\"SELECT 1 FROM pg_roles WHERE rolname='lw_app'\"")" == "1" ]]; then
  warn "Rolle lw_app existiert bereits — Passwort bleibt unveraendert."
else
  LW_APP_PASS=$(openssl rand -hex 24)
  psql_su -c "\"CREATE ROLE lw_app LOGIN PASSWORD '${LW_APP_PASS}'\""
  CREATED_APP=1
  echo "    lw_app angelegt."
fi

# --- Datenbank ---------------------------------------------------------------
step "Datenbank '$DB_NAME' anlegen ..."
if [[ "$(psql_su -tAc "\"SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'\"")" == "1" ]]; then
  warn "Datenbank '$DB_NAME' existiert bereits — wird nicht angefasst."
else
  psql_su -c "\"CREATE DATABASE ${DB_NAME} OWNER lw_admin\""
  echo "    '$DB_NAME' angelegt, Eigentuemer lw_admin."
fi

# --- Rechte ------------------------------------------------------------------
# Die Default Privileges greifen fuer Tabellen, die lw_admin SPAETER anlegt —
# also fuer alles, was drizzle-kit migrate erzeugt. Die GRANTs darunter decken
# zusaetzlich ab, was bei einem erneuten Lauf schon existiert.
step "Rechte fuer lw_app setzen ..."
su - postgres -c "psql -v ON_ERROR_STOP=1 -d ${DB_NAME}" <<'SQL'
GRANT CONNECT ON DATABASE lunawolves TO lw_app;
GRANT USAGE ON SCHEMA public TO lw_app;
GRANT USAGE, CREATE ON SCHEMA public TO lw_admin;

ALTER DEFAULT PRIVILEGES FOR ROLE lw_admin IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO lw_app;
ALTER DEFAULT PRIVILEGES FOR ROLE lw_admin IN SCHEMA public
    GRANT USAGE, SELECT ON SEQUENCES TO lw_app;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO lw_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO lw_app;
SQL
echo "    Default Privileges und GRANTs gesetzt."

# --- Netzzugriff -------------------------------------------------------------
step "Zugriff fuer $APP_HOST in pg_hba.conf eintragen ..."
PG_HBA=$(psql_su -tAc "'SHOW hba_file'" | tr -d '[:space:]')
echo "    pg_hba.conf: $PG_HBA"

MARKER="# Luna Wolves (${DB_NAME})"
if grep -qF "$MARKER" "$PG_HBA"; then
  warn "Eintrag existiert schon — pg_hba.conf bleibt unveraendert."
else
  cp "$PG_HBA" "${PG_HBA}.bak.$(date +%Y%m%d%H%M%S)"
  cat >> "$PG_HBA" <<EOF

${MARKER}
host    ${DB_NAME}      lw_admin        ${APP_HOST}             scram-sha-256
host    ${DB_NAME}      lw_app          ${APP_HOST}             scram-sha-256
EOF
  echo "    Zeilen ergaenzt (Sicherung: ${PG_HBA}.bak.*)."
fi

LISTEN=$(psql_su -tAc "'SHOW listen_addresses'" | tr -d '[:space:]')
echo "    listen_addresses = $LISTEN"
if [[ "$LISTEN" == "localhost" || "$LISTEN" == "127.0.0.1" ]]; then
  warn "PostgreSQL hoert nur lokal — der App-Container kommt so nicht ran."
  warn "In postgresql.conf anpassen, z.B.:  listen_addresses = '*'"
  warn "Das aendere ich nicht selbst, weil in diesem Container noch andere"
  warn "Datenbanken liegen koennen."
fi

step "Konfiguration neu laden ..."
su - postgres -c "psql -v ON_ERROR_STOP=1 -tAc 'SELECT pg_reload_conf()'" >/dev/null
echo "    pg_reload_conf() ausgefuehrt (kein Neustart, offene Verbindungen bleiben)."

# --- Ergebnis ----------------------------------------------------------------
DB_IP=$(hostname -I 2>/dev/null | awk '{print $1}')
OUT=/root/lunawolves-db.txt

if (( CREATED_ADMIN || CREATED_APP )); then
  { echo "# Luna Wolves — Zugangsdaten zur Datenbank"
    echo "# Erzeugt: $(date -Is)"
    echo "# In /opt/lunawolves/.env auf dem App-Container eintragen."
    echo
    (( CREATED_ADMIN )) && echo "DATABASE_ADMIN_URL=postgresql://lw_admin:${LW_ADMIN_PASS}@${DB_IP}:5432/${DB_NAME}"
    (( CREATED_APP ))   && echo "DATABASE_URL=postgresql://lw_app:${LW_APP_PASS}@${DB_IP}:5432/${DB_NAME}"
  } > "$OUT"
  chmod 600 "$OUT"
  echo ""
  echo -e "${GREEN}Fertig.${NC} Zugangsdaten liegen in $OUT"
  echo ""
  cat "$OUT"
  echo ""
  warn "Nach dem Uebertragen in die .env diese Datei loeschen."
else
  echo ""
  echo -e "${GREEN}Fertig.${NC} Rollen und Datenbank waren schon vorhanden."
  warn "Die bestehenden Passwoerter kann das Skript nicht auslesen."
  warn "Neu setzen bei Bedarf:"
  warn "  su - postgres -c \"psql -c \\\"ALTER ROLE lw_app PASSWORD 'neu'\\\"\""
fi

echo ""
echo "Verbindung vom App-Container aus pruefen:"
echo "  psql \"postgresql://lw_app:<PASSWORT>@${DB_IP}:5432/${DB_NAME}\" -c 'SELECT current_user, current_database()'"
