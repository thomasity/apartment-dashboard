const mqtt = require('mqtt');
const EventEmitter = require('events');
const config = require('../config');

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

// Distinguishes dimmable lights (which get tracked as `groups`) from everything else
// (sensors, etc., tracked as `sensors`) using the Zigbee2MQTT-reported feature list.
function isLightDevice(device) {
  return (device.definition?.exposes || []).some((e) => e.type === 'light');
}

class MqttManager extends EventEmitter {
  constructor() {
    super();
    this.connected   = false;
    this.client      = null;
    this.groups      = {};
    this.sensors     = {};
    this.bridgeOnline = false;
    this.devices     = [];
    this.pairing     = false;
    this.poweredOff  = new Set();
    this.availability = {};
    // Last state the app intentionally set for each bulb — persisted to config.json
    this.desiredStates = config.get('bulbDesiredStates') ?? {};
    this._saveTimer  = null;
  }

  // Debounced write so circadian updates (every ~60s) don't thrash the file
  _saveDesiredStates() {
    clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => config.set('bulbDesiredStates', this.desiredStates), 1000);
  }

  // Push the last-known desired state to a bulb that just came online
  _applyDesiredState(name) {
    const ds = this.desiredStates[name];
    if (!ds || !this.connected || !this.client) return;

    const payload = ds.power === false
      ? { state: 'OFF' }
      : {
          state: 'ON',
          ...(ds.brightness !== undefined && { brightness: Math.round((ds.brightness / 100) * 254) }),
          ...(ds.colorTemp  !== undefined && { color_temp: percentToMireds(ds.colorTemp) }),
        };

    this.client.publish(`zigbee2mqtt/${name}/set`, JSON.stringify(payload), { qos: 1 });
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
      this.client.subscribe('zigbee2mqtt/+/availability');
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

        // Per-device availability (requires `availability: true` in Z2M config)
        if (topic.endsWith('/availability')) {
          const name = topic.slice('zigbee2mqtt/'.length, -'/availability'.length);
          let state;
          try { state = JSON.parse(payload.toString()).state; } catch { state = payload.toString(); }

          const wasOnline = this.availability[name];
          this.availability[name] = state === 'online';

          // Bulb just came online (either after outage or server restart) — sync desired state
          if (!wasOnline && this.availability[name]) {
            this._applyDesiredState(name);
          }

          this.emit('devicesChange', this.getDevicesState());
          return;
        }

        // Device state update — friendly name is everything after 'zigbee2mqtt/'
        const friendlyName = topic.slice('zigbee2mqtt/'.length);

        if (this.sensors[friendlyName]) {
          const data = JSON.parse(payload.toString());
          if (data.occupancy !== undefined) {
            this.sensors[friendlyName].occupancy = data.occupancy;
            this.emit('occupancyChange', { name: friendlyName, occupancy: data.occupancy });
          }
          return;
        }

        if (!this.groups[friendlyName]) return;

        const data = JSON.parse(payload.toString());

        // Sync power state from bulb report (covers server-restart state recovery)
        if (data.state !== undefined) {
          if (data.state === 'OFF') this.poweredOff.add(friendlyName);
          else this.poweredOff.delete(friendlyName);
        }
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
    const lights  = controllable.filter((d) => isLightDevice(d));
    const sensors = controllable.filter((d) => !isLightDevice(d));

    // Subscribe to any newly discovered lights
    lights.forEach((d) => {
      if (!this.groups[d.friendly_name]) {
        this.groups[d.friendly_name] = { label: d.friendly_name, brightness: 70, colorTemp: 30 };
        this.client.subscribe(`zigbee2mqtt/${d.friendly_name}`, (err) => {
          if (err) return;
          console.log(`  subscribed: zigbee2mqtt/${d.friendly_name}`);
          // Request current state so the dashboard reflects reality on startup
          this.client.publish(
            `zigbee2mqtt/${d.friendly_name}/get`,
            JSON.stringify({ state: '', brightness: '', color_temp: '' }),
            { qos: 0 },
          );
        });
      }
    });

    // Unsubscribe from lights that have been removed
    const activeLightNames = new Set(lights.map((d) => d.friendly_name));
    Object.keys(this.groups).forEach((name) => {
      if (!activeLightNames.has(name)) {
        this.client.unsubscribe(`zigbee2mqtt/${name}`);
        delete this.groups[name];
      }
    });

    // Subscribe to any newly discovered sensors (occupancy, etc.)
    sensors.forEach((d) => {
      if (!this.sensors[d.friendly_name]) {
        this.sensors[d.friendly_name] = { label: d.friendly_name, occupancy: null };
        this.client.subscribe(`zigbee2mqtt/${d.friendly_name}`, (err) => {
          if (err) return;
          console.log(`  subscribed (sensor): zigbee2mqtt/${d.friendly_name}`);
        });
      }
    });

    // Unsubscribe from sensors that have been removed
    const activeSensorNames = new Set(sensors.map((d) => d.friendly_name));
    Object.keys(this.sensors).forEach((name) => {
      if (!activeSensorNames.has(name)) {
        this.client.unsubscribe(`zigbee2mqtt/${name}`);
        delete this.sensors[name];
      }
    });
  }

  setGroup(group, { brightness, colorTemp }) {
    if (!this.groups[group]) return;

    // Always track desired state so circadian keeps it current even while a light is off.
    // This ensures _applyDesiredState (on power-on or reconnect) has the right values.
    if (!this.desiredStates[group]) this.desiredStates[group] = { power: true };
    if (brightness !== undefined) this.desiredStates[group].brightness = brightness;
    if (colorTemp  !== undefined) this.desiredStates[group].colorTemp  = colorTemp;
    if (this.desiredStates[group].power === undefined) this.desiredStates[group].power = true;
    this._saveDesiredStates();

    if (this.poweredOff.has(group)) return;

    if (brightness !== undefined) this.groups[group].brightness = brightness;
    if (colorTemp  !== undefined) this.groups[group].colorTemp  = colorTemp;

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
    const targets = (!group || group === 'all')
      ? Object.keys(this.groups)
      : this.groups[group] ? [group] : [];

    targets.forEach((g) => {
      if (on) this.poweredOff.delete(g);
      else    this.poweredOff.add(g);

      // Track desired power state
      if (!this.desiredStates[g]) this.desiredStates[g] = {};
      this.desiredStates[g].power = on;
    });
    this._saveDesiredStates();

    if (this.connected && this.client) {
      if (on) {
        // Push full desired state (brightness + colorTemp) so the bulb comes on
        // with the correct values, not whatever it last remembered.
        targets.forEach((g) => this._applyDesiredState(g));
      } else {
        const payload = JSON.stringify({ state: 'OFF' });
        targets.forEach((g) => this.client.publish(`zigbee2mqtt/${g}/set`, payload, { qos: 1 }));
      }
    }

    this.emit('stateChange', this.getState());
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
      JSON.stringify({ id, force: true }),
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
    return { connected: this.connected, groups: this.groups, poweredOff: [...this.poweredOff] };
  }

  getDevicesState() {
    return { bridgeOnline: this.bridgeOnline, devices: this.devices, pairing: this.pairing, availability: this.availability };
  }

  getSensorsState() {
    return { ...this.sensors };
  }
}

const manager = new MqttManager();
manager.connect();
module.exports = manager;
