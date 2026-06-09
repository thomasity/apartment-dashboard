require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const mqttManager = require('./mqtt/client');
const circadian   = require('./services/circadian');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
});

app.use(cors());
app.use(express.json());

app.use('/api/weather',  require('./routes/weather'));
app.use('/api/stocks',   require('./routes/stocks'));
app.use('/api/lighting', require('./routes/lighting')(io, mqttManager));
app.use('/api/spotify',   require('./routes/spotify'));
app.use('/api/bluetooth', require('./routes/bluetooth'));

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

circadian.init(mqttManager, io);

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Dashboard server running on http://localhost:${PORT}`);
});
