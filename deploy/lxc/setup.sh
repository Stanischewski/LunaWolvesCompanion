#!/bin/bash
# =============================================================================
# setup.sh — Provisioning und Updates fuer den App-Container
# =============================================================================
# Installiert Node.js, pnpm und PM2, holt das Repo, baut die Apps, spielt die
# Migrationen ein und startet PM2. Dient auch als Update-Weg: einfach erneut
# ausfuehren.
#
#   bash setup.sh all     API + Bot + Web in diesem Container  (Standard)
#   bash setup.sh api     nur die API
#   bash setup.sh bot     nur den Bot
#   bash setup.sh web     nur die Web-App
#
# Direkt auf einem frischen Debian 12:
#   curl -fsSL https://raw.githubusercontent.com/Stanischewski/LunaWolvesCompanion/main/deploy/lxc/setup.sh | bash -s all
#
# Konfiguration: EINE Datei, /opt/lunawolves/.env. Die .env der einzelnen Apps
# werden darauf verlinkt — BOT_SECRET und DISCORD_BOT_TOKEN werden von zwei
# Diensten gelesen und koennen so nicht auseinanderlaufen.
# =============================================================================

set -euo pipefail

GITHUB_REPO="https://github.com/Stanischewski/LunaWolvesCompanion.git"
REPO_DIR="/opt/lunawolves"
ENV_FILE="$REPO_DIR/.env"
NODE_VERSION="22"
BRANCH="${BRANCH:-main}"

APP="${1:-all}"
case "$APP" in
  all)  APPS=(api bot web) ;;
  api)  APPS=(api) ;;
  bot)  APPS=(bot) ;;
  web)  APPS=(web) ;;
  *) echo "Fehler: unbekanntes Ziel '$APP'. Erlaubt: all | api | bot | web" >&2; exit 1 ;;
esac

GREEN="\033[0;32m"; YELLOW="\033[1;33m"; NC="\033[0m"
step() { echo -e "\n${GREEN}==>${NC} $*"; }
warn() { echo -e "${YELLOW}[!]${NC} $*"; }

# --- System ------------------------------------------------------------------

step "Basis-Pakete installieren ..."
apt-get update -qq
# postgresql-client fuer psql: das Setup prueft damit die DB-Verbindung,
# bevor es die Migrationen anstoesst.
apt-get install -y -qq curl git build-essential postgresql-client

step "Node.js $NODE_VERSION ..."
if ! node --version 2>/dev/null | grep -q "^v${NODE_VERSION}"; then
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_VERSION}.x" | bash -
  apt-get install -y -qq nodejs
fi
echo "    node $(node --version), npm $(npm --version)"

step "pnpm und PM2 ..."
corepack enable
corepack prepare pnpm@latest --activate
npm install -g pm2 --silent
echo "    pnpm $(pnpm --version), pm2 $(pm2 --version 2>/dev/null | tail -1)"

# --- Repo --------------------------------------------------------------------

step "Repository nach $REPO_DIR ..."
if [[ -d "$REPO_DIR/.git" ]]; then
  git -C "$REPO_DIR" fetch origin "$BRANCH"
  git -C "$REPO_DIR" reset --hard "origin/$BRANCH"
  echo "    aktualisiert auf $(git -C "$REPO_DIR" rev-parse --short HEAD)"
else
  git clone --quiet --branch "$BRANCH" "$GITHUB_REPO" "$REPO_DIR"
  echo "    geklont auf $(git -C "$REPO_DIR" rev-parse --short HEAD)"
fi

# --- Konfiguration VOR dem Build --------------------------------------------
# Reihenfolge ist wichtig: Next.js backt NEXT_PUBLIC_*-Werte beim Build in das
# Browser-Bundle. Wird erst gebaut und dann konfiguriert, steht im Bundle
# "undefined" und die Web-App findet die API nicht.

step "Konfiguration pruefen ..."
if [[ ! -f "$ENV_FILE" ]]; then
  cp "$REPO_DIR/deploy/lxc/env.example" "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  warn "Vorlage nach $ENV_FILE kopiert — die <...>-Platzhalter muessen noch raus."
  warn ""
  warn "  nano $ENV_FILE"
  warn ""
  warn "Danach dieses Skript erneut starten; es baut dann und startet PM2:"
  warn "  bash $REPO_DIR/deploy/lxc/setup.sh $APP"
  exit 0
fi

# Platzhalter koennen mitten in der Zeile stehen, etwa
#   DATABASE_ADMIN_URL=postgresql://lw_admin:<ADMIN_PASSWORT>@<DB_HOST>:5432/...
# Darum auf der ganzen Zeile suchen, aber nur in Zuweisungen — Kommentare
# duerfen <...> enthalten.
PLACEHOLDER='^[A-Z0-9_]+=.*<[A-Z_]+>'
if grep -qE "$PLACEHOLDER" "$ENV_FILE"; then
  warn "In $ENV_FILE stehen noch Platzhalter:"
  grep -nE "$PLACEHOLDER" "$ENV_FILE" | sed 's/^/      /'
  warn "Bitte ersetzen und erneut starten."
  exit 1
fi
chmod 600 "$ENV_FILE"
echo "    $ENV_FILE sieht vollstaendig aus."

step "App-Konfigurationen auf $ENV_FILE verlinken ..."
for a in "${APPS[@]}"; do
  target="$REPO_DIR/apps/$a/.env"
  if [[ -f "$target" && ! -L "$target" ]]; then
    mv "$target" "${target}.vor-umstellung.$(date +%Y%m%d%H%M%S)"
    warn "apps/$a/.env war eine echte Datei — als .vor-umstellung.* gesichert."
  fi
  ln -sfn "$ENV_FILE" "$target"
  echo "    apps/$a/.env -> .env"
done

# --- Build -------------------------------------------------------------------

step "Dependencies installieren ..."
cd "$REPO_DIR"
pnpm install --frozen-lockfile

for a in "${APPS[@]}"; do
  step "'$a' bauen ..."
  pnpm --filter "@guild/${a}..." run build
done

# --- Migrationen -------------------------------------------------------------

if [[ " ${APPS[*]} " == *" api "* ]]; then
  step "Datenbank-Verbindung pruefen ..."
  # shellcheck disable=SC1090
  ADMIN_URL=$(grep -E '^DATABASE_ADMIN_URL=' "$ENV_FILE" | head -1 | cut -d= -f2-)
  if [[ -z "$ADMIN_URL" ]]; then
    warn "DATABASE_ADMIN_URL fehlt in $ENV_FILE — ohne sie laufen keine Migrationen."
    exit 1
  fi
  psql "$ADMIN_URL" -tAc 'SELECT 1' >/dev/null \
    || { warn "Keine Verbindung zur Datenbank. Laeuft 02-create-database.sh im DB-Container?"; exit 1; }
  echo "    Verbindung steht."

  step "Migrationen einspielen ..."
  ( cd "$REPO_DIR/apps/api" && pnpm db:migrate )

  # Gegenprobe: drizzle-kit ueberspringt Migrationen still, deren when-Wert
  # unter dem bereits verbuchten Maximum liegt. Dann fehlen Spalten und der
  # Sync bricht erst im Betrieb mit HTTP 500 ab.
  EXPECTED=$(node -e "console.log(require('$REPO_DIR/apps/api/drizzle/meta/_journal.json').entries.length)")
  ACTUAL=$(psql "$ADMIN_URL" -tAc 'SELECT count(*) FROM drizzle.__drizzle_migrations' | tr -d '[:space:]')
  echo "    Journal: $EXPECTED — verbucht: $ACTUAL"
  if [[ "$EXPECTED" != "$ACTUAL" ]]; then
    warn "Das Schema ist unvollstaendig: $ACTUAL von $EXPECTED Migrationen verbucht."
    warn "PM2 wird nicht gestartet, die API wuerde sonst mit 500 antworten."
    exit 1
  fi
fi

# --- PM2 ---------------------------------------------------------------------

ECOSYSTEM="$REPO_DIR/deploy/lxc/ecosystem.config.cjs"

# Der Bot verlangt LUNA_GUILD_ID (die UUID der Gilde aus der Datenbank).
# Die gibt es erst nach dem ersten Addon-Sync. Fehlt sie, startet der Bot
# nicht — sonst haengt er in einer Neustartschleife.
SELECTED=()
for a in "${APPS[@]}"; do
  if [[ "$a" == "bot" ]]; then
    GUILD=$(grep -E '^LUNA_GUILD_ID=' "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d '[:space:]')
    if [[ -z "$GUILD" ]]; then
      warn "LUNA_GUILD_ID ist leer — der Bot bleibt aus."
      warn "Nach dem ersten Addon-Sync auslesen:"
      warn "  psql \"\$DATABASE_URL\" -tAc 'SELECT id, name FROM guilds'"
      warn "in $ENV_FILE eintragen, dann:  pm2 start $ECOSYSTEM --only lw-bot"
      continue
    fi
  fi
  SELECTED+=("lw-$a")
done

if (( ${#SELECTED[@]} == 0 )); then
  warn "Kein Dienst zu starten."
  exit 0
fi

step "PM2 starten (${SELECTED[*]}) ..."
ONLY=$(IFS=,; echo "${SELECTED[*]}")
# startOrReload statt start: bei laufender App ist `pm2 start` ein No-Op und
# uebernimmt den frisch gebauten Code NICHT.
pm2 startOrReload "$ECOSYSTEM" --only "$ONLY" --update-env

step "Autostart einrichten ..."
pm2 save
pm2 startup systemd -u root --hp /root

pm2 status

echo ""
echo -e "${GREEN}Fertig.${NC}"
echo "  Konfiguration:  $ENV_FILE   (eine Datei fuer alle Dienste)"
echo "  Status:         pm2 status"
echo "  Logs:           pm2 logs lw-api   (bzw. lw-bot, lw-web)"
echo "  Update:         bash $REPO_DIR/deploy/lxc/setup.sh $APP"
echo "  Gesundheit:     curl -s http://127.0.0.1:3001/api/v1/health"
