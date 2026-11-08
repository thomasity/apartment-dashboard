import express from 'express';
import http from 'http';
import path from 'path';
import { Server } from 'socket.io';
import cors from 'cors';
import * as circadian from './services/circadian';
import * as controller from './services/controller';
import * as roomsSvc from './services/rooms';
import * as rulesSvc from './services/rules';
import * as presenceSvc from './services/presence';
import * as suggestions from './services/suggestions';
import * as patterns from './services/patterns';
import { isMigrated, migrateLighting } from './services/migrate';
import * as spotifyPlayer from './services/spotifyPlayer';
import * as connectivity from './services/connectivity';
import { MOCK } from './dev/mock';
import { createMockRouter } from './dev/mockRoutes';
import weatherRouter from './routes/weather';
import lightingRouter from './routes/lighting';
import spotifyRouter from './routes/spotify';
import bluetoothRouter from './routes/bluetooth';
import tvRouter from './routes/tv';
import voiceRouter from './routes/voice';
import connectivityRouter from './routes/connectivity';
import patternsRouter from './routes/patterns';
import type { MqttManager } from './mqtt/client';
import type { AppServer } from './types';
import { SERVER_DIR } from './paths';

// Builds the Express app, socket.io server and service wiring without listening or
// connecting to MQTT — index.ts does those, and tests pass in a manager with a fake client.
export function createApp(mqttManager: MqttManager) {
  const app = express();
  const server = http.createServer(app);
  const io: AppServer = new Server(server, {
    cors: { origin: '*' },
  });

  app.use(cors());
  app.use(express.json());

  // Mock mode replaces the external services; lighting stays real (on a fake Zigbee bridge).
  const mock = MOCK ? createMockRouter(io) : null;
  if (mock) app.use('/api', mock.router);

  app.use('/api/weather',   weatherRouter);
  app.use('/api/lighting',  lightingRouter(io, mqttManager));
  app.use('/api/spotify',   spotifyRouter);
  app.use('/api/bluetooth', bluetoothRouter);
  app.use('/api/tv',        tvRouter);
  app.use('/api/voice',     voiceRouter);
  app.use('/api/connectivity', connectivityRouter);
  app.use('/api/patterns',  patternsRouter);

  if (process.env.NODE_ENV === 'production') {
    const clientBuild = path.join(SERVER_DIR, '../client/dist');
    app.use(express.static(clientBuild));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(clientBuild, 'index.html'));
    });
  }

  io.on('connection', (socket) => {
    socket.emit('lighting:state', mqttManager.getState());
    socket.emit('lighting:devices', mqttManager.getDevicesState());
    socket.emit('lighting:circadian', circadian.getState());
    socket.emit('lighting:rooms', roomsSvc.get());
    socket.emit('lighting:zones', controller.getZonesState());
    if (isMigrated()) socket.emit('lighting:suggestion', suggestions.current());
    if (mock) {
      socket.emit('spotify:state', mock.spotifySnapshot());
      socket.emit('connectivity', { online: true });
    } else {
      const online = connectivity.lastKnown();
      if (online !== null) socket.emit('connectivity', { online });
    }
  });

  if (!mock) {
    connectivity.events.on('change', (online) => {
      io.emit('connectivity', { online });
    });
    spotifyPlayer.attach(io);
  }

  mqttManager.on('stateChange', (state) => {
    io.emit('lighting:state', state);
  });

  mqttManager.on('devicesChange', (state) => {
    io.emit('lighting:devices', state);
  });

  mqttManager.on('bridgeEvent', (event) => {
    io.emit('lighting:bridge_event', event);
  });

  controller.init(mqttManager, io);
  presenceSvc.init(mqttManager);

  // A rule start goes to the controller. An instant "off" (no window to carry a presence
  // setting) also starts presence's cooldown, so bedtime-style rules aren't undone by the
  // next movement; an instant "on" clears it.
  function runRule(rule: Parameters<typeof controller.ruleStart>[0]): void {
    controller.ruleStart(rule);
    if (rule.action.type === 'power' && !rule.end) {
      controller.zonesForTarget(rule.action.group)
        .forEach((zone) => presenceSvc.recordManualPower(zone, !!rule.action.on));
    }
    console.log(`[rules] fired: "${rule.name}"`);
  }

  // The scheduler waits for the id migration, which waits for the bridge's device list —
  // until then rules would be read in the old name-keyed shape.
  let rulesStarted = false;
  const startWhenMigrated = (): void => {
    if (!isMigrated() && migrateLighting(mqttManager.devices)) {
      io.emit('lighting:rooms', roomsSvc.get());
    }
    if (isMigrated() && !rulesStarted) {
      rulesStarted = true;
      rulesSvc.init(runRule, () => controller.reconcile());
      controller.reconcile();
      suggestions.init(io);
      patterns.init();
    }
  };
  mqttManager.on('devicesChange', startWhenMigrated);
  startWhenMigrated();

  return { app, server, io };
}
