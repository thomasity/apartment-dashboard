#!/usr/bin/env bash
# Installs npm dependencies, builds the client, and registers the
# dashboard server as a systemd service.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/config.sh"

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
log()  { echo -e "${GREEN}[dashboard]${NC} $1"; }
warn() { echo -e "${YELLOW}[dashboard]${NC} $1"; }

SERVICE_FILE="/etc/systemd/system/apartment-dashboard.service"

# .env
if [[ -f "$PROJECT_DIR/.env" ]]; then
    log ".env already exists, skipping."
else
    cp "$PROJECT_DIR/.env.example" "$PROJECT_DIR/.env"
    chown "$PI_USER":"$PI_USER" "$PROJECT_DIR/.env"
    warn ".env created from .env.example — fill in your API keys before starting the server."
fi

# Server deps
log "Installing server dependencies..."
sudo -u "$PI_USER" bash -c "cd '$PROJECT_DIR' && npm install --prefix server"

# Client build
log "Installing client dependencies and building..."
sudo -u "$PI_USER" bash -c "cd '$PROJECT_DIR/client' && npm install && npm run build"

# Systemd service
if [[ -f "$SERVICE_FILE" ]]; then
    log "Dashboard service already registered, skipping."
else
    log "Creating systemd service..."
    cat > "$SERVICE_FILE" <<EOF
[Unit]
Description=Apartment Dashboard Server
After=network.target mosquitto.service zigbee2mqtt.service raspotify.service bluetooth.service

[Service]
Type=simple
User=$PI_USER
WorkingDirectory=$PROJECT_DIR
ExecStart=$(which node) server/index.js
Restart=on-failure
RestartSec=10s
Environment=NODE_ENV=production
EnvironmentFile=$PROJECT_DIR/.env

[Install]
WantedBy=multi-user.target
EOF

    systemctl daemon-reload
    systemctl enable apartment-dashboard
    log "Dashboard service registered and enabled."
fi

if ! systemctl is-active --quiet apartment-dashboard; then
    systemctl start apartment-dashboard
    log "Dashboard server started."
else
    log "Dashboard server already running."
fi
