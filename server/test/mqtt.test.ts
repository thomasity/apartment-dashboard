import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MqttClient } from 'mqtt';
import { MqttManager } from '../mqtt/client';
import { FakeMqttClient, bulb, connectedManager, coordinator, motionSensor } from './helpers/fakeMqtt';
import { readConfig, writeConfig } from './helpers/config';

beforeEach(() => writeConfig());

describe('device discovery', () => {
  it('tracks interviewed lights as groups and everything else as sensors', () => {
    const unpaired = { ...bulb('Half-paired'), interview_completed: false };
    const { mgr } = connectedManager([bulb('Lamp'), motionSensor('Hall Motion'), unpaired]);

    expect(Object.keys(mgr.groups)).toEqual(['Lamp']);
    expect(Object.keys(mgr.sensors)).toEqual(['Hall Motion']);
    expect(mgr.groups.Lamp).toEqual({ label: 'Lamp', brightness: 70, colorTemp: 30 });
  });

  it('subscribes to new devices and asks them for their current state', () => {
    const mgr    = new MqttManager();
    const client = new FakeMqttClient();
    mgr.attach(client as unknown as MqttClient);
    client.emit('connect');
    client.deliver('zigbee2mqtt/bridge/devices', [coordinator, bulb('Lamp'), motionSensor('Hall Motion')]);

    expect(client.subscriptions).toContain('zigbee2mqtt/Lamp');
    expect(client.subscriptions).toContain('zigbee2mqtt/Hall Motion');
    expect(client.published).toContainEqual({
      topic: 'zigbee2mqtt/Lamp/get', payload: { state: '', brightness: '', color_temp: '' },
    });
    // Sensors get a /get for every exposed property
    expect(client.published).toContainEqual({
      topic: 'zigbee2mqtt/Hall Motion/get', payload: { occupancy: '', illuminance: '' },
    });
  });

  it('drops and unsubscribes devices that disappear from the bridge list', () => {
    const { mgr, client } = connectedManager([bulb('Lamp'), bulb('Ceiling')]);
    client.deliver('zigbee2mqtt/bridge/devices', [coordinator, bulb('Lamp')]);

    expect(Object.keys(mgr.groups)).toEqual(['Lamp']);
    expect(client.subscriptions).not.toContain('zigbee2mqtt/Ceiling');
  });

  it('reports bridge online/offline and pairing state', () => {
    const { mgr, client } = connectedManager();
    const seen = vi.fn();
    mgr.on('devicesChange', seen);

    client.deliver('zigbee2mqtt/bridge/state', JSON.stringify({ state: 'offline' }));
    expect(mgr.getDevicesState().bridgeOnline).toBe(false);

    client.deliver('zigbee2mqtt/bridge/response/permit_join', { data: { value: true } });
    expect(mgr.getDevicesState().pairing).toBe(true);
    expect(seen).toHaveBeenCalledTimes(2);
  });
});

describe('bulb state reports', () => {
  it('converts Zigbee units (0–254 brightness, mireds) to 0–100 percentages', () => {
    const { mgr, client } = connectedManager();

    client.deliver('zigbee2mqtt/Lamp', { state: 'ON', brightness: 254, color_temp: 454 });
    expect(mgr.groups.Lamp).toMatchObject({ brightness: 100, colorTemp: 0 });   // 454 mireds = warmest

    client.deliver('zigbee2mqtt/Lamp', { brightness: 127, color_temp: 153 });
    expect(mgr.groups.Lamp).toMatchObject({ brightness: 50, colorTemp: 100 });  // 153 mireds = coolest
  });

  it('tracks power from the bulb so a server restart picks up reality', () => {
    const { mgr, client } = connectedManager();
    client.deliver('zigbee2mqtt/Lamp', { state: 'OFF' });
    expect(mgr.getState().poweredOff).toEqual(['Lamp']);
    client.deliver('zigbee2mqtt/Lamp', { state: 'ON' });
    expect(mgr.getState().poweredOff).toEqual([]);
  });

  it('emits stateChange so sockets get pushed the update', () => {
    const { mgr, client } = connectedManager();
    const seen = vi.fn();
    mgr.on('stateChange', seen);
    client.deliver('zigbee2mqtt/Lamp', { brightness: 10 });
    expect(seen).toHaveBeenCalledWith(expect.objectContaining({ connected: true }));
  });

  it('ignores malformed payloads instead of crashing the server', () => {
    const { mgr, client } = connectedManager();
    expect(() => client.deliver('zigbee2mqtt/Lamp', '{not json')).not.toThrow();
    expect(mgr.groups.Lamp?.brightness).toBe(70);
  });
});

describe('sensor reports', () => {
  it('stores every reported property and emits occupancy changes', () => {
    const { mgr, client } = connectedManager([motionSensor('Hall Motion')]);
    const seen = vi.fn();
    mgr.on('occupancyChange', seen);

    client.deliver('zigbee2mqtt/Hall Motion', { occupancy: true, illuminance: 42, battery: 90 });

    expect(mgr.getSensorsState()['Hall Motion']).toMatchObject({ occupancy: true, illuminance: 42, battery: 90 });
    expect(seen).toHaveBeenCalledWith({ name: 'Hall Motion', occupancy: true });
  });

  it('does not emit occupancy for reports without it', () => {
    const { mgr, client } = connectedManager([motionSensor('Hall Motion')]);
    const seen = vi.fn();
    mgr.on('occupancyChange', seen);
    client.deliver('zigbee2mqtt/Hall Motion', { illuminance: 5 });
    expect(seen).not.toHaveBeenCalled();
  });

  it('publishes settable properties to known sensors only', () => {
    const { mgr, client } = connectedManager([motionSensor('Hall Motion')]);
    mgr.setSensorProperty('Hall Motion', { radar_sensitivity: 3 });
    mgr.setSensorProperty('Nope', { radar_sensitivity: 3 });
    expect(client.published).toEqual([{ topic: 'zigbee2mqtt/Hall Motion/set', payload: { radar_sensitivity: 3 } }]);
  });
});

describe('setGroup', () => {
  it('publishes Zigbee-unit values and updates local state', () => {
    const { mgr, client } = connectedManager();
    mgr.setGroup('Lamp', { brightness: 50, colorTemp: 0 });

    expect(client.lastSet('Lamp')).toEqual({ state: 'ON', brightness: 127, color_temp: 454 });
    expect(mgr.groups.Lamp).toMatchObject({ brightness: 50, colorTemp: 0 });
  });

  it('turns the bulb off when brightness is 0', () => {
    const { mgr, client } = connectedManager();
    mgr.setGroup('Lamp', { brightness: 0 });
    expect(client.lastSet('Lamp')).toEqual({ state: 'OFF', brightness: 0 });
  });

  it('only sends the fields that were provided', () => {
    const { mgr, client } = connectedManager();
    mgr.setGroup('Lamp', { colorTemp: 100 });
    expect(client.lastSet('Lamp')).toEqual({ color_temp: 153 });
  });

  it('does not wake a powered-off bulb, but remembers the values for power-on', () => {
    const { mgr, client } = connectedManager();
    mgr.setPower('Lamp', false);
    client.reset();

    mgr.setGroup('Lamp', { brightness: 30, colorTemp: 20 });
    expect(client.setsFor('Lamp')).toEqual([]);

    mgr.setPower('Lamp', true);
    expect(client.lastSet('Lamp')).toEqual({ state: 'ON', brightness: 76, color_temp: 394 });
  });

  it('works in local-only mode when the broker is down', () => {
    const { mgr, client } = connectedManager();
    client.emit('error', new Error('ECONNREFUSED'));
    expect(mgr.getState().connected).toBe(false);

    mgr.setGroup('Lamp', { brightness: 15 });
    expect(client.setsFor('Lamp')).toEqual([]);
    expect(mgr.groups.Lamp?.brightness).toBe(15);
  });

  it('ignores unknown groups', () => {
    const { mgr, client } = connectedManager();
    mgr.setGroup('Garage', { brightness: 50 });
    expect(client.published).toEqual([]);
  });
});

describe('setPower', () => {
  it('"all" targets every bulb', () => {
    const { mgr, client } = connectedManager();
    mgr.setPower('all', false);
    expect(client.lastSet('Lamp')).toEqual({ state: 'OFF' });
    expect(client.lastSet('Ceiling')).toEqual({ state: 'OFF' });
    expect(mgr.getState().poweredOff.sort()).toEqual(['Ceiling', 'Lamp']);
  });

  it('ignores unknown groups', () => {
    const { mgr, client } = connectedManager();
    mgr.setPower('Garage', true);
    expect(client.published).toEqual([]);
  });
});

describe('desired state recovery', () => {
  it('replays the last desired state when a bulb comes back online', () => {
    const { mgr, client } = connectedManager();
    client.deliver('zigbee2mqtt/Lamp/availability', 'online');
    mgr.setGroup('Lamp', { brightness: 40, colorTemp: 60 });

    client.deliver('zigbee2mqtt/Lamp/availability', JSON.stringify({ state: 'offline' }));
    client.reset();
    client.deliver('zigbee2mqtt/Lamp/availability', JSON.stringify({ state: 'online' }));

    expect(client.lastSet('Lamp')).toEqual({ state: 'ON', brightness: 102, color_temp: 273 });
  });

  it('keeps an intentionally-off bulb off after a power blip', () => {
    const { mgr, client } = connectedManager();
    mgr.setPower('Lamp', false);
    client.reset();
    client.deliver('zigbee2mqtt/Lamp/availability', 'online');
    expect(client.lastSet('Lamp')).toEqual({ state: 'OFF' });
  });

  it('does not re-send on repeated "online" messages', () => {
    const { mgr, client } = connectedManager();
    mgr.setGroup('Lamp', { brightness: 40 });
    client.deliver('zigbee2mqtt/Lamp/availability', 'online');
    client.reset();
    client.deliver('zigbee2mqtt/Lamp/availability', 'online');
    expect(client.setsFor('Lamp')).toEqual([]);
  });

  it('persists desired states (debounced) and restores them on restart', () => {
    vi.useFakeTimers();
    try {
      const { mgr } = connectedManager();
      mgr.setGroup('Lamp', { brightness: 40 });
      mgr.setGroup('Lamp', { colorTemp: 10 });
      expect(readConfig().bulbDesiredStates).toBeUndefined(); // not written yet

      vi.advanceTimersByTime(1000);
      expect(readConfig().bulbDesiredStates).toEqual({ Lamp: { power: true, brightness: 40, colorTemp: 10 } });

      // "Restart": a fresh manager reads it back and applies it when the bulb appears.
      const { client } = connectedManager();
      client.deliver('zigbee2mqtt/Lamp/availability', 'online');
      expect(client.lastSet('Lamp')).toEqual({ state: 'ON', brightness: 102, color_temp: 424 });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('bridge requests', () => {
  it('renames, removes and opens pairing through the bridge API', () => {
    const { mgr, client } = connectedManager();
    mgr.renameDevice('Lamp', 'Desk Lamp');
    mgr.removeDevice('0xabc');
    mgr.permitJoin(true);

    expect(client.published).toEqual([
      { topic: 'zigbee2mqtt/bridge/request/device/rename', payload: { from: 'Lamp', to: 'Desk Lamp' } },
      { topic: 'zigbee2mqtt/bridge/request/device/remove', payload: { id: '0xabc', force: true } },
      { topic: 'zigbee2mqtt/bridge/request/permit_join',   payload: { value: true, time: 254 } },
    ]);
    expect(mgr.pairing).toBe(true);
  });
});
