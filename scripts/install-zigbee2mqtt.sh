#!/usr/bin/env bash
# Installs zigbee2mqtt and registers it as a systemd service.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/config.sh"

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
log()  { echo -e "${GREEN}[zigbee2mqtt]${NC} $1"; }
warn() { echo -e "${YELLOW}[zigbee2mqtt]${NC} $1"; }

SERVICE_FILE="/etc/systemd/system/zigbee2mqtt.service"

# Install if not present
if [[ -d "$Z2M_DIR" ]]; then
    log "zigbee2mqtt found at $Z2M_DIR, skipping install."
else
    log "Cloning zigbee2mqtt to $Z2M_DIR..."
    mkdir -p "$Z2M_DIR"
    chown -R "$PI_USER":"$PI_USER" "$Z2M_DIR"
    git clone --depth 1 https://github.com/Koenkk/zigbee2mqtt.git "$Z2M_DIR"
    chown -R "$PI_USER":"$PI_USER" "$Z2M_DIR"

    log "Installing npm dependencies..."
    sudo -u "$PI_USER" bash -c "cd '$Z2M_DIR' && npm ci"
fi

# Create systemd service if not present
if [[ -f "$SERVICE_FILE" ]]; then
    log "zigbee2mqtt service already registered, skipping."
else
    log "Creating systemd service..."
    cat > "$SERVICE_FILE" <<EOF
[Unit]
Description=zigbee2mqtt
After=network.target mosquitto.service

[Service]
Environment=NODE_ENV=production
Type=notify
ExecStart=$(which node) index.js
WorkingDirectory=$Z2M_DIR
StandardOutput=inherit
StandardError=inherit
Restart=always
RestartSec=10s
User=$PI_USER

[Install]
WantedBy=multi-user.target
EOF

    systemctl daemon-reload
    systemctl enable zigbee2mqtt
fi

if ! systemctl is-active --quiet zigbee2mqtt; then
    systemctl start zigbee2mqtt
    log "zigbee2mqtt started."
else
    log "zigbee2mqtt already running."
fi

warn "Reminder: configure $Z2M_DIR/data/configuration.yaml for your Zigbee adapter if this is a fresh install."
