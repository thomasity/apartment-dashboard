import './env'; // must stay first — other modules read process.env at import time

import mqttManager from './mqtt/client';
import { createApp } from './app';

mqttManager.connect();
const { server } = createApp(mqttManager);

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Dashboard server running on http://localhost:${PORT}`);
});
