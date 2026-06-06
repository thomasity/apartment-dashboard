const mqtt = require('mqtt');
const EventEmitter = require('events');

// Zigbee2MQTT uses mireds: lower = cooler (higher Kelvin)
const MIRED_COOL = 153; // ~6500K
const MIRED_WARM = 454; // ~2200K

const GROUPS = {
  living_room_main: { label: 'Main Lights', brightness: 70, colorTemp: 30 },
  living_room_accent: { label: 'Accent Lights', brightness: 50, colorTemp: 30 },
};

// colorTemp: 0–100, where 0 = warmest (🔥 2200K) and 100 = coolest (❄️ 6500K)
// Matches the slider gradient: amber on left (0) → blue on right (100)
function miredsToPercent(mireds) {
  return Math.round(((MIRED_WARM - mireds) / (MIRED_WARM - MIRED_COOL)) * 100);
}

function percentToMireds(percent) {
  return Math.round(MIRED_WARM - (percent / 100) * (MIRED_WARM - MIRED_COOL));
}

class MqttManager extends EventEmitter {
  constructor() {
    super();
    this.connected = false;
    this.client = null;
    this.groups = Object.fromEntries(
      Object.entries(GROUPS).map(([key, cfg]) => [key, { ...cfg }])
    );
    this.bridgeOnline = false;
    this.devices = [];
    this.pairing = false;
  }

  connect() {
    const brokerUrl = process.env.MQTT_BROKER_URL || 'mqtt://localhost:1883';
    console.log(`Connecting to MQTT at ${brokerUrl}...`);

    this.client = mqtt.connect(brokerUrl, {
      connectTimeout: 5000,
      reconnectPeriod: 30000,
    });

    this.client.on('connect', () => {
      console.log('MQTT connected');
      this.connected = true;
      Object.keys(GROUPS).forEach((group) => {
        this.client.subscribe(`zigbee2mqtt/${group}`, (err) => {
          if (!err) console.log(`  subscribed: zigbee2mqtt/${group}`);
        });
      });
      this.client.subscribe('zigbee2mqtt/bridge/state');
      this.client.subscribe('zigbee2mqtt/bridge/devices');
      this.client.subscribe('zigbee2mqtt/bridge/response/permit_join');
      this.emit('stateChange', this.getState());
    });

    this.client.on('message', (topic, payload) => {
      try {
        if (topic === 'zigbee2mqtt/bridge/state') {
          const raw = payload.toString();
          let state;
          try { state = JSON.parse(raw).state; } catch { state = raw; }
          this.bridgeOnline = state === 'online';
          this.emit('devicesChange', this.getDevicesState());
          return;
        }

        if (topic === 'zigbee2mqtt/bridge/devices') {
          this.devices = JSON.parse(payload.toString());
          this.emit('devicesChange', this.getDevicesState());
          return;
        }

        if (topic === 'zigbee2mqtt/bridge/response/permit_join') {
          const resp = JSON.parse(payload.toString());
          this.pairing = resp.data?.value ?? false;
          this.emit('devicesChange', this.getDevicesState());
          return;
        }

        const data = JSON.parse(payload.toString());
        const group = topic.split('/')[1];
        if (!this.groups[group]) return;

        if (data.brightness !== undefined) {
          this.groups[group].brightness = Math.round((data.brightness / 254) * 100);
        }
        if (data.color_temp !== undefined) {
          this.groups[group].colorTemp = miredsToPercent(data.color_temp);
        }
        this.emit('stateChange', this.getState());
      } catch (err) {
        console.warn('MQTT message parse error:', err.message);
      }
    });

    this.client.on('error', (err) => {
      console.warn('MQTT unavailable — lighting controls will use local state:', err.message);
      this.connected = false;
      this.emit('stateChange', this.getState());
    });

    this.client.on('offline', () => {
      if (this.connected) {
        console.warn('MQTT went offline');
        this.connected = false;
        this.emit('stateChange', this.getState());
      }
    });
  }

  setGroup(group, { brightness, colorTemp }) {
    if (!this.groups[group]) return;

    if (brightness !== undefined) this.groups[group].brightness = brightness;
    if (colorTemp !== undefined) this.groups[group].colorTemp = colorTemp;

    if (this.connected && this.client) {
      const payload = {};
      if (brightness !== undefined) payload.brightness = Math.round((brightness / 100) * 254);
      if (colorTemp !== undefined) payload.color_temp = percentToMireds(colorTemp);
      this.client.publish(`zigbee2mqtt/${group}/set`, JSON.stringify(payload), { qos: 1 });
    }

    this.emit('stateChange', this.getState());
  }

  permitJoin(enable) {
    if (!this.client) return;
    this.pairing = enable;
    this.client.publish(
      'zigbee2mqtt/bridge/request/permit_join',
      JSON.stringify({ value: enable, time: 254 }),
      { qos: 1 }
    );
    this.emit('devicesChange', this.getDevicesState());
  }

  getState() {
    return { connected: this.connected, groups: this.groups };
  }

  getDevicesState() {
    return { bridgeOnline: this.bridgeOnline, devices: this.devices, pairing: this.pairing };
  }
}

const manager = new MqttManager();
manager.connect();
module.exports = manager;
