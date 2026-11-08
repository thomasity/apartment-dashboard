import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { bulb, id, motionSensor } from '../helpers/fakeMqtt';
import { readConfig, writeConfig } from '../helpers/config';
import { startApp } from '../helpers/app';

const LAMP = id('Lamp'), CEILING = id('Ceiling'), BEDSIDE = id('Bedside'), HALL_MOTION = id('Hall Motion');

let ctx: Awaited<ReturnType<typeof startApp>>;

beforeEach(async () => {
  writeConfig({
    lightingSchema: 2,
    rooms: {
      living:  { name: 'Living Room', devices: [LAMP, CEILING] },
      bedroom: { name: 'Bedroom',     devices: [BEDSIDE] },
    },
  });
  ctx = await startApp([bulb('Lamp'), bulb('Ceiling'), bulb('Bedside'), motionSensor('Hall Motion')]);
  ctx.client.reset();
});
afterEach(() => ctx.close());

const api = () => request(ctx.app);
const zones = async () => (await api().get('/api/lighting/zones').expect(200)).body;

describe('POST /api/lighting/set', () => {
  it('sets one bulb (by name or address) and starts a manual session for its room', async () => {
    await api().post('/api/lighting/set').send({ group: 'Lamp', brightness: 40 }).expect(200, { ok: true });
    expect(ctx.client.lastSet('Lamp')).toEqual({ state: 'ON', brightness: 102 });
    expect(ctx.client.setsFor('Ceiling')).toEqual([]);
    expect((await zones()).living).toMatchObject({ control: 'manual' });

    await api().post('/api/lighting/set').send({ group: CEILING, colorTemp: 0 }).expect(200);
    expect(ctx.client.lastSet('Ceiling')).toEqual({ color_temp: 454 });
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

  it('accepts a room by id or by name', async () => {
    await api().post('/api/lighting/set').send({ group: 'living', brightness: 10 }).expect(200);
    await api().post('/api/lighting/set').send({ group: 'bedroom', brightness: 10 }).expect(200);
    await api().post('/api/lighting/set').send({ group: 'living room', brightness: 20 }).expect(200);
    expect(ctx.client.lastSet('Lamp')).toEqual({ state: 'ON', brightness: 51 });
    expect(ctx.client.lastSet('Bedside')).toEqual({ state: 'ON', brightness: 25 });
  });

  it('404s on a name that is neither a light nor a room', async () => {
    await api().post('/api/lighting/set').send({ group: 'Garage', brightness: 10 }).expect(404);
  });

  it('rejects non-numeric values and clamps out-of-range ones', async () => {
    await api().post('/api/lighting/set').send({ group: 'Lamp', brightness: 'bright' }).expect(400);
    expect(ctx.client.setsFor('Lamp')).toEqual([]);

    await api().post('/api/lighting/set').send({ group: 'Lamp', brightness: 0, colorTemp: 250 }).expect(200);
    expect(ctx.client.lastSet('Lamp')).toEqual({ state: 'ON', brightness: 3, color_temp: 153 });
  });
});

describe('POST /api/lighting/power', () => {
  it('defaults to all bulbs', async () => {
    await api().post('/api/lighting/power').send({ on: false }).expect(200);
    expect((await api().get('/api/lighting/state')).body.poweredOff.sort()).toEqual([BEDSIDE, CEILING, LAMP].sort());
  });

  it('requires an explicit on/off instead of treating a missing value as off', async () => {
    await api().post('/api/lighting/power').send({ group: 'Lamp' }).expect(400);
    await api().post('/api/lighting/power').send({ group: 'Lamp', on: 'false' }).expect(400);
    expect((await api().get('/api/lighting/state')).body.poweredOff).toEqual([]);
  });

  it('accepts a room, and turning the room off ends its manual session', async () => {
    await api().post('/api/lighting/set').send({ group: 'living', brightness: 10 });
    await api().post('/api/lighting/power').send({ group: 'Living Room', on: false }).expect(200);
    expect((await api().get('/api/lighting/state')).body.poweredOff.sort()).toEqual([CEILING, LAMP].sort());
    expect((await zones()).living.control).toBe('none');
  });

  it('a manual off suppresses presence auto-on for that room', async () => {
    await api().post('/api/lighting/presence').send({ sensor: HALL_MOTION, room: 'living' }).expect(200);
    await api().post('/api/lighting/power').send({ group: 'living', on: false });
    ctx.client.reset();

    ctx.client.deliver('zigbee2mqtt/Hall Motion', { occupancy: true });
    expect(ctx.client.published).toEqual([]);

    const { body } = await api().get('/api/lighting/presence');
    expect(body[0].manualOffUntil).toBeGreaterThan(Date.now());
  });
});

describe('Auto and zones', () => {
  it('POST /auto puts a room on Auto, which ends any manual session', async () => {
    await api().post('/api/lighting/set').send({ group: 'Lamp', brightness: 10 });
    await api().post('/api/lighting/auto').send({ group: 'living', enabled: true }).expect(200);
    expect((await zones()).living).toMatchObject({ auto: true, control: 'auto' });
    expect(readConfig().autoZones).toEqual(['living']);

    await api().post('/api/lighting/auto').send({ group: 'Garage', enabled: true }).expect(404);
    await api().post('/api/lighting/auto').send({ group: 'living' }).expect(400);
  });

  it('POST /zones/:id/resume hands a room back immediately', async () => {
    await api().post('/api/lighting/auto').send({ group: 'living', enabled: false });
    await api().post('/api/lighting/set').send({ group: 'Lamp', brightness: 10 });
    expect((await zones()).living.control).toBe('manual');

    await api().post('/api/lighting/zones/living/resume').expect(200);
    expect((await zones()).living.control).toBe('none');
    await api().post('/api/lighting/zones/Garage/resume').expect(404);
  });

  it('resume also lets the motion sensor switch the room on again', async () => {
    await api().post('/api/lighting/presence').send({ sensor: HALL_MOTION, room: 'living' });
    await api().post('/api/lighting/power').send({ group: 'living', on: false });
    await api().post('/api/lighting/zones/Living Room/resume').send({ source: 'voice' }).expect(200);

    ctx.client.deliver('zigbee2mqtt/Hall Motion', { occupancy: true });
    expect((await api().get('/api/lighting/state')).body.poweredOff).not.toContain(LAMP);

    const [living] = (await api().get('/api/lighting/explain?group=living').expect(200)).body;
    expect(living.history.map((h: { text: string }) => h.text)).toEqual([
      'You turned it off',
      'You (voice) handed it back to automation',
      expect.stringMatching(/^Motion turned it on/),
    ]);
  });

  it('GET /circadian returns the Auto curve for today', async () => {
    const { body } = await api().get('/api/lighting/circadian').expect(200);
    expect(body.timeline).toHaveLength(24);
    expect(body.nextChange).toEqual(expect.any(String));
  });
});

describe('explain and the activity log', () => {
  it('records who made each change — dashboard by default, or voice', async () => {
    await api().post('/api/lighting/set').send({ group: 'living', brightness: 30, colorTemp: 10 });
    await api().post('/api/lighting/power').send({ group: 'Bedside', on: false, source: 'voice' });

    const all = (await api().get('/api/lighting/explain').expect(200)).body;
    const by = Object.fromEntries(all.map((z: { zone: string }) => [z.zone, z]));
    expect(by.living.history.map((h: { text: string }) => h.text)).toEqual(['You set it to 30% warm']);
    expect(by.living.reasons[0]).toMatch(/^You adjusted it at .*until it's turned off\.$/);
    expect(by.bedroom.history).toMatchObject([{ source: 'voice', text: 'You (voice) turned it off' }]);
    expect(by.bedroom.on).toBe(false);
  });

  it('404s on an unknown room', async () => {
    await api().get('/api/lighting/explain?group=Garage').expect(404);
  });
});

describe('suggestions', () => {
  it('none without history; dismiss/accept 404 on an unknown id', async () => {
    expect((await api().get('/api/lighting/suggestions').expect(200)).body).toBeNull();
    await api().post('/api/lighting/suggestions/nope/dismiss').send({}).expect(404);
    await api().post('/api/lighting/suggestions/nope/accept').expect(404);
  });
});

describe('room CRUD', () => {
  it('create returns the new id, and errors map to HTTP statuses', async () => {
    const { body } = await api().post('/api/lighting/rooms').send({ name: 'Kitchen' }).expect(200);
    expect(body.id).toMatch(/^room_/);

    await api().post('/api/lighting/rooms').send({}).expect(400);
    await api().post('/api/lighting/rooms').send({ name: 'bedroom' }).expect(409);
    await api().patch('/api/lighting/rooms/ghost').send({ name: 'X' }).expect(404);
    await api().patch('/api/lighting/rooms/bedroom').send({ name: 'Living Room' }).expect(409);
  });

  it('rename keeps the id; assign moves bulbs by address; changes are broadcast', async () => {
    const emit = vi.spyOn(ctx.io, 'emit');
    await api().patch('/api/lighting/rooms/bedroom').send({ name: 'Guest Room' }).expect(200);
    await api().post('/api/lighting/rooms/assign').send({ device: LAMP, room: 'bedroom' }).expect(200);

    expect(emit).toHaveBeenCalledWith('lighting:rooms', {
      living:  { name: 'Living Room', devices: [CEILING] },
      bedroom: { name: 'Guest Room',  devices: [BEDSIDE, LAMP] },
    });
    await api().post('/api/lighting/rooms/assign').send({ room: 'bedroom' }).expect(400);
    await api().post('/api/lighting/rooms/assign').send({ device: LAMP, room: 'ghost' }).expect(404);
  });

  it('delete removes the room', async () => {
    await api().delete('/api/lighting/rooms/bedroom').expect(200);
    expect(Object.keys((await api().get('/api/lighting/rooms')).body)).toEqual(['living']);
  });
});

describe('rules and presence CRUD', () => {
  it('rules: create, list, patch, 404 on unknown, 400 on bad input, delete', async () => {
    const { body: rule } = await api().post('/api/lighting/rules')
      .send({ name: 'Night', time: '23:00', end: '07:00', days: [0], action: { type: 'power', group: 'all', on: false }, presence: { mode: 'custom', brightness: 10 } })
      .expect(200);

    await api().patch(`/api/lighting/rules/${rule.id}`).send({ enabled: false }).expect(200);
    expect((await api().get('/api/lighting/rules')).body).toEqual([{ ...rule, enabled: false }]);

    await api().patch('/api/lighting/rules/nope').send({}).expect(404);
    await api().post('/api/lighting/rules').send({ name: 'Bad', time: 'noon', days: [0], action: { type: 'power', group: 'all' } }).expect(400);
    await api().delete(`/api/lighting/rules/${rule.id}`).expect(200);
    expect((await api().get('/api/lighting/rules')).body).toEqual([]);
  });

  it('every change is recorded with who made it, and any change can be undone', async () => {
    const off = { name: 'Night', time: '23:00', days: [0], action: { type: 'power', group: 'Living Room', on: false } };
    const { body: rule } = await api().post('/api/lighting/rules').set('X-Source', 'voice').send({ ...off, reason: 'you asked' }).expect(200);
    expect(rule).toMatchObject({ createdBy: 'voice', action: { group: 'living' } }); // stored by room id
    expect(rule).not.toHaveProperty('reason');

    await api().patch(`/api/lighting/rules/${rule.id}`).send({ time: '23:30' }).expect(200);
    await api().delete(`/api/lighting/rules/${rule.id}`).expect(200);

    const changes = (await api().get('/api/lighting/rule-changes').expect(200)).body;
    expect(changes.map((c: { change: string; by: string }) => `${c.change}/${c.by}`)).toEqual(['delete/dashboard', 'update/dashboard', 'create/voice']);
    expect(changes[2].reason).toBe('you asked');
    expect((await api().get('/api/lighting/rule-changes/removed')).body).toMatchObject([{ rule: { id: rule.id, time: '23:30' } }]);

    // Undo the delete: it's back, with the same id
    await api().post(`/api/lighting/rule-changes/${changes[0].id}/undo`).expect(200);
    expect((await api().get('/api/lighting/rules')).body).toMatchObject([{ id: rule.id, time: '23:30' }]);
    await api().post(`/api/lighting/rule-changes/${changes[0].id}/undo`).expect(409);
    // Undo the edit: back to 23:00
    await api().post(`/api/lighting/rule-changes/${changes[1].id}/undo`).expect(200);
    expect((await api().get('/api/lighting/rules')).body[0].time).toBe('23:00');
    expect((await api().get('/api/lighting/rule-changes/removed')).body).toEqual([]);
  });

  it('the assistant can\'t go past 15 rules, but you can', async () => {
    const rule = (i: number) => ({ name: `R${i}`, time: '12:00', days: [1], action: { type: 'power', group: 'all', on: true } });
    for (let i = 0; i < 15; i++) await api().post('/api/lighting/rules').send(rule(i)).expect(200);
    const { body } = await api().post('/api/lighting/rules').set('X-Source', 'voice').send(rule(15)).expect(409);
    expect(body.error).toMatch(/limit is 15/);
    await api().post('/api/lighting/rules').send(rule(15)).expect(200);
  });

  it('a rule for a name that matches nothing is a 404', async () => {
    await api().post('/api/lighting/rules')
      .send({ name: 'X', time: '12:00', days: [1], action: { type: 'power', group: 'Garage', on: true } }).expect(404);
  });

  it('presence: 400 on bad input, 404 on unknown sensor', async () => {
    await api().post('/api/lighting/presence').send({ room: 'bedroom' }).expect(400);
    await api().patch('/api/lighting/presence/0xghost').send({ enabled: false }).expect(404);
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

  it('a renamed bulb stays in its room', async () => {
    const devices = (await api().get('/api/lighting/devices')).body.devices;
    const renamed = devices.map((d: { friendly_name: string }) => d.friendly_name === 'Lamp' ? { ...d, friendly_name: 'Desk Lamp' } : d);
    ctx.client.deliver('zigbee2mqtt/bridge/devices', renamed);

    await api().post('/api/lighting/set').send({ group: 'living', brightness: 100 }).expect(200);
    expect(ctx.client.lastSet('Desk Lamp')).toEqual({ state: 'ON', brightness: 254 });
  });

  it('sensor settings are forwarded to the device', async () => {
    await api().post(`/api/lighting/sensors/${HALL_MOTION}/set`).send({ sensitivity: 'high' }).expect(200);
    expect(ctx.client.lastSet('Hall Motion')).toEqual({ sensitivity: 'high' });
  });

  it('exposes devices, sensors and state', async () => {
    const devices = (await api().get('/api/lighting/devices').expect(200)).body;
    expect(devices.bridgeOnline).toBe(true);
    expect(devices.devices.map((d: { friendly_name: string }) => d.friendly_name)).toContain('Lamp');

    const sensors = (await api().get('/api/lighting/sensors').expect(200)).body;
    expect(Object.keys(sensors)).toEqual([HALL_MOTION]);
  });
});

describe('before the id migration has run', () => {
  it('refuses changes until the bridge has sent its device list', async () => {
    await ctx.close();
    writeConfig({ rooms: { 'Living Room': ['Lamp'] } } as never);
    ctx = await startApp([]);
    await api().post('/api/lighting/power').send({ on: false }).expect(503);
    await api().get('/api/lighting/rooms').expect(200, {});
  });
});
