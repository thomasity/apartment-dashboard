#!/usr/bin/env bash
# Main setup — runs all installers in order.
# Usage: sudo bash scripts/setup.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
log()  { echo -e "${GREEN}[setup]${NC} $1"; }
err()  { echo -e "${RED}[error]${NC} $1"; exit 1; }

[[ $EUID -ne 0 ]] && err "Run as root: sudo bash scripts/setup.sh"

log "Starting apartment dashboard setup..."

bash "$SCRIPT_DIR/install-deps.sh"
bash "$SCRIPT_DIR/install-mosquitto.sh"
bash "$SCRIPT_DIR/install-zigbee2mqtt.sh"
bash "$SCRIPT_DIR/install-raspotify.sh"
bash "$SCRIPT_DIR/install-dashboard.sh"

log "All done. Reboot recommended to ensure all services start cleanly."
