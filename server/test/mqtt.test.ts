import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MqttClient } from 'mqtt';
import { MqttManager } from '../mqtt/client';
import { FakeMqttClient, bulb, connectedManager, coordinator, id, motionSensor } from './helpers/fakeMqtt';
import { writeConfig } from './helpers/config';

beforeEach(() => writeConfig());

const LAMP = id('Lamp');

describe('device discovery', () => {
  it('tracks interviewed lights as groups and everything else as sensors, by IEEE address', () => {
    const unpaired = { ...bulb('Half-paired'), interview_completed: false };
    const { mgr } = connectedManager([bulb('Lamp'), motionSensor('Hall Motion'), unpaired]);

    expect(Object.keys(mgr.groups)).toEqual([LAMP]);
    expect(Object.keys(mgr.sensors)).toEqual([id('Hall Motion')]);
    expect(mgr.groups[LAMP]).toEqual({ label: 'Lamp', brightness: 70, colorTemp: 30 });
  });

  it('subscribes to new devices by friendly name and asks them for their current state', () => {
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

  it('follows a rename: same address and state, new topic', () => {
    const { mgr, client } = connectedManager([bulb('Lamp')]);
    mgr.setPower(LAMP, false);
    client.deliver('zigbee2mqtt/bridge/devices', [coordinator, { ...bulb('Lamp'), friendly_name: 'Desk Lamp' }]);

    expect(mgr.groups[LAMP]?.label).toBe('Desk Lamp');
    expect(mgr.getState().poweredOff).toEqual([LAMP]);
    expect(client.subscriptions).toContain('zigbee2mqtt/Desk Lamp');
    expect(client.subscriptions).not.toContain('zigbee2mqtt/Lamp');

    client.reset();
    mgr.setPower(LAMP, true);
    expect(client.lastSet('Desk Lamp')).toEqual({ state: 'ON' });
    client.deliver('zigbee2mqtt/Desk Lamp', { brightness: 254 });
    expect(mgr.groups[LAMP]?.brightness).toBe(100);
  });

  it('drops and unsubscribes devices that disappear from the bridge list', () => {
    const { mgr, client } = connectedManager([bulb('Lamp'), bulb('Ceiling')]);
    client.deliver('zigbee2mqtt/bridge/devices', [coordinator, bulb('Lamp')]);

    expect(Object.keys(mgr.groups)).toEqual([LAMP]);
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

describe('availability', () => {
  it('keys availability by address, including reports that arrive before the device list', () => {
    const mgr    = new MqttManager();
    const client = new FakeMqttClient();
    mgr.attach(client as unknown as MqttClient);
    client.emit('connect');
    client.deliver('zigbee2mqtt/Lamp/availability', 'offline');
    client.deliver('zigbee2mqtt/bridge/devices', [coordinator, bulb('Lamp')]);
    expect(mgr.getDevicesState().availability).toEqual({ [LAMP]: false });
  });

  it('a bulb that loses power counts as off, and changes are announced with the previous value', () => {
    const { mgr, client } = connectedManager();
    const seen = vi.fn();
    mgr.on('availabilityChange', seen);

    client.deliver('zigbee2mqtt/Lamp/availability', 'online');
    client.deliver('zigbee2mqtt/Lamp/availability', 'online'); // repeat: no event
    client.deliver('zigbee2mqtt/Lamp/availability', JSON.stringify({ state: 'offline' }));

    expect(seen.mock.calls.map((c) => c[0])).toEqual([
      { id: LAMP, online: true,  previous: undefined },
      { id: LAMP, online: false, previous: true },
    ]);
    expect(mgr.getState().poweredOff).toEqual([LAMP]);
  });
});

describe('bulb state reports', () => {
  it('converts Zigbee units (0–254 brightness, mireds) to 0–100 percentages', () => {
    const { mgr, client } = connectedManager();

    client.deliver('zigbee2mqtt/Lamp', { state: 'ON', brightness: 254, color_temp: 454 });
    expect(mgr.groups[LAMP]).toMatchObject({ brightness: 100, colorTemp: 0 });   // 454 mireds = warmest

    client.deliver('zigbee2mqtt/Lamp', { brightness: 127, color_temp: 153 });
    expect(mgr.groups[LAMP]).toMatchObject({ brightness: 50, colorTemp: 100 });  // 153 mireds = coolest
  });

  it('tracks power from the bulb so a server restart picks up reality', () => {
    const { mgr, client } = connectedManager();
    client.deliver('zigbee2mqtt/Lamp', { state: 'OFF' });
    expect(mgr.getState().poweredOff).toEqual([LAMP]);
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
    expect(mgr.groups[LAMP]?.brightness).toBe(70);
  });
});

describe('sensor reports', () => {
  const HALL = id('Hall Motion');

  it('stores every reported property and emits occupancy changes', () => {
    const { mgr, client } = connectedManager([motionSensor('Hall Motion')]);
    const seen = vi.fn();
    mgr.on('occupancyChange', seen);

    client.deliver('zigbee2mqtt/Hall Motion', { occupancy: true, illuminance: 42, battery: 90, label: 'spoof' });

    expect(mgr.getSensorsState()[HALL]).toMatchObject({ label: 'Hall Motion', occupancy: true, illuminance: 42, battery: 90 });
    expect(seen).toHaveBeenCalledWith({ sensor: HALL, occupancy: true });
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
    mgr.setSensorProperty(HALL, { radar_sensitivity: 3 });
    mgr.setSensorProperty('0xnope', { radar_sensitivity: 3 });
    expect(client.published).toEqual([{ topic: 'zigbee2mqtt/Hall Motion/set', payload: { radar_sensitivity: 3 } }]);
  });
});

describe('setGroup', () => {
  it('publishes Zigbee-unit values and updates local state', () => {
    const { mgr, client } = connectedManager();
    mgr.setGroup(LAMP, { brightness: 50, colorTemp: 0 });

    expect(client.lastSet('Lamp')).toEqual({ state: 'ON', brightness: 127, color_temp: 454 });
    expect(mgr.groups[LAMP]).toMatchObject({ brightness: 50, colorTemp: 0 });
  });

  it('only sends the fields that were provided', () => {
    const { mgr, client } = connectedManager();
    mgr.setGroup(LAMP, { colorTemp: 100 });
    expect(client.lastSet('Lamp')).toEqual({ color_temp: 153 });
  });

  it('never wakes a powered-off bulb', () => {
    const { mgr, client } = connectedManager();
    mgr.setPower(LAMP, false);
    client.reset();
    mgr.setGroup(LAMP, { brightness: 30 });
    expect(client.setsFor('Lamp')).toEqual([]);
  });

  it('works in local-only mode when the broker is down', () => {
    const { mgr, client } = connectedManager();
    client.emit('error', new Error('ECONNREFUSED'));
    expect(mgr.getState().connected).toBe(false);

    mgr.setGroup(LAMP, { brightness: 15 });
    expect(client.setsFor('Lamp')).toEqual([]);
    expect(mgr.groups[LAMP]?.brightness).toBe(15);
  });

  it('ignores unknown bulbs', () => {
    const { mgr, client } = connectedManager();
    mgr.setGroup('0xgarage', { brightness: 50 });
    expect(client.published).toEqual([]);
  });
});

describe('setPower', () => {
  it('switches on with the given look in one message, so there is no flash of the old state', () => {
    const { mgr, client } = connectedManager();
    mgr.setPower(LAMP, false);
    mgr.setPower(LAMP, true, { brightness: 30, colorTemp: 20 });
    expect(client.setsFor('Lamp')).toEqual([{ state: 'OFF' }, { state: 'ON', brightness: 76, color_temp: 394 }]);
    expect(mgr.getState().poweredOff).toEqual([]);
  });

  it('ignores unknown bulbs', () => {
    const { mgr, client } = connectedManager();
    mgr.setPower('0xgarage', true);
    expect(client.published).toEqual([]);
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
