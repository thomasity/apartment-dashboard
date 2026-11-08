import './env'; // must stay first — other modules read process.env at import time
import { MOCK } from './dev/mock'; // must stay second — points config at a throwaway data folder in mock mode

import mqttManager from './mqtt/client';
import { createApp } from './app';
import { migrateStorage } from './services/migrate';
import { flushAll } from './services/logs';
import * as spotifyPlayer from './services/spotifyPlayer';
import * as tvWatcher from './services/tvWatcher';
import { createFakeZigbee } from './dev/fakeZigbee';

// Before anything reads settings: move a pre-split server/config.json into server/data/
if (!MOCK) migrateStorage();

const fakeZigbee = MOCK ? createFakeZigbee() : null;
if (fakeZigbee) mqttManager.attach(fakeZigbee.client);
else mqttManager.connect();
const { server } = createApp(mqttManager);
fakeZigbee?.start();

// Watch music and the TV even with no dashboard open, for the media log. Only here (not
// in createApp) so tests and mock mode never poll Spotify or the Roku.
if (!MOCK) {
  spotifyPlayer.watchAlways();
  tvWatcher.start();
}

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Dashboard server running on http://localhost:${PORT}`);
});

// Write log entries still waiting to merge (a few seconds' to minutes' worth) before exiting.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    flushAll();
    process.exit(0);
  });
}
