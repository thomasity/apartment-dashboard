#!/usr/bin/env bash
# Interactive Bluetooth speaker pairing helper.
# Run whenever you want to pair a new speaker: sudo bash scripts/pair-bluetooth.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/config.sh"

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
log()  { echo -e "${GREEN}[pair]${NC} $1"; }
warn() { echo -e "${YELLOW}[pair]${NC} $1"; }
err()  { echo -e "${RED}[pair]${NC} $1"; exit 1; }

[[ $EUID -ne 0 ]] && err "Run as root: sudo bash scripts/pair-bluetooth.sh"

command -v bluetoothctl &>/dev/null || err "bluetoothctl not found — run install-bluetooth.sh first."

log "Powering on Bluetooth adapter..."
bluetoothctl power on

log "Scanning for devices for 15 seconds — put your speaker in pairing mode now..."
bluetoothctl scan on &
SCAN_PID=$!
sleep 15
kill $SCAN_PID 2>/dev/null || true
bluetoothctl scan off

echo ""
log "Devices found nearby:"
bluetoothctl devices | nl -w2 -s') '
echo ""

read -rp "Enter the MAC address of your speaker (e.g. AA:BB:CC:DD:EE:FF): " MAC

[[ "$MAC" =~ ^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$ ]] || err "Invalid MAC address format."

log "Pairing with $MAC..."
bluetoothctl pair "$MAC"

log "Trusting $MAC (enables auto-reconnect on reboot)..."
bluetoothctl trust "$MAC"

log "Connecting to $MAC..."
bluetoothctl connect "$MAC"

# Set as default PulseAudio sink for PI_USER
SINK="bluez_sink.${MAC//:/_}.a2dp_sink"
log "Setting as default audio sink..."
sudo -u "$PI_USER" pactl set-default-sink "$SINK" 2>/dev/null \
  || warn "Could not set default sink automatically — PulseAudio may not be running yet. Reboot and it should connect automatically."

log "Done! Your speaker is paired and trusted."
warn "On reboot, the Pi will auto-connect to $MAC. If it doesn't, run: bluetoothctl connect $MAC"
