#!/usr/bin/env bash
# Installs raspotify (Spotify Connect daemon) and configures it.
set -euo pipefail

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
log()  { echo -e "${GREEN}[raspotify]${NC} $1"; }
warn() { echo -e "${YELLOW}[raspotify]${NC} $1"; }

if systemctl is-active --quiet raspotify; then
    log "Raspotify already running, skipping install."
    exit 0
fi

if dpkg -s raspotify &>/dev/null; then
    log "Raspotify already installed, skipping."
else
    log "Installing raspotify..."
    apt-get install -y -qq curl
    curl -sL https://dtcooper.github.io/raspotify/install.sh | sh
    log "Raspotify installed."
fi

CONF_FILE="/etc/raspotify/conf"

if grep -q "DEVICE_NAME" "$CONF_FILE" 2>/dev/null; then
    log "Raspotify config already customised, skipping."
else
    log "Configuring raspotify..."
    cat >> "$CONF_FILE" <<'EOF'

# Apartment hub settings
DEVICE_NAME="Apartment Hub"
BITRATE="320"
EOF
fi

systemctl enable raspotify
systemctl start raspotify
log "Raspotify enabled and started as 'Apartment Hub' on Spotify Connect."
warn "Sign in via the Spotify app on any device and select 'Apartment Hub' as the output."
