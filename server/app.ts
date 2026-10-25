import express from 'express';
import http from 'http';
import path from 'path';
import { Server } from 'socket.io';
import cors from 'cors';
import * as circadian from './services/circadian';
import * as roomsSvc from './services/rooms';
import overrideSvc from './services/override';
import * as rulesSvc from './services/rules';
import * as presenceSvc from './services/presence';
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
import type { MqttManager } from './mqtt/client';
import type { AppServer, Rule } from './types';

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

  if (process.env.NODE_ENV === 'production') {
    const clientBuild = path.join(__dirname, '../client/dist');
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
    socket.emit('lighting:override', overrideSvc.getState());
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

  overrideSvc.on('change', (state) => {
    io.emit('lighting:override', state);
  });

  overrideSvc.on('resume', (groupName) => {
    circadian.applyToGroup(groupName);
  });

  circadian.init(mqttManager, io, (g) => overrideSvc.isOverridden(g));
  presenceSvc.init(mqttManager, roomsSvc);

  // 'scene' pins a fixed brightness/colorTemp, 'auto' hands the groups to circadian,
  // 'none' leaves them as they were.
  function applyRuleConfig(action: Rule['action'], groups: string[]): void {
    if (action.config === 'scene') {
      groups.forEach((g) => {
        circadian.disable(g);
        mqttManager.setGroup(g, { brightness: action.brightness, colorTemp: action.colorTemp });
      });
    } else if (action.config === 'auto') {
      groups.forEach((g) => circadian.enable(g));
    }
  }

  rulesSvc.init((rule) => {
    const { action } = rule;
    const roomDevices = roomsSvc.getDevices(action.group);
    const groups = action.group === 'all'
      ? Object.keys(mqttManager.groups)
      : roomDevices.length > 0
        ? roomDevices
        : mqttManager.groups[action.group] ? [action.group] : [];

    if (action.type === 'power') {
      groups.forEach((g) => mqttManager.setPower(g, !!action.on));
      if (action.on) applyRuleConfig(action, groups);
    } else if (action.type === 'reconfigure') {
      applyRuleConfig(action, groups);
    }
    console.log(`[rules] fired: "${rule.name}"`);
  });

  return { app, server, io };
}
