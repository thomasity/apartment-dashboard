import mqtt, { type MqttClient } from 'mqtt';
import { EventEmitter } from 'events';
import * as config from '../config';
import { errorMessage } from '../util';
import type {
  DesiredState, DevicesState, GroupState, LightingState, LightValues, OccupancyEvent,
  SensorState, Z2MDevice,
} from '../types';

// Zigbee2MQTT uses mireds: lower = cooler (higher Kelvin)
const MIRED_COOL = 153; // ~6500K
const MIRED_WARM = 454; // ~2200K

// colorTemp: 0–100, where 0 = warmest (🔥 2200K) and 100 = coolest (❄️ 6500K)
function miredsToPercent(mireds: number): number {
  return Math.round(((MIRED_WARM - mireds) / (MIRED_WARM - MIRED_COOL)) * 100);
}

function percentToMireds(percent: number): number {
  return Math.round(MIRED_WARM - (percent / 100) * (MIRED_WARM - MIRED_COOL));
}

// Distinguishes dimmable lights (which get tracked as `groups`) from everything else
// (sensors, etc., tracked as `sensors`) using the Zigbee2MQTT-reported feature list.
function isLightDevice(device: Z2MDevice): boolean {
  return (device.definition?.exposes ?? []).some((e) => e.type === 'light');
}

function parseStatePayload(payload: Buffer): string {
  const raw = payload.toString();
  try { return JSON.parse(raw).state; } catch { return raw; }
}

interface Z2MSetPayload {
  state?:      'ON' | 'OFF';
  brightness?: number; // 0–254
  color_temp?: number; // mireds
}

/** Fields a bulb reports on its zigbee2mqtt/<name> topic (only the ones we use). */
interface Z2MLightReport {
  state?:      'ON' | 'OFF';
  brightness?: number;
  color_temp?: number;
}

interface MqttEvents {
  stateChange:     [LightingState];
  devicesChange:   [DevicesState];
  bridgeEvent:     [unknown];
  occupancyChange: [OccupancyEvent];
}

export class MqttManager extends EventEmitter<MqttEvents> {
  connected    = false;
  client: MqttClient | null = null;
  groups:  Record<string, GroupState>  = {};
  sensors: Record<string, SensorState> = {};
  bridgeOnline = false;
  devices: Z2MDevice[] = [];
  pairing      = false;
  poweredOff   = new Set<string>();
  availability: Record<string, boolean> = {};
  // Last state the app intentionally set for each bulb — persisted to config.json
  desiredStates: Record<string, DesiredState> = config.get('bulbDesiredStates') ?? {};
  private saveTimer: NodeJS.Timeout | undefined;

  // Debounced write so circadian updates (every ~60s) don't thrash the file
  private saveDesiredStates(): void {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => config.set('bulbDesiredStates', this.desiredStates), 1000);
  }

  // Push the last-known desired state to a bulb that just came online
  private applyDesiredState(name: string): void {
    const ds = this.desiredStates[name];
    if (!ds || !this.connected || !this.client) return;

    const payload: Z2MSetPayload = ds.power === false
      ? { state: 'OFF' }
      : {
          state: 'ON',
          ...(ds.brightness !== undefined && { brightness: Math.round((ds.brightness / 100) * 254) }),
          ...(ds.colorTemp  !== undefined && { color_temp: percentToMireds(ds.colorTemp) }),
        };

    this.client.publish(`zigbee2mqtt/${name}/set`, JSON.stringify(payload), { qos: 1 });
  }

  connect(): void {
    const brokerUrl = process.env.MQTT_BROKER_URL || 'mqtt://localhost:1883';
    console.log(`Connecting to MQTT at ${brokerUrl}...`);

    const client = mqtt.connect(brokerUrl, {
      connectTimeout: 5000,
      reconnectPeriod: 30000,
    });
    this.client = client;

    client.on('connect', () => {
      console.log('MQTT connected');
      this.connected = true;
      client.subscribe('zigbee2mqtt/bridge/state');
      client.subscribe('zigbee2mqtt/bridge/devices');
      client.subscribe('zigbee2mqtt/bridge/event');
      client.subscribe('zigbee2mqtt/bridge/response/permit_join');
      client.subscribe('zigbee2mqtt/+/availability');
      this.emit('stateChange', this.getState());
    });

    client.on('message', (topic, payload) => {
      try {
        this.handleMessage(topic, payload);
      } catch (err) {
        console.warn('MQTT message parse error:', errorMessage(err));
      }
    });

    client.on('error', (err) => {
      console.warn('MQTT unavailable — lighting controls will use local state:', err.message);
      this.connected = false;
      this.emit('stateChange', this.getState());
    });

    client.on('offline', () => {
      if (this.connected) {
        console.warn('MQTT went offline');
        this.connected = false;
        this.emit('stateChange', this.getState());
      }
    });
  }

  private handleMessage(topic: string, payload: Buffer): void {
    if (topic === 'zigbee2mqtt/bridge/state') {
      this.bridgeOnline = parseStatePayload(payload) === 'online';
      this.emit('devicesChange', this.getDevicesState());
      return;
    }

    if (topic === 'zigbee2mqtt/bridge/devices') {
      this.devices = JSON.parse(payload.toString());
      this.syncDeviceSubscriptions();
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
      const wasOnline = this.availability[name];
      const isOnline  = parseStatePayload(payload) === 'online';
      this.availability[name] = isOnline;

      // Bulb just came online (either after outage or server restart) — sync desired state
      if (!wasOnline && isOnline) {
        this.applyDesiredState(name);
      }

      this.emit('devicesChange', this.getDevicesState());
      return;
    }

    // Device state update — friendly name is everything after 'zigbee2mqtt/'
    const friendlyName = topic.slice('zigbee2mqtt/'.length);

    const sensor = this.sensors[friendlyName];
    if (sensor) {
      const data: Record<string, unknown> = JSON.parse(payload.toString());
      Object.assign(sensor, data); // capture any reported property (sensitivity, illuminance, etc.), not just occupancy
      if (data.occupancy !== undefined) {
        this.emit('occupancyChange', { name: friendlyName, occupancy: Boolean(data.occupancy) });
      }
      return;
    }

    const group = this.groups[friendlyName];
    if (!group) return;

    const data: Z2MLightReport = JSON.parse(payload.toString());

    // Sync power state from bulb report (covers server-restart state recovery)
    if (data.state !== undefined) {
      if (data.state === 'OFF') this.poweredOff.add(friendlyName);
      else this.poweredOff.delete(friendlyName);
    }
    if (data.brightness !== undefined) {
      group.brightness = Math.round((data.brightness / 254) * 100);
    }
    if (data.color_temp !== undefined) {
      group.colorTemp = miredsToPercent(data.color_temp);
    }
    this.emit('stateChange', this.getState());
  }

  private syncDeviceSubscriptions(): void {
    const client = this.client;
    if (!client) return;

    const controllable = this.devices.filter(
      (d) => d.type !== 'Coordinator' && d.interview_completed,
    );
    const lights  = controllable.filter((d) => isLightDevice(d));
    const sensors = controllable.filter((d) => !isLightDevice(d));

    // Subscribe to any newly discovered lights
    lights.forEach((d) => {
      if (!this.groups[d.friendly_name]) {
        this.groups[d.friendly_name] = { label: d.friendly_name, brightness: 70, colorTemp: 30 };
        client.subscribe(`zigbee2mqtt/${d.friendly_name}`, (err) => {
          if (err) return;
          console.log(`  subscribed: zigbee2mqtt/${d.friendly_name}`);
          // Request current state so the dashboard reflects reality on startup
          client.publish(
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
        client.unsubscribe(`zigbee2mqtt/${name}`);
        delete this.groups[name];
      }
    });

    // Subscribe to any newly discovered sensors (occupancy, etc.)
    sensors.forEach((d) => {
      if (!this.sensors[d.friendly_name]) {
        this.sensors[d.friendly_name] = { label: d.friendly_name, occupancy: null };
        client.subscribe(`zigbee2mqtt/${d.friendly_name}`, (err) => {
          if (err) return;
          console.log(`  subscribed (sensor): zigbee2mqtt/${d.friendly_name}`);
          // Request every exposed property (occupancy, sensitivity, distance, etc.) so
          // nothing sits at null until the device happens to report it spontaneously.
          const getPayload: Record<string, ''> = {};
          (d.definition?.exposes ?? []).forEach((e) => { if (e.property) getPayload[e.property] = ''; });
          if (Object.keys(getPayload).length) {
            client.publish(`zigbee2mqtt/${d.friendly_name}/get`, JSON.stringify(getPayload), { qos: 0 });
          }
        });
      }
    });

    // Unsubscribe from sensors that have been removed
    const activeSensorNames = new Set(sensors.map((d) => d.friendly_name));
    Object.keys(this.sensors).forEach((name) => {
      if (!activeSensorNames.has(name)) {
        client.unsubscribe(`zigbee2mqtt/${name}`);
        delete this.sensors[name];
      }
    });
  }

  setGroup(group: string, { brightness, colorTemp }: Partial<LightValues>): void {
    const groupState = this.groups[group];
    if (!groupState) return;

    // Always track desired state so circadian keeps it current even while a light is off.
    // This ensures applyDesiredState (on power-on or reconnect) has the right values.
    const ds = (this.desiredStates[group] ??= { power: true });
    if (brightness !== undefined) ds.brightness = brightness;
    if (colorTemp  !== undefined) ds.colorTemp  = colorTemp;
    if (ds.power === undefined) ds.power = true;
    this.saveDesiredStates();

    if (this.poweredOff.has(group)) return;

    if (brightness !== undefined) groupState.brightness = brightness;
    if (colorTemp  !== undefined) groupState.colorTemp  = colorTemp;

    if (this.connected && this.client) {
      const payload: Z2MSetPayload = {};
      if (brightness !== undefined) {
        payload.brightness = Math.round((brightness / 100) * 254);
        payload.state = brightness > 0 ? 'ON' : 'OFF';
      }
      if (colorTemp !== undefined) payload.color_temp = percentToMireds(colorTemp);
      this.client.publish(`zigbee2mqtt/${group}/set`, JSON.stringify(payload), { qos: 1 });
    }

    this.emit('stateChange', this.getState());
  }

  setPower(group: string | undefined, on: boolean): void {
    const targets = (!group || group === 'all')
      ? Object.keys(this.groups)
      : this.groups[group] ? [group] : [];

    targets.forEach((g) => {
      if (on) this.poweredOff.delete(g);
      else    this.poweredOff.add(g);

      // Track desired power state
      (this.desiredStates[g] ??= {}).power = on;
    });
    this.saveDesiredStates();

    const client = this.client;
    if (this.connected && client) {
      if (on) {
        // Push full desired state (brightness + colorTemp) so the bulb comes on
        // with the correct values, not whatever it last remembered.
        targets.forEach((g) => this.applyDesiredState(g));
      } else {
        const payload = JSON.stringify({ state: 'OFF' });
        targets.forEach((g) => client.publish(`zigbee2mqtt/${g}/set`, payload, { qos: 1 }));
      }
    }

    this.emit('stateChange', this.getState());
  }

  renameDevice(from: string, to: string): void {
    if (!this.client) return;
    this.client.publish(
      'zigbee2mqtt/bridge/request/device/rename',
      JSON.stringify({ from, to }),
      { qos: 1 },
    );
  }

  removeDevice(id: string): void {
    if (!this.client) return;
    this.client.publish(
      'zigbee2mqtt/bridge/request/device/remove',
      JSON.stringify({ id, force: true }),
      { qos: 1 },
    );
  }

  permitJoin(enable: boolean): void {
    if (!this.client) return;
    this.pairing = enable;
    this.client.publish(
      'zigbee2mqtt/bridge/request/permit_join',
      JSON.stringify({ value: enable, time: 254 }),
      { qos: 1 },
    );
    this.emit('devicesChange', this.getDevicesState());
  }

  getState(): LightingState {
    return { connected: this.connected, groups: this.groups, poweredOff: [...this.poweredOff] };
  }

  getDevicesState(): DevicesState {
    return { bridgeOnline: this.bridgeOnline, devices: this.devices, pairing: this.pairing, availability: this.availability };
  }

  getSensorsState(): Record<string, SensorState> {
    return { ...this.sensors };
  }

  // Publishes an arbitrary settable-property payload to a sensor, e.g.
  // { radar_sensitivity: 3 } — whatever properties Zigbee2MQTT reports as settable
  // for that device's exposes.
  setSensorProperty(name: string, props: Record<string, unknown>): void {
    if (!this.client || !this.sensors[name]) return;
    this.client.publish(`zigbee2mqtt/${name}/set`, JSON.stringify(props), { qos: 1 });
  }
}

const manager = new MqttManager();
manager.connect();
export default manager;
