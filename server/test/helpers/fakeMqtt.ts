// A stand-in for the mqtt.js client that records what the server publishes and lets
// tests play the part of Zigbee2MQTT by delivering messages on any topic.

import { EventEmitter } from 'events';
import type { MqttClient } from 'mqtt';
import { MqttManager } from '../../mqtt/client';
import type { Z2MDevice } from '../../types';

interface Published { topic: string; payload: unknown }

export class FakeMqttClient extends EventEmitter {
  published: Published[] = [];
  subscriptions = new Set<string>();

  publish(topic: string, message: string | Buffer): this {
    const raw = message.toString();
    let payload: unknown = raw;
    try { payload = JSON.parse(raw); } catch {}
    this.published.push({ topic, payload });
    return this;
  }

  subscribe(topic: string, cb?: (err: Error | null) => void): this {
    this.subscriptions.add(topic);
    cb?.(null);
    return this;
  }

  unsubscribe(topic: string): this {
    this.subscriptions.delete(topic);
    return this;
  }

  /** Simulate Zigbee2MQTT publishing `payload` (object → JSON) on `topic`. */
  deliver(topic: string, payload: unknown): void {
    const raw = typeof payload === 'string' ? payload : JSON.stringify(payload);
    this.emit('message', topic, Buffer.from(raw));
  }

  /** Payloads published to `zigbee2mqtt/<name>/set`. */
  setsFor(name: string): unknown[] {
    return this.published.filter((p) => p.topic === `zigbee2mqtt/${name}/set`).map((p) => p.payload);
  }

  lastSet(name: string): unknown {
    return this.setsFor(name).at(-1);
  }

  reset(): void {
    this.published = [];
  }
}

// ── Device fixtures (shaped like zigbee2mqtt/bridge/devices entries) ─────────

export function bulb(name: string): Z2MDevice {
  return {
    ieee_address: `0x${Buffer.from(name).toString('hex')}`,
    friendly_name: name,
    type: 'Router',
    interview_completed: true,
    definition: { description: 'Smart bulb', exposes: [{ type: 'light', features: [] }] },
  };
}

export function motionSensor(name: string): Z2MDevice {
  return {
    ieee_address: `0x${Buffer.from(name).toString('hex')}`,
    friendly_name: name,
    type: 'EndDevice',
    interview_completed: true,
    definition: {
      description: 'Motion sensor',
      exposes: [
        { type: 'binary',  property: 'occupancy' },
        { type: 'numeric', property: 'illuminance' },
      ],
    },
  };
}

export const coordinator: Z2MDevice = {
  ieee_address: '0x00', friendly_name: 'Coordinator', type: 'Coordinator', interview_completed: true, definition: null,
};

/**
 * A manager wired to a fake client that has connected, seen the bridge come online and
 * received the device list. The publish log is cleared so tests only see what they cause.
 */
export function connectedManager(devices: Z2MDevice[] = [bulb('Lamp'), bulb('Ceiling')]) {
  const mgr    = new MqttManager();
  const client = new FakeMqttClient();
  mgr.attach(client as unknown as MqttClient);
  client.emit('connect');
  client.deliver('zigbee2mqtt/bridge/state', 'online');
  client.deliver('zigbee2mqtt/bridge/devices', [coordinator, ...devices]);
  client.reset();
  return { mgr, client };
}
