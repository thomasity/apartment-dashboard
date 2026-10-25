// A stand-in for the mqtt.js client that plays the part of Zigbee2MQTT, so mock mode
// (MOCK=true) runs the real lighting stack — rooms, rules, circadian, presence — with
// bulbs that answer /get and /set, a pairing flow, and a presence sensor that toggles.

import { EventEmitter } from 'events';
import type { MqttClient } from 'mqtt';
import type { Z2MDevice } from '../types';
import * as mock from './mockData';

const PAIRING_JOIN_MS   = 5_000;
const OCCUPANCY_FLIP_MS = 45_000;

class FakeZigbee extends EventEmitter {
  private devices: Z2MDevice[] = structuredClone(mock.zigbeeDevices);
  private states  = structuredClone(mock.zigbeeStates);

  start(): void {
    this.emit('connect');
    this.deliver('zigbee2mqtt/bridge/state', 'online');
    this.deliverDevices();
    for (const d of this.devices) {
      if (d.type === 'Coordinator') continue;
      this.deliver(`zigbee2mqtt/${d.friendly_name}/availability`, mock.offlineDevices.includes(d.friendly_name) ? 'offline' : 'online');
    }
    setInterval(() => {
      const sensor = this.states[mock.PRESENCE_SENSOR];
      if (!sensor) return;
      sensor.occupancy = !sensor.occupancy;
      this.deliver(`zigbee2mqtt/${mock.PRESENCE_SENSOR}`, sensor);
    }, OCCUPANCY_FLIP_MS).unref();
  }

  subscribe(_topic: string, cb?: (err: Error | null) => void): this {
    cb?.(null);
    return this;
  }

  unsubscribe(): this {
    return this;
  }

  publish(topic: string, message: string | Buffer): this {
    let payload: Record<string, unknown> = {};
    try { payload = JSON.parse(message.toString()); } catch {}
    // Answer asynchronously, like a real broker round-trip
    setImmediate(() => this.handle(topic, payload));
    return this;
  }

  private handle(topic: string, payload: Record<string, unknown>): void {
    if (topic === 'zigbee2mqtt/bridge/request/permit_join') {
      const value = Boolean(payload.value);
      this.deliver('zigbee2mqtt/bridge/response/permit_join', { data: { value }, status: 'ok' });
      if (value) setTimeout(() => this.join(mock.pairableBulb), PAIRING_JOIN_MS);
      return;
    }
    if (topic === 'zigbee2mqtt/bridge/request/device/rename') {
      const { from, to } = payload as { from: string; to: string };
      const device = this.devices.find((d) => d.friendly_name === from);
      if (!device) return;
      device.friendly_name = to;
      this.states[to] = this.states[from] ?? {};
      delete this.states[from];
      this.deliverDevices();
      return;
    }
    if (topic === 'zigbee2mqtt/bridge/request/device/remove') {
      this.devices = this.devices.filter((d) => d.friendly_name !== payload.id && d.ieee_address !== payload.id);
      this.deliverDevices();
      return;
    }

    const m = topic.match(/^zigbee2mqtt\/(.+)\/(get|set)$/);
    const name = m?.[1];
    if (!name || !this.states[name]) return;
    if (m[2] === 'set') Object.assign(this.states[name], payload);
    this.deliver(`zigbee2mqtt/${name}`, this.states[name]);
  }

  private join(device: Z2MDevice): void {
    if (this.devices.some((d) => d.ieee_address === device.ieee_address)) return;
    this.devices.push(structuredClone(device));
    this.states[device.friendly_name] = { state: 'ON', brightness: 200, color_temp: 300 };
    this.deliverDevices();
    this.deliver(`zigbee2mqtt/${device.friendly_name}/availability`, 'online');
  }

  private deliverDevices(): void {
    this.deliver('zigbee2mqtt/bridge/devices', this.devices);
  }

  private deliver(topic: string, payload: unknown): void {
    const raw = typeof payload === 'string' ? payload : JSON.stringify(payload);
    this.emit('message', topic, Buffer.from(raw));
  }
}

/** A connected-looking client to hand to MqttManager.attach(); call start() after attaching. */
export function createFakeZigbee() {
  const client = new FakeZigbee();
  return { client: client as unknown as MqttClient, start: () => client.start() };
}
