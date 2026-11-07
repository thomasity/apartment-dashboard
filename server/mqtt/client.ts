import mqtt, { type MqttClient } from 'mqtt';
import { EventEmitter } from 'events';
import { errorMessage } from '../util';
import type {
  DevicesState, GroupState, LightingState, LightValues, OccupancyEvent, SensorState, Z2MDevice,
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

/** A bulb's availability flipped. `previous` is undefined for the first report after connecting. */
export interface AvailabilityEvent {
  id:       string;
  online:   boolean;
  previous: boolean | undefined;
}

interface MqttEvents {
  stateChange:        [LightingState];
  devicesChange:      [DevicesState];
  bridgeEvent:        [unknown];
  occupancyChange:    [OccupancyEvent];
  availabilityChange: [AvailabilityEvent];
}

function toZigbee({ brightness, colorTemp }: Partial<LightValues>): Z2MSetPayload {
  return {
    ...(brightness !== undefined && { brightness: Math.round((brightness / 100) * 254) }),
    ...(colorTemp  !== undefined && { color_temp: percentToMireds(colorTemp) }),
  };
}

/**
 * Talks to Zigbee2MQTT. Everything is keyed by IEEE address; topics use the device's
 * current friendly name, looked up at publish time. It does what it's told — deciding
 * what bulbs should look like is the lighting controller's job.
 */
export class MqttManager extends EventEmitter<MqttEvents> {
  connected    = false;
  client: MqttClient | null = null;
  /** IEEE address → bulb */
  groups:  Record<string, GroupState>  = {};
  /** IEEE address → sensor */
  sensors: Record<string, SensorState> = {};
  bridgeOnline = false;
  devices: Z2MDevice[] = [];
  pairing      = false;
  poweredOff   = new Set<string>();
  availability: Record<string, boolean> = {};
  /** friendly name → IEEE address, for routing incoming topics */
  private idByName = new Map<string, string>();
  /** Availability seen before the device list told us who the name belongs to */
  private earlyAvailability = new Map<string, boolean>();

  connect(): void {
    const brokerUrl = process.env.MQTT_BROKER_URL || 'mqtt://localhost:1883';
    console.log(`Connecting to MQTT at ${brokerUrl}...`);

    this.attach(mqtt.connect(brokerUrl, {
      connectTimeout: 5000,
      reconnectPeriod: 30000,
    }));
  }

  // Wires up an already-created client. Split from connect() so tests can hand in a fake.
  attach(client: MqttClient): void {
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

  /** IEEE address for a friendly name (or the address itself), if it's a known device. */
  idOf(nameOrId: string): string | undefined {
    if (this.groups[nameOrId] || this.sensors[nameOrId]) return nameOrId;
    return this.idByName.get(nameOrId);
  }

  private topicFor(id: string): string | null {
    const label = this.groups[id]?.label ?? this.sensors[id]?.label;
    return label ? `zigbee2mqtt/${label}` : null;
  }

  private handleMessage(topic: string, payload: Buffer): void {
    if (topic === 'zigbee2mqtt/bridge/state') {
      this.bridgeOnline = parseStatePayload(payload) === 'online';
      this.emit('devicesChange', this.getDevicesState());
      return;
    }

    if (topic === 'zigbee2mqtt/bridge/devices') {
      this.devices = JSON.parse(payload.toString());
      this.syncDevices();
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
      const name   = topic.slice('zigbee2mqtt/'.length, -'/availability'.length);
      const id     = this.idByName.get(name);
      const online = parseStatePayload(payload) === 'online';
      if (!id) {
        this.earlyAvailability.set(name, online);
        return;
      }
      const previous = this.availability[id];
      this.availability[id] = online;
      // A bulb that loses power is off, whatever it last reported.
      if (!online && this.groups[id]) this.poweredOff.add(id);
      if (previous !== online) this.emit('availabilityChange', { id, online, previous });
      this.emit('devicesChange', this.getDevicesState());
      if (!online && this.groups[id]) this.emit('stateChange', this.getState());
      return;
    }

    // Device state update — friendly name is everything after 'zigbee2mqtt/'
    const id = this.idByName.get(topic.slice('zigbee2mqtt/'.length));
    if (!id) return;

    const sensor = this.sensors[id];
    if (sensor) {
      const data: Record<string, unknown> = JSON.parse(payload.toString());
      // Capture any reported property (sensitivity, illuminance, …), but never let a report clobber our label.
      Object.assign(sensor, data, { label: sensor.label });
      if (data.occupancy !== undefined) {
        this.emit('occupancyChange', { sensor: id, occupancy: Boolean(data.occupancy) });
      }
      return;
    }

    const group = this.groups[id];
    if (!group) return;

    const data: Z2MLightReport = JSON.parse(payload.toString());

    // Sync power state from bulb report (covers server-restart state recovery)
    if (data.state !== undefined) {
      if (data.state === 'OFF') this.poweredOff.add(id);
      else this.poweredOff.delete(id);
    }
    if (data.brightness !== undefined) {
      group.brightness = Math.round((data.brightness / 254) * 100);
    }
    if (data.color_temp !== undefined) {
      group.colorTemp = miredsToPercent(data.color_temp);
    }
    this.emit('stateChange', this.getState());
  }

  // Brings groups/sensors in line with the bridge's device list: subscribes to new devices,
  // follows renames (same address, new friendly name), and drops removed ones.
  private syncDevices(): void {
    const client = this.client;
    if (!client) return;

    const controllable = this.devices.filter((d) => d.type !== 'Coordinator' && d.interview_completed);
    const present = new Set(controllable.map((d) => d.ieee_address));

    for (const [kind, store] of [['light', this.groups], ['sensor', this.sensors]] as const) {
      for (const id of Object.keys(store)) {
        if (present.has(id)) continue;
        client.unsubscribe(`zigbee2mqtt/${store[id]!.label}`);
        delete store[id];
        this.poweredOff.delete(id);
        console.log(`  removed ${kind}: ${id}`);
      }
    }

    this.idByName.clear();
    for (const d of controllable) {
      const id   = d.ieee_address;
      const name = d.friendly_name;
      this.idByName.set(name, id);
      const early = this.earlyAvailability.get(name);
      if (early !== undefined) {
        this.availability[id] ??= early;
        this.earlyAvailability.delete(name);
      }
      const light = isLightDevice(d);
      const existing = light ? this.groups[id] : this.sensors[id];

      if (existing && existing.label === name) continue;
      if (existing) {
        // Renamed: same device, new topic.
        client.unsubscribe(`zigbee2mqtt/${existing.label}`);
        existing.label = name;
      } else if (light) {
        this.groups[id] = { label: name, brightness: 70, colorTemp: 30 };
      } else {
        this.sensors[id] = { label: name, occupancy: null };
      }

      client.subscribe(`zigbee2mqtt/${name}`, (err) => {
        if (err) return;
        console.log(`  subscribed${light ? '' : ' (sensor)'}: zigbee2mqtt/${name}`);
        // Request current state so the dashboard reflects reality on startup. Sensors get
        // every exposed property, so nothing sits at null until the device reports on its own.
        const getPayload: Record<string, ''> = light ? { state: '', brightness: '', color_temp: '' } : {};
        if (!light) (d.definition?.exposes ?? []).forEach((e) => { if (e.property) getPayload[e.property] = ''; });
        if (Object.keys(getPayload).length) {
          client.publish(`zigbee2mqtt/${name}/get`, JSON.stringify(getPayload), { qos: 0 });
        }
      });
    }
  }

  private publish(id: string, payload: Z2MSetPayload): void {
    const topic = this.topicFor(id);
    if (!topic || !this.connected || !this.client) return;
    this.client.publish(`${topic}/set`, JSON.stringify(payload), { qos: 1 });
  }

  /** Change an on bulb's look. A powered-off bulb is left off (and untouched). */
  setGroup(id: string, values: Partial<LightValues>): void {
    const groupState = this.groups[id];
    if (!groupState || this.poweredOff.has(id)) return;

    if (values.brightness !== undefined) groupState.brightness = values.brightness;
    if (values.colorTemp  !== undefined) groupState.colorTemp  = values.colorTemp;

    const payload = toZigbee(values);
    if (values.brightness !== undefined) payload.state = values.brightness > 0 ? 'ON' : 'OFF';
    this.publish(id, payload);
    this.emit('stateChange', this.getState());
  }

  /**
   * Switch bulbs on or off. Turning on can carry the look to come on with, in the same
   * message, so the bulb never flashes its old state first.
   */
  setPower(id: string, on: boolean, look?: Partial<LightValues>): void {
    const groupState = this.groups[id];
    if (!groupState) return;

    if (on) {
      this.poweredOff.delete(id);
      if (look?.brightness !== undefined) groupState.brightness = look.brightness;
      if (look?.colorTemp  !== undefined) groupState.colorTemp  = look.colorTemp;
      this.publish(id, { state: 'ON', ...(look && toZigbee(look)) });
    } else {
      this.poweredOff.add(id);
      this.publish(id, { state: 'OFF' });
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
  setSensorProperty(id: string, props: Record<string, unknown>): void {
    const topic = this.sensors[id] && this.topicFor(id);
    if (!topic || !this.client) return;
    this.client.publish(`${topic}/set`, JSON.stringify(props), { qos: 1 });
  }
}

// Not connected on import — the entry point calls connect() so tests can import freely.
export default new MqttManager();
