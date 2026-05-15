#!/bin/bash
# ============================================================
# Luna Wolves — Guild Companion App
# Proxmox LXC Container Setup
# ============================================================
# Dieses Script auf dem Proxmox-Host als root ausführen:
#   bash 01-create-containers.sh
#
# Voraussetzungen:
#   - vmbr1 existiert bereits (10.10.10.0/24)
#   - Container IDs ab 200 sind frei
# ============================================================

set -e

# --- Konfiguration -------------------------------------------
STORAGE="local-lfs"          # ← Anpassen: dein Proxmox Storage für CT-Rootfs
TEMPLATE_STORAGE="local"     # ← Anpassen: Storage für ISO/Templates
BRIDGE="vmbr1"
GATEWAY="10.10.10.1"         # ← Anpassen: dein Gateway auf vmbr1
SSH_PUBKEY="$(cat /root/.ssh/authorized_keys 2>/dev/null | head -1)"
NAMESERVER="10.10.10.1"      # ← Anpassen: DNS-Server (OPNsense?)

# Passwörter für die Container (im Betrieb SSH-Key nutzen)
CT_PASSWORD="ChangeMeNow!"   # ← UNBEDINGT ÄNDERN

# --- Templates herunterladen ---------------------------------
echo "=== Templates herunterladen ==="
pveam update

# Prüfen ob Templates schon vorhanden sind
DEBIAN_TPL=$(pveam available --section system | grep "debian-12-standard" | tail -1 | awk '{print $2}')
UBUNTU_TPL=$(pveam available --section system | grep "ubuntu-24.04-standard" | tail -1 | awk '{print $2}')

if [ -z "$DEBIAN_TPL" ]; then
    echo "FEHLER: Kein Debian 12 Template gefunden!"
    exit 1
fi
if [ -z "$UBUNTU_TPL" ]; then
    echo "FEHLER: Kein Ubuntu 24.04 Template gefunden!"
    exit 1
fi

echo "Debian Template:  $DEBIAN_TPL"
echo "Ubuntu Template:  $UBUNTU_TPL"

# Download (überspringt wenn schon vorhanden)
pveam download "$TEMPLATE_STORAGE" "$DEBIAN_TPL" 2>/dev/null || true
pveam download "$TEMPLATE_STORAGE" "$UBUNTU_TPL" 2>/dev/null || true

# Volle Pfade für Templates
DEBIAN_PATH="${TEMPLATE_STORAGE}:vztmpl/${DEBIAN_TPL}"
UBUNTU_PATH="${TEMPLATE_STORAGE}:vztmpl/${UBUNTU_TPL}"

# --- Container-Definitionen ----------------------------------
# Format: ID|Hostname|Template|RAM(MB)|Disk(GB)|Cores|IP
CONTAINERS=(
    "200|lw-db|${DEBIAN_PATH}|2048|10|2|10.10.10.200"
    "201|lw-cache|${DEBIAN_PATH}|512|2|1|10.10.10.201"
    "202|lw-api|${UBUNTU_PATH}|1024|8|2|10.10.10.202"
    "203|lw-bot|${UBUNTU_PATH}|512|4|1|10.10.10.203"
    "204|lw-web|${UBUNTU_PATH}|1024|6|1|10.10.10.204"
    "205|lw-mon|${UBUNTU_PATH}|512|4|1|10.10.10.205"
)

# --- Container erstellen -------------------------------------
for ENTRY in "${CONTAINERS[@]}"; do
    IFS='|' read -r CTID HOSTNAME TEMPLATE RAM DISK CORES IP <<< "$ENTRY"

    echo ""
    echo "=== CT $CTID: $HOSTNAME ($IP) ==="

    # Prüfen ob CT schon existiert
    if pct status "$CTID" &>/dev/null; then
        echo "  ⚠ Container $CTID existiert bereits, überspringe..."
        continue
    fi

    pct create "$CTID" "$TEMPLATE" \
        --hostname "$HOSTNAME" \
        --storage "$STORAGE" \
        --rootfs "${STORAGE}:${DISK}" \
        --memory "$RAM" \
        --swap 256 \
        --cores "$CORES" \
        --net0 "name=eth0,bridge=${BRIDGE},ip=${IP}/24,gw=${GATEWAY}" \
        --nameserver "$NAMESERVER" \
        --password "$CT_PASSWORD" \
        --unprivileged 1 \
        --features nesting=1 \
        --onboot 1 \
        --start 0

    # SSH-Key hinzufügen falls vorhanden
    if [ -n "$SSH_PUBKEY" ]; then
        # Mounten um authorized_keys zu schreiben
        pct mount "$CTID"
        ROOTFS="/var/lib/lxc/${CTID}/rootfs"
        mkdir -p "${ROOTFS}/root/.ssh"
        echo "$SSH_PUBKEY" > "${ROOTFS}/root/.ssh/authorized_keys"
        chmod 700 "${ROOTFS}/root/.ssh"
        chmod 600 "${ROOTFS}/root/.ssh/authorized_keys"
        pct unmount "$CTID"
    fi

    echo "  ✓ Container $CTID ($HOSTNAME) erstellt"
done

# --- Zusammenfassung ------------------------------------------
echo ""
echo "============================================================"
echo " Alle Container erstellt!"
echo "============================================================"
echo ""
echo " CT 200  lw-db      PostgreSQL 16      10.10.10.200"
echo " CT 201  lw-cache   Redis 7            10.10.10.201"
echo " CT 202  lw-api     Fastify Backend    10.10.10.202"
echo " CT 203  lw-bot     Discord Bot        10.10.10.203"
echo " CT 204  lw-web     Next.js Frontend   10.10.10.204"
echo " CT 205  lw-mon     Uptime Kuma        10.10.10.205"
echo ""
echo " Nächste Schritte:"
echo "   1. Passwörter/Storage in diesem Script anpassen"
echo "   2. Container starten:  pct start 200 201 202 203 204 205"
echo "   3. Setup-Scripte in den Containern ausführen"
echo "============================================================"
