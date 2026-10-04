# Apartment Dashboard

A fullscreen ambient dashboard for a Raspberry Pi Zero 2 W + Android tablet running Fully Kiosk Browser. Dark-themed, always-on display showing clock, weather, and living-room lighting controls.

## Widgets

- **Clock** — large always-visible time and date
- **Weather** — current conditions + 5-day forecast via [Open-Meteo](https://open-meteo.com/) (no API key)
- **Lighting** — brightness and color-temp sliders per bulb group, plus mood presets (Relax / Focus / Movie / Bright) via Zigbee2MQTT over MQTT. Gracefully degrades to local-only mode when the broker is unavailable.

## Tech Stack

- **Frontend**: React 18 + Vite + Tailwind CSS
- **Backend**: TypeScript (run directly via `tsx`) + Express + Socket.io
- **Lighting**: MQTT.js → Mosquitto → Zigbee2MQTT → Zigbee bulbs

---

## Prerequisites

- Node.js 18+
- npm 9+
- Mosquitto MQTT broker (optional — lighting works without it)

---

## Quick Start

```bash
git clone <repo-url> apartment-dashboard
cd apartment-dashboard

# Install all dependencies
npm run install:all

# Copy and fill in config
cp .env.example .env
nano .env

# Start dev servers (frontend on :5173, backend on :3001)
npm run dev
```

Open `http://localhost:5173` in your browser.

---

## Configuration (`.env`)

| Variable | Required | Description |
|---|---|---|
| `PORT` | No | Express port (default: 3001) |
| `MQTT_BROKER_URL` | No | e.g. `mqtt://localhost:1883` |

---

## Zigbee Lighting Setup

The dashboard expects Zigbee2MQTT running with two device groups published under:
- `zigbee2mqtt/living_room_main`
- `zigbee2mqtt/living_room_accent`

Edit `server/mqtt/client.js` → `GROUPS` to match your actual group/device names.

When the MQTT broker is unreachable, lighting controls still work visually (state is stored in memory on the server) and a "Local mode" badge appears on the widget.

---

## Production Build (Raspberry Pi Zero 2 W)

```bash
# On the Pi — install Node 18 LTS via nvm or nodesource
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# Clone and install (skip dev deps for the server)
git clone <repo-url> ~/dashboard
cd ~/dashboard
npm install                              # root (only concurrently)
npm --prefix client install
npm --prefix server install --omit=dev

# Build the React app
npm run build

# Run
npm start
```

The dashboard is now at `http://<pi-ip>:3001`.

### Auto-start with systemd

```ini
# /etc/systemd/system/dashboard.service
[Unit]
Description=Apartment Dashboard
After=network.target

[Service]
Type=simple
User=pi
WorkingDirectory=/home/pi/dashboard
ExecStart=/usr/bin/node server/node_modules/tsx/dist/cli.mjs server/index.ts
Environment=NODE_ENV=production
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable dashboard
sudo systemctl start dashboard
```

---

## Fully Kiosk Browser Setup (Android Tablet)

1. Install **Fully Kiosk Browser** from Google Play
2. **Start URL**: `http://<pi-ip>:3001`
3. Enable **Fullscreen** and **Keep Screen On While Plugged In**
4. Disable **Screen Saver / Daydream** in Android settings
5. (Optional) Enable **Remote Admin** in Fully Kiosk for remote management

---

## Project Structure

```
apartment-dashboard/
├── .env.example
├── package.json          # root — runs both servers via concurrently
├── server/
│   ├── index.ts          # Express + Socket.io
│   ├── types.ts          # Shared domain types (config.json, socket events, …)
│   ├── tsconfig.json     # strict; `npm --prefix server run typecheck`
│   ├── mqtt/client.ts    # MQTT manager (publishes/subscribes Zigbee state)
│   ├── services/         # circadian, rooms, override, rules, presence
│   └── routes/           # weather, lighting, spotify, tv, bluetooth, voice
└── client/
    ├── vite.config.js    # Dev proxy → :3001
    └── src/
        ├── App.jsx       # 2×2 grid layout
        └── components/
            ├── Clock.jsx
            ├── Weather.jsx
            └── Lighting.jsx
```
