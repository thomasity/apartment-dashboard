import './env'; // must stay first — other modules read process.env at import time
import { MOCK } from './dev/mock'; // must stay second — points config at a throwaway data folder in mock mode

import mqttManager from './mqtt/client';
import { createApp } from './app';
import { migrateStorage } from './services/migrate';
import * as activity from './services/activity';
import { createFakeZigbee } from './dev/fakeZigbee';

// Before anything reads settings: move a pre-split server/config.json into server/data/
if (!MOCK) migrateStorage();

const fakeZigbee = MOCK ? createFakeZigbee() : null;
if (fakeZigbee) mqttManager.attach(fakeZigbee.client);
else mqttManager.connect();
const { server } = createApp(mqttManager);
fakeZigbee?.start();

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Dashboard server running on http://localhost:${PORT}`);
});

// Write lighting-log entries still waiting to merge (up to 10s of them) before exiting.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    activity.flush();
    process.exit(0);
  });
}
