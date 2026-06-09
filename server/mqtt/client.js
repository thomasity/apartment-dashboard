const mqtt = require('mqtt');
const EventEmitter = require('events');

// Zigbee2MQTT uses mireds: lower = cooler (higher Kelvin)
const MIRED_COOL = 153; // ~6500K
const MIRED_WARM = 454; // ~2200K

// colorTemp: 0–100, where 0 = warmest (🔥 2200K) and 100 = coolest (❄️ 6500K)
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
    this.groups = {};
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
      this.client.subscribe('zigbee2mqtt/bridge/state');
      this.client.subscribe('zigbee2mqtt/bridge/devices');
      this.client.subscribe('zigbee2mqtt/bridge/event');
      this.client.subscribe('zigbee2mqtt/bridge/response/permit_join');
      this.emit('stateChange', this.getState());
    });

    this.client.on('message', (topic, payload) => {
      try {
        if (topic === 'zigbee2mqtt/bridge/state') {
          const raw = payload.toString();
          console.log('[bridge/state]', raw);
          let state;
          try { state = JSON.parse(raw).state; } catch { state = raw; }
          this.bridgeOnline = state === 'online';
          this.emit('devicesChange', this.getDevicesState());
          return;
        }

        if (topic === 'zigbee2mqtt/bridge/devices') {
          this.devices = JSON.parse(payload.toString());
          this._syncDeviceSubscriptions();
          this.emit('devicesChange', this.getDevicesState());
          return;
        }

        if (topic === 'zigbee2mqtt/bridge/event') {
          this.emit('bridgeEvent', JSON.parse(payload.toString()));
          return;
        }

        if (topic === 'zigbee2mqtt/bridge/response/permit_join') {
          const resp = JSON.parse(payload.toString());
          this.pairing = resp.data?.value ?? false;
          this.emit('devicesChange', this.getDevicesState());
          return;
        }

        // Device state update — friendly name is everything after 'zigbee2mqtt/'
        const friendlyName = topic.slice('zigbee2mqtt/'.length);
        if (!this.groups[friendlyName]) return;

        const data = JSON.parse(payload.toString());
        if (data.brightness !== undefined) {
          this.groups[friendlyName].brightness = Math.round((data.brightness / 254) * 100);
        }
        if (data.color_temp !== undefined) {
          this.groups[friendlyName].colorTemp = miredsToPercent(data.color_temp);
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

  _syncDeviceSubscriptions() {
    const controllable = this.devices.filter(
      (d) => d.type !== 'Coordinator' && d.interview_completed
    );

    // Subscribe to any newly discovered devices
    controllable.forEach((d) => {
      if (!this.groups[d.friendly_name]) {
        this.groups[d.friendly_name] = { label: d.friendly_name, brightness: 70, colorTemp: 30 };
        this.client.subscribe(`zigbee2mqtt/${d.friendly_name}`, (err) => {
          if (err) return;
          console.log(`  subscribed: zigbee2mqtt/${d.friendly_name}`);
          // Ask the bulb for its current state so we don't show stale defaults
          this.client.publish(
            `zigbee2mqtt/${d.friendly_name}/get`,
            JSON.stringify({ state: '', brightness: '', color_temp: '' }),
            { qos: 0 },
          );
        });
      }
    });

    // Unsubscribe from devices that have been removed
    const activeNames = new Set(controllable.map((d) => d.friendly_name));
    Object.keys(this.groups).forEach((name) => {
      if (!activeNames.has(name)) {
        this.client.unsubscribe(`zigbee2mqtt/${name}`);
        delete this.groups[name];
      }
    });
  }

  setGroup(group, { brightness, colorTemp }) {
    if (!this.groups[group]) return;

    if (brightness !== undefined) this.groups[group].brightness = brightness;
    if (colorTemp !== undefined) this.groups[group].colorTemp = colorTemp;

    if (this.connected && this.client) {
      const payload = {};
      if (brightness !== undefined) {
        payload.brightness = Math.round((brightness / 100) * 254);
        payload.state = brightness > 0 ? 'ON' : 'OFF';
      }
      if (colorTemp !== undefined) payload.color_temp = percentToMireds(colorTemp);
      this.client.publish(`zigbee2mqtt/${group}/set`, JSON.stringify(payload), { qos: 1 });
    }

    this.emit('stateChange', this.getState());
  }

  setPower(group, on) {
    if (!this.connected || !this.client) return;
    const payload = JSON.stringify({ state: on ? 'ON' : 'OFF' });
    if (!group || group === 'all') {
      Object.keys(this.groups).forEach((g) =>
        this.client.publish(`zigbee2mqtt/${g}/set`, payload, { qos: 1 })
      );
    } else {
      if (!this.groups[group]) return;
      this.client.publish(`zigbee2mqtt/${group}/set`, payload, { qos: 1 });
    }
  }

  renameDevice(from, to) {
    if (!this.client) return;
    this.client.publish(
      'zigbee2mqtt/bridge/request/device/rename',
      JSON.stringify({ from, to }),
      { qos: 1 }
    );
  }

  removeDevice(id) {
    if (!this.client) return;
    this.client.publish(
      'zigbee2mqtt/bridge/request/device/remove',
      JSON.stringify({ id, force: false }),
      { qos: 1 }
    );
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
