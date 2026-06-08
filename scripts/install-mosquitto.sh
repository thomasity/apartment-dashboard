#!/usr/bin/env bash
# Installs and enables the Mosquitto MQTT broker.
set -euo pipefail

GREEN='\033[0;32m'; NC='\033[0m'
log() { echo -e "${GREEN}[mosquitto]${NC} $1"; }

if systemctl is-active --quiet mosquitto; then
    log "Mosquitto already running, skipping."
    exit 0
fi

log "Installing Mosquitto..."
apt-get install -y -qq mosquitto mosquitto-clients

systemctl enable mosquitto
systemctl start mosquitto
log "Mosquitto enabled and started."
