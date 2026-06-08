#!/usr/bin/env bash
# Installs Node.js (LTS) and essential system packages.
set -euo pipefail

GREEN='\033[0;32m'; NC='\033[0m'
log() { echo -e "${GREEN}[deps]${NC} $1"; }

log "Updating package lists..."
apt-get update -qq

log "Installing system packages..."
apt-get install -y -qq curl git build-essential

if command -v node &>/dev/null; then
    log "Node.js $(node -v) already installed, skipping."
else
    log "Installing Node.js LTS via NodeSource..."
    curl -fsSL https://deb.nodesource.com/setup_lts.x | bash -
    apt-get install -y nodejs
    log "Node.js $(node -v) installed."
fi
