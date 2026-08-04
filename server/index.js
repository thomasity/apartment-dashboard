require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const mqttManager = require('./mqtt/client');
const circadian   = require('./services/circadian');
const roomsSvc    = require('./services/rooms');
const overrideSvc = require('./services/override');
const rulesSvc    = require('./services/rules');
const presenceSvc = require('./services/presence');

const IS_DEV = process.env.PROD === 'false';

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
});

app.use(cors());
app.use(express.json());

if (IS_DEV) {
  console.log('[dev] PROD=false — serving mock data');
  app.use('/api', require('./dev/mockRoutes'));
}

app.use('/api/weather',  require('./routes/weather'));
app.use('/api/lighting', require('./routes/lighting')(io, mqttManager));
app.use('/api/spotify',   require('./routes/spotify'));
app.use('/api/bluetooth', require('./routes/bluetooth'));
app.use('/api/tv',        require('./routes/tv'));
app.use('/api/voice',     require('./routes/voice'));
app.use('/api/plants',    require('./routes/plants'));

if (process.env.NODE_ENV === 'production') {
  const clientBuild = path.join(__dirname, '../client/dist');
  app.use(express.static(clientBuild));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(clientBuild, 'index.html'));
  });
}

io.on('connection', (socket) => {
  if (IS_DEV) {
    const { lightingState, devicesState, circadianState } = require('./dev/mockData');
    socket.emit('lighting:state', lightingState);
    socket.emit('lighting:devices', devicesState);
    socket.emit('lighting:circadian', circadianState);
  } else {
    socket.emit('lighting:state', mqttManager.getState());
    socket.emit('lighting:devices', mqttManager.getDevicesState());
    socket.emit('lighting:circadian', circadian.getState());
    socket.emit('lighting:rooms', roomsSvc.get());
    socket.emit('lighting:override', overrideSvc.getState());
  }
});

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

rulesSvc.init((rule) => {
  const { action } = rule;
  const groups = action.group === 'all'
    ? Object.keys(mqttManager.groups)
    : roomsSvc.getDevices(action.group).length > 0
      ? roomsSvc.getDevices(action.group)
      : mqttManager.groups[action.group] ? [action.group] : [];

  if (action.type === 'power') {
    if (!action.on) {
      groups.forEach((g) => mqttManager.setPower(g, false));
    } else {
      groups.forEach((g) => mqttManager.setPower(g, true));
      if (action.config === 'scene') {
        groups.forEach((g) => {
          circadian.disable(g);
          mqttManager.setGroup(g, { brightness: action.brightness, colorTemp: action.colorTemp });
        });
      } else if (action.config === 'auto') {
        circadian.enable(action.group);
      }
    }
  } else if (action.type === 'reconfigure') {
    if (action.config === 'scene') {
      groups.forEach((g) => {
        circadian.disable(g);
        mqttManager.setGroup(g, { brightness: action.brightness, colorTemp: action.colorTemp });
      });
    } else if (action.config === 'auto') {
      circadian.enable(action.group);
    }
  }
  console.log(`[rules] fired: "${rule.name}"`);
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Dashboard server running on http://localhost:${PORT}`);
});
