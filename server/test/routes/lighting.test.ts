import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { bulb, motionSensor } from '../helpers/fakeMqtt';
import { readConfig, writeConfig } from '../helpers/config';
import { startApp } from '../helpers/app';

let ctx: Awaited<ReturnType<typeof startApp>>;

beforeEach(async () => {
  writeConfig({ rooms: { 'Living Room': ['Lamp', 'Ceiling'], Bedroom: ['Bedside'] } });
  ctx = await startApp([bulb('Lamp'), bulb('Ceiling'), bulb('Bedside'), motionSensor('Hall Motion')]);
});
afterEach(() => ctx.close());

const api = () => request(ctx.app);

describe('POST /api/lighting/set', () => {
  it('sets one group and marks it overridden (so circadian backs off)', async () => {
    await api().post('/api/lighting/set').send({ group: 'Lamp', brightness: 40 }).expect(200, { ok: true });

    expect(ctx.client.lastSet('Lamp')).toEqual({ state: 'ON', brightness: 102 });
    expect(ctx.client.setsFor('Ceiling')).toEqual([]);

    const { body } = await api().get('/api/lighting/override').expect(200);
    expect(Object.keys(body)).toEqual(['Lamp']);
  });

  it('accepts string values from sliders', async () => {
    await api().post('/api/lighting/set').send({ group: 'Lamp', brightness: '100', colorTemp: '0' });
    expect(ctx.client.lastSet('Lamp')).toEqual({ state: 'ON', brightness: 254, color_temp: 454 });
  });

  it('with no group, sets every bulb', async () => {
    await api().post('/api/lighting/set').send({ colorTemp: 100 });
    for (const name of ['Lamp', 'Ceiling', 'Bedside']) {
      expect(ctx.client.lastSet(name)).toEqual({ color_temp: 153 });
    }
  });
});

describe('POST /api/lighting/power', () => {
  it('defaults to all bulbs', async () => {
    await api().post('/api/lighting/power').send({ on: false }).expect(200);
    expect((await api().get('/api/lighting/state')).body.poweredOff.sort()).toEqual(['Bedside', 'Ceiling', 'Lamp']);
  });

  it('a manual off suppresses presence auto-on for that room', async () => {
    await api().post('/api/lighting/presence').send({ sensor: 'Hall Motion', room: 'Living Room' }).expect(200);
    await api().post('/api/lighting/power').send({ group: 'Lamp', on: false });
    ctx.client.reset();

    ctx.client.deliver('zigbee2mqtt/Hall Motion', { occupancy: true });
    expect(ctx.client.published).toEqual([]);

    const { body } = await api().get('/api/lighting/presence');
    expect(body[0].manualOffUntil).toBeGreaterThan(Date.now());
  });
});

describe('room actions', () => {
  it('/rooms/:name/set fans out to every device in the room', async () => {
    await api().post('/api/lighting/rooms/Living Room/set').send({ brightness: 10 }).expect(200);
    expect(ctx.client.lastSet('Lamp')).toEqual({ state: 'ON', brightness: 25 });
    expect(ctx.client.lastSet('Ceiling')).toEqual({ state: 'ON', brightness: 25 });
    expect(ctx.client.setsFor('Bedside')).toEqual([]);

    const { body } = await api().get('/api/lighting/override');
    expect(Object.keys(body).sort()).toEqual(['Ceiling', 'Lamp']);
  });

  it('/rooms/:name/power fans out to every device in the room', async () => {
    await api().post('/api/lighting/rooms/Bedroom/power').send({ on: false }).expect(200);
    expect(ctx.client.lastSet('Bedside')).toEqual({ state: 'OFF' });
    expect(ctx.client.setsFor('Lamp')).toEqual([]);
  });

  it('/rooms/:name/circadian clears overrides then puts each device on circadian', async () => {
    await api().post('/api/lighting/rooms/Living Room/set').send({ brightness: 10 });
    await api().post('/api/lighting/rooms/Living Room/circadian').send({ enabled: true }).expect(200);

    expect((await api().get('/api/lighting/override')).body).toEqual({});
    const { body } = await api().get('/api/lighting/circadian');
    expect(body.enabledGroups.sort()).toEqual(['Ceiling', 'Lamp']);
    expect(body.timeline).toHaveLength(24);
  });

  it('DELETE /rooms/:name/override hands the room back to circadian immediately', async () => {
    await api().post('/api/lighting/rooms/Living Room/circadian').send({ enabled: true });
    await api().post('/api/lighting/rooms/Living Room/set').send({ brightness: 10 });
    ctx.client.reset();

    await api().delete('/api/lighting/rooms/Living Room/override').expect(200);
    expect(ctx.client.setsFor('Lamp')).toHaveLength(1);
    expect((await api().get('/api/lighting/override')).body).toEqual({});
  });
});

describe('room CRUD', () => {
  it('maps service errors to HTTP statuses', async () => {
    await api().post('/api/lighting/rooms').send({}).expect(400);
    await api().post('/api/lighting/rooms').send({ name: 'Bedroom' }).expect(409);
    await api().patch('/api/lighting/rooms/Ghost').send({ newName: 'X' }).expect(404);
    await api().patch('/api/lighting/rooms/Bedroom').send({ newName: 'Living Room' }).expect(409);
  });

  it('broadcasts room changes to connected dashboards', async () => {
    const emit = vi.spyOn(ctx.io, 'emit');
    await api().post('/api/lighting/rooms').send({ name: 'Kitchen' }).expect(200);
    await api().post('/api/lighting/rooms/assign').send({ device: 'Lamp', room: 'Kitchen' }).expect(200);

    expect(emit).toHaveBeenLastCalledWith('lighting:rooms', {
      'Living Room': ['Ceiling'], Bedroom: ['Bedside'], Kitchen: ['Lamp'],
    });
    expect(readConfig().rooms?.Kitchen).toEqual(['Lamp']);
  });

  it('assign requires a device', async () => {
    await api().post('/api/lighting/rooms/assign').send({ room: 'Bedroom' }).expect(400);
  });
});

describe('rules and presence CRUD', () => {
  it('rules: create, list, patch, 404 on unknown, delete', async () => {
    const { body: rule } = await api().post('/api/lighting/rules')
      .send({ name: 'Night', time: '23:00', days: [0], action: { type: 'power', group: 'all', on: false } })
      .expect(200);

    await api().patch(`/api/lighting/rules/${rule.id}`).send({ enabled: false }).expect(200);
    expect((await api().get('/api/lighting/rules')).body).toEqual([{ ...rule, enabled: false }]);

    await api().patch('/api/lighting/rules/nope').send({}).expect(404);
    await api().delete(`/api/lighting/rules/${rule.id}`).expect(200);
    expect((await api().get('/api/lighting/rules')).body).toEqual([]);
  });

  it('presence: 400 on bad input, 404 on unknown sensor', async () => {
    await api().post('/api/lighting/presence').send({ room: 'Bedroom' }).expect(400);
    await api().patch('/api/lighting/presence/Ghost').send({ enabled: false }).expect(404);
  });
});

describe('device management', () => {
  it('rename/remove validate input and forward to the bridge', async () => {
    await api().post('/api/lighting/devices/rename').send({ from: 'Lamp' }).expect(400);
    await api().post('/api/lighting/devices/remove').send({}).expect(400);

    await api().post('/api/lighting/devices/rename').send({ from: 'Lamp', to: 'Desk' }).expect(200);
    expect(ctx.client.published).toContainEqual({
      topic: 'zigbee2mqtt/bridge/request/device/rename', payload: { from: 'Lamp', to: 'Desk' },
    });
  });

  it('sensor settings are forwarded to the device', async () => {
    await api().post('/api/lighting/sensors/Hall Motion/set').send({ sensitivity: 'high' }).expect(200);
    expect(ctx.client.lastSet('Hall Motion')).toEqual({ sensitivity: 'high' });
  });

  it('exposes devices, sensors and state', async () => {
    const devices = (await api().get('/api/lighting/devices').expect(200)).body;
    expect(devices.bridgeOnline).toBe(true);
    expect(devices.devices.map((d: { friendly_name: string }) => d.friendly_name)).toContain('Lamp');

    const sensors = (await api().get('/api/lighting/sensors').expect(200)).body;
    expect(Object.keys(sensors)).toEqual(['Hall Motion']);
  });
});
