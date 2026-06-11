#!/usr/bin/env bash
# Installs Bluetooth audio support for Raspberry Pi OS (PipeWire/Trixie).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/config.sh"

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
log()  { echo -e "${GREEN}[bluetooth]${NC} $1"; }
warn() { echo -e "${YELLOW}[bluetooth]${NC} $1"; }

[[ $EUID -ne 0 ]] && { echo "Run as root: sudo bash scripts/install-bluetooth.sh"; exit 1; }

# ── Packages ──────────────────────────────────────────────────────────────────
log "Installing Bluetooth audio packages..."
apt-get update -qq
apt-get install -y -qq \
  bluez bluez-tools \
  pipewire pipewire-audio pipewire-pulse pipewire-alsa \
  wireplumber \
  libspa-0.2-bluetooth

# ── Groups ────────────────────────────────────────────────────────────────────
log "Adding $PI_USER to bluetooth group..."
usermod -a -G bluetooth "$PI_USER"

# ── Bluetooth service ─────────────────────────────────────────────────────────
log "Enabling Bluetooth service..."
systemctl enable bluetooth
systemctl start bluetooth || warn "Bluetooth service did not start — a reboot may be required."

# ── Enable PipeWire user services on boot (linger) ───────────────────────────
log "Enabling linger for $PI_USER so PipeWire starts on boot without login..."
loginctl enable-linger "$PI_USER"

# ── Raspotify override: use PipeWire's PulseAudio socket ─────────────────────
log "Configuring raspotify to use PipeWire audio..."
PI_UID=$(id -u "$PI_USER")
OVERRIDE_DIR="/etc/systemd/system/raspotify.service.d"
mkdir -p "$OVERRIDE_DIR"
cat > "$OVERRIDE_DIR/pipewire.conf" <<EOF
[Unit]
After=network.target user@${PI_UID}.service

[Service]
User=$PI_USER
ProtectHome=false
Environment=XDG_RUNTIME_DIR=/run/user/${PI_UID}
Environment=LIBRESPOT_BACKEND=pulseaudio
Environment=PULSE_RUNTIME_PATH=/run/user/${PI_UID}/pulse
Environment=PULSE_SERVER=unix:/run/user/${PI_UID}/pulse/native
EOF

# ── Raspotify audio backend ───────────────────────────────────────────────────
# pipewire-alsa routes ALSA's default device through PipeWire, so librespot's
# ALSA backend automatically works without needing a pulseaudio backend.
log "Ensuring raspotify uses default ALSA backend (routed through PipeWire)..."
RASPOTIFY_CONF="/etc/raspotify/conf"
sed -i '/LIBRESPOT_BACKEND=/d' "$RASPOTIFY_CONF" 2>/dev/null || true

# ── Restart user audio stack ──────────────────────────────────────────────────
log "Restarting PipeWire audio stack for $PI_USER..."
sudo -u "$PI_USER" XDG_RUNTIME_DIR="/run/user/${PI_UID}/pulse" \
  systemctl --user restart pipewire wireplumber pipewire-pulse 2>/dev/null || \
  warn "Could not restart PipeWire — user session may not be active yet. Reboot to apply."

systemctl daemon-reload
systemctl restart raspotify || warn "raspotify failed to restart — check: journalctl -u raspotify -n 30"

log "Bluetooth setup complete. Pair speakers from the Music tab in the dashboard."
