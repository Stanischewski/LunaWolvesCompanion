#!/bin/bash
# =============================================================================
# EINEN App-Container auf dem Proxmox-Host anlegen
# =============================================================================
# API, Bot und Web laufen gemeinsam darin, verwaltet von PM2. Die Datenbank
# liegt ausserhalb, in einem eigenen Container (siehe 02-create-database.sh).
#
# Auf dem PVE-Host ausfuehren:
#   CTID=202 IP=10.10.10.202/24 GW=10.10.10.1 bash 01-create-container.sh
#
# Groesse: Node baut drei Apps, das braucht kurzzeitig Speicher. 4 GB RAM und
# 16 GB Platte sind komfortabel; mit 2 GB kann der Next.js-Build scheitern.
# =============================================================================

set -euo pipefail

CTID="${CTID:-202}"
HOSTNAME_="${HOSTNAME_:-lw-app}"
IP="${IP:-}"
GW="${GW:-}"
BRIDGE="${BRIDGE:-vmbr1}"
STORAGE="${STORAGE:-local-lvm}"
TEMPLATE="${TEMPLATE:-local:vztmpl/debian-12-standard_12.7-1_amd64.tar.zst}"
CORES="${CORES:-2}"
MEMORY="${MEMORY:-4096}"
SWAP="${SWAP:-1024}"
DISK="${DISK:-16}"

RED="\033[0;31m"; GREEN="\033[0;32m"; NC="\033[0m"
die() { echo -e "${RED}[Fehler]${NC} $*" >&2; exit 1; }

command -v pct >/dev/null || die "pct nicht gefunden — das Skript gehoert auf den Proxmox-Host."
[[ -n "$IP" ]] || die "IP ist nicht gesetzt. Beispiel: IP=10.10.10.202/24"
[[ -n "$GW" ]] || die "GW ist nicht gesetzt. Beispiel: GW=10.10.10.1"
pct status "$CTID" &>/dev/null && die "CT $CTID existiert bereits. Anderen CTID waehlen oder zuerst entfernen."

echo "Container $CTID ($HOSTNAME_) anlegen:"
echo "  IP      $IP   Gateway $GW   Bridge $BRIDGE"
echo "  CPU     $CORES Kerne, RAM ${MEMORY}MB (+${SWAP}MB Swap), Platte ${DISK}GB"
echo "  Storage $STORAGE"
echo "  Vorlage $TEMPLATE"
echo ""
read -rp "Fortfahren? [j/N] " ok
[[ "$ok" == "j" || "$ok" == "J" ]] || die "Abgebrochen."

pct create "$CTID" "$TEMPLATE" \
  --hostname "$HOSTNAME_" \
  --cores "$CORES" \
  --memory "$MEMORY" \
  --swap "$SWAP" \
  --rootfs "${STORAGE}:${DISK}" \
  --net0 "name=eth0,bridge=${BRIDGE},ip=${IP},gw=${GW}" \
  --features nesting=1 \
  --onboot 1 \
  --unprivileged 1

pct start "$CTID"

echo ""
echo -e "${GREEN}CT $CTID laeuft.${NC} Naechste Schritte:"
echo ""
echo "  1. Datenbank im bestehenden DB-Container anlegen:"
echo "       APP_HOST=${IP%%/*} bash 02-create-database.sh"
echo ""
echo "  2. App-Container provisionieren:"
echo "       pct exec $CTID -- bash -c \"curl -fsSL https://raw.githubusercontent.com/Stanischewski/LunaWolvesCompanion/main/deploy/lxc/setup.sh | bash -s all\""
echo ""
echo "  3. Konfiguration eintragen (eine Datei fuer alle drei Dienste):"
echo "       pct exec $CTID -- nano /opt/lunawolves/.env"
echo ""
echo "  4. Setup erneut starten — baut und startet jetzt PM2:"
echo "       pct exec $CTID -- bash /opt/lunawolves/deploy/lxc/setup.sh all"
