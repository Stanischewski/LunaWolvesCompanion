#!/bin/bash
# =============================================================================
# setup.sh — Container-Provisioning für LunaWolves Companion
# =============================================================================
# Einmalig auf einem frischen Debian 12 LXC-Container ausführen.
# Installiert Node.js, pnpm, PM2, clont das Repo, baut die App und startet PM2.
#
# Verwendung (1-Liner direkt auf dem Container):
#
#   curl -fsSL https://raw.githubusercontent.com/Stanischewski/LunaWolvesCompanion/main/deploy/lxc/setup.sh | bash -s api
#   curl -fsSL https://raw.githubusercontent.com/Stanischewski/LunaWolvesCompanion/main/deploy/lxc/setup.sh | bash -s bot
#   curl -fsSL https://raw.githubusercontent.com/Stanischewski/LunaWolvesCompanion/main/deploy/lxc/setup.sh | bash -s web
#
# Voraussetzungen:
#   - Debian 12 (Bookworm)
#   - curl ist installiert
#   - .env nach dem Setup manuell nach /opt/lunawolves/apps/<app>/.env kopieren
# =============================================================================

set -euo pipefail

# --- Konfiguration -----------------------------------------------------------

GITHUB_REPO="https://github.com/Stanischewski/LunaWolvesCompanion.git"
REPO_DIR="/opt/lunawolves"
NODE_VERSION="22"
BRANCH="main"

# --- Argumente ---------------------------------------------------------------

APP="${1:-}"

if [[ -z "$APP" ]]; then
  echo "Fehler: Kein App-Name angegeben."
  echo "Verwendung: bash setup.sh {api|bot|web}"
  exit 1
fi

case "$APP" in
  api|bot|web) ;;
  *)
    echo "Fehler: Unbekannte App '$APP'. Erlaubt: api | bot | web"
    exit 1
    ;;
esac

# --- Hilfsfunktionen ---------------------------------------------------------

GREEN="\033[0;32m"
YELLOW="\033[1;33m"
NC="\033[0m"

step() { echo -e "\n${GREEN}==>${NC} $*"; }
warn() { echo -e "${YELLOW}[!]${NC} $*"; }

# --- Schritt 1: System-Pakete ------------------------------------------------

step "System aktualisieren und Basis-Pakete installieren ..."
apt-get update -qq
apt-get install -y -qq curl git build-essential

# --- Schritt 2: Node.js via NodeSource ---------------------------------------

step "Node.js $NODE_VERSION installieren ..."
if ! node --version 2>/dev/null | grep -q "^v${NODE_VERSION}"; then
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_VERSION}.x" | bash -
  apt-get install -y -qq nodejs
fi

echo "Node.js: $(node --version)"
echo "npm:     $(npm --version)"

# --- Schritt 3: pnpm via corepack --------------------------------------------

step "pnpm aktivieren ..."
corepack enable
corepack prepare pnpm@latest --activate
echo "pnpm:    $(pnpm --version)"

# --- Schritt 4: PM2 global ---------------------------------------------------

step "PM2 global installieren ..."
npm install -g pm2 --silent

# --- Schritt 5: Repository clonen --------------------------------------------

step "Repository nach $REPO_DIR clonen ..."

if [[ -d "$REPO_DIR/.git" ]]; then
  warn "Repo existiert bereits — führe git pull aus statt clone."
  git -C "$REPO_DIR" fetch origin "$BRANCH"
  git -C "$REPO_DIR" reset --hard "origin/$BRANCH"
else
  git clone --branch "$BRANCH" "$GITHUB_REPO" "$REPO_DIR"
fi

# --- Schritt 6: Dependencies & Build -----------------------------------------

step "Monorepo-Dependencies installieren ..."
cd "$REPO_DIR"
pnpm install --frozen-lockfile

step "App '$APP' und Workspace-Pakete bauen ..."
# ...@guild/$APP baut die App und alle ihre lokalen workspace:* Abhängigkeiten
pnpm --filter "@guild/${APP}..." run build

# --- Schritt 7: .env prüfen --------------------------------------------------

APP_DIR="$REPO_DIR/apps/$APP"

if [[ ! -f "$APP_DIR/.env" ]]; then
  warn ".env fehlt in $APP_DIR!"
  warn "Vorlage kopieren und anpassen:"
  warn "  cp $APP_DIR/.env.example $APP_DIR/.env"
  warn "  nano $APP_DIR/.env"
  warn ""
  warn "Danach PM2 starten mit:"
  warn "  pm2 start $APP_DIR/ecosystem.config.cjs && pm2 save"
  warn "  pm2 startup systemd -u root --hp /root | tail -1 | bash"
  echo ""
  echo "Setup abgeschlossen — PM2 wird erst nach manuellem .env-Setup gestartet."
  exit 0
fi

# --- Schritt 7.5: DB-Migrationen (nur API) ----------------------------------
# Nur die API besitzt das Schema. drizzle-kit migrate ist idempotent und wendet
# nur noch nicht eingespielte Migrationen an (Tracking via drizzle.__drizzle_migrations).
# Voraussetzung: einmaliger Baseline-Schritt auf einer manuell migrierten DB
# (siehe deploy/lxc/baseline_migrations.sql), sonst versucht migrate alles ab 0000.
if [[ "$APP" == "api" ]]; then
  step "Datenbank-Migrationen anwenden ..."
  ( cd "$APP_DIR" && pnpm db:migrate )
fi

# --- Schritt 8: PM2 starten & autostart einrichten --------------------------

step "PM2 starten/neu laden ..."
# startOrReload statt start: bei bereits laufender App ist `pm2 start` ein No-Op
# und übernimmt den frisch gebauten Code NICHT — startOrReload lädt ihn zuverlässig neu.
pm2 startOrReload "$APP_DIR/ecosystem.config.cjs" --update-env

step "PM2 Autostart beim Systemstart einrichten ..."
pm2 save
pm2 startup systemd -u root --hp /root | tail -1 | bash

step "PM2 Status:"
pm2 status

# --- Fertig ------------------------------------------------------------------

echo ""
echo -e "${GREEN}✓ Setup für '$APP' abgeschlossen.${NC}"
echo "  Repo:     $REPO_DIR"
echo "  App:      $APP_DIR"
echo "  PM2:      pm2 status"
echo "  Logs:     pm2 logs lw-${APP}"
echo "  Update:   bash $REPO_DIR/deploy/lxc/setup.sh $APP"
