#!/usr/bin/env bash
# Installs Bluetooth audio support and configures raspotify to use it.
# Run once: sudo bash scripts/install-bluetooth.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/config.sh"

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
log()  { echo -e "${GREEN}[bluetooth]${NC} $1"; }
warn() { echo -e "${YELLOW}[bluetooth]${NC} $1"; }

[[ $EUID -ne 0 ]] && { echo "Run as root: sudo bash scripts/install-bluetooth.sh"; exit 1; }

PI_UID=$(id -u "$PI_USER")

# ── Packages ────────────────────────────────────────────────────────────────
log "Installing Bluetooth audio packages..."
apt-get update -qq
apt-get install -y -qq pulseaudio pulseaudio-module-bluetooth bluez bluez-tools

# ── Groups ──────────────────────────────────────────────────────────────────
log "Adding $PI_USER to audio and bluetooth groups..."
usermod -a -G audio,bluetooth "$PI_USER"

# ── PulseAudio: load Bluetooth modules for the user session ─────────────────
log "Configuring PulseAudio Bluetooth modules..."
PULSE_CONF_DIR="/home/$PI_USER/.config/pulse"
mkdir -p "$PULSE_CONF_DIR"
cat > "$PULSE_CONF_DIR/default.pa" <<'EOF'
.include /etc/pulse/default.pa
load-module module-bluetooth-policy
load-module module-bluetooth-discover
EOF
chown -R "$PI_USER":"$PI_USER" "$PULSE_CONF_DIR"

# ── Linger: start PulseAudio on boot without a login session ────────────────
log "Enabling linger for $PI_USER so PulseAudio starts on boot..."
loginctl enable-linger "$PI_USER"

# ── Raspotify override: run as PI_USER so it can reach PulseAudio ───────────
log "Creating raspotify systemd override to run as $PI_USER..."
OVERRIDE_DIR="/etc/systemd/system/raspotify.service.d"
mkdir -p "$OVERRIDE_DIR"
cat > "$OVERRIDE_DIR/run-as-user.conf" <<EOF
[Service]
User=$PI_USER
Environment=PULSE_RUNTIME_PATH=/run/user/${PI_UID}/pulse
EOF

# ── Bluetooth service ────────────────────────────────────────────────────────
log "Enabling Bluetooth service..."
systemctl enable bluetooth
systemctl start bluetooth

systemctl daemon-reload
systemctl restart raspotify

log "Bluetooth audio setup complete."
warn "Next step: run 'sudo bash scripts/pair-bluetooth.sh' to pair your speaker."
