import './env'; // must stay first — other modules read process.env at import time
import { MOCK } from './dev/mock'; // must stay second — points config at a throwaway file in mock mode

import mqttManager from './mqtt/client';
import { createApp } from './app';
import { createFakeZigbee } from './dev/fakeZigbee';

const fakeZigbee = MOCK ? createFakeZigbee() : null;
if (fakeZigbee) mqttManager.attach(fakeZigbee.client);
else mqttManager.connect();
const { server } = createApp(mqttManager);
fakeZigbee?.start();

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Dashboard server running on http://localhost:${PORT}`);
});
