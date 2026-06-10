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

    log "Installing pnpm..."
    npm install -g pnpm

    log "Installing npm dependencies..."
    sudo -u "$PI_USER" bash -c "cd '$Z2M_DIR' && pnpm install"
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
Type=simple
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

BACKUP_FILE="$PROJECT_DIR/backups/coordinator_backup.json"
if [[ -f "$BACKUP_FILE" && ! -f "$Z2M_DIR/data/coordinator_backup.json" ]]; then
    log "Restoring coordinator backup..."
    mkdir -p "$Z2M_DIR/data"
    cp "$BACKUP_FILE" "$Z2M_DIR/data/coordinator_backup.json"
    chown "$PI_USER":"$PI_USER" "$Z2M_DIR/data/coordinator_backup.json"
fi

CONFIG_FILE="$Z2M_DIR/data/configuration.yaml"
if [[ -f "$CONFIG_FILE" ]]; then
    log "zigbee2mqtt configuration already exists, skipping."
else
    log "Writing zigbee2mqtt configuration..."
    mkdir -p "$Z2M_DIR/data"
    cat > "$CONFIG_FILE" <<'EOF'
homeassistant:
  enabled: false
mqtt:
  base_topic: zigbee2mqtt
  server: mqtt://localhost:1883
serial:
  port: /dev/ttyUSB0
  adapter: ember
frontend:
  enabled: false
version: 4
devices:
  '0xb4e8428f4ad10000':
    friendly_name: Hello, World
  '0x7cb94c67ffcc0000':
    friendly_name: '0x7cb94c67ffcc0000'
EOF
    chown -R "$PI_USER":"$PI_USER" "$Z2M_DIR/data"
    log "Configuration written to $CONFIG_FILE"
fi
