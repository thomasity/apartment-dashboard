// Wiring that lives in app.ts: socket.io pushes and the rule executor.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { io as connectSocket, type Socket } from 'socket.io-client';
import request from 'supertest';
import { mockAxios } from './helpers/http';
import { bulb, id } from './helpers/fakeMqtt';
import { readConfig, writeConfig } from './helpers/config';
import { startApp } from './helpers/app';

let ctx: Awaited<ReturnType<typeof startApp>>;
afterEach(async () => {
  vi.useRealTimers();
  await ctx?.close();
});

describe('socket.io', () => {
  let socket: Socket;
  afterEach(() => { socket?.disconnect(); });

  beforeEach(() => writeConfig({ lightingSchema: 2, rooms: { living: { name: 'Living Room', devices: [id('Lamp')] } } }));

  it('sends the full lighting snapshot on connect', async () => {
    ctx = await startApp();
    const url = await ctx.listen();
    socket = connectSocket(url, { transports: ['websocket'] });

    const received: Record<string, unknown> = {};
    await new Promise<void>((resolve) => {
      socket.onAny((event, payload) => {
        received[event] = payload;
        if (Object.keys(received).length === 5) resolve();
      });
    });

    expect(received['lighting:state']).toMatchObject({
      connected: true, groups: { [id('Lamp')]: { label: 'Lamp' }, [id('Ceiling')]: { label: 'Ceiling' } },
    });
    expect(received['lighting:devices']).toMatchObject({ bridgeOnline: true });
    expect(received['lighting:rooms']).toEqual({ living: { name: 'Living Room', devices: [id('Lamp')] } });
    expect(received['lighting:circadian']).toMatchObject({ nextChange: expect.any(String) });
    expect(received['lighting:zones']).toEqual({
      living:          { auto: false, control: 'none', ruleName: null, until: null, reason: null },
      [id('Ceiling')]: { auto: false, control: 'none', ruleName: null, until: null, reason: null },
    });
  });

  it('pushes bulb changes reported over MQTT to every dashboard', async () => {
    ctx = await startApp();
    const url = await ctx.listen();
    socket = connectSocket(url, { transports: ['websocket'] });
    await new Promise<void>((resolve) => socket.on('connect', () => resolve()));

    const update = new Promise((resolve) => socket.on('lighting:state', resolve));
    ctx.client.deliver('zigbee2mqtt/Lamp', { brightness: 254 });

    expect(await update).toMatchObject({ groups: { [id('Lamp')]: { brightness: 100 } } });
  });
});

describe('spotify over socket.io', () => {
  let socket: Socket;
  afterEach(() => { socket?.disconnect(); });

  it('pushes now-playing on connect, and again after a control command', async () => {
    let playing = true;
    mockAxios({
      'POST https://accounts.spotify.com/api/token': () => ({ access_token: 't', expires_in: 3600 }),
      'PUT https://api.spotify.com/v1/me/player/pause': () => { playing = false; return { status: 204 }; },
      'GET https://api.spotify.com/v1/me/player': () => ({
        is_playing: playing, progress_ms: 0,
        item: { type: 'track', id: 't', uri: 'spotify:track:t', name: 'Song', duration_ms: 200_000, artists: [] },
      }),
    });
    writeConfig();
    ctx = await startApp();
    const url = await ctx.listen();
    socket = connectSocket(url, { transports: ['websocket'] });

    const states: Array<{ isPlaying: boolean } | null> = [];
    const next = () => new Promise<void>((resolve) => socket.once('spotify:state', (s) => { states.push(s); resolve(); }));

    await next();
    expect(states[0]).toMatchObject({ isPlaying: true, item: { name: 'Song' } });

    const paused = next();
    await request(ctx.app).post('/api/spotify/pause').expect(200);
    await paused;
    expect(states[1]).toMatchObject({ isPlaying: false });
  });
});

describe('rule execution', () => {
  const MONDAY_0659 = new Date(2026, 9, 26, 6, 59, 55);
  const A = id('Lamp A'), B = id('Lamp B');
  const DEN = { den: { name: 'Den', devices: [A, B] } };

  async function fireRule(
    rule: object,
    rooms: object = {},
    before?: (app: typeof ctx) => void,
    extraConfig: object = {},
  ) {
    writeConfig({
      lightingSchema: 2,
      rooms,
      rules: [{ id: 'r1', name: 'Test', time: '07:00', days: [1], enabled: true, ...rule } as never],
      ...extraConfig,
    } as never);
    // Only fake the scheduler's clock — leave setTimeout alone for config debounce etc.
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    vi.setSystemTime(MONDAY_0659);
    ctx = await startApp([bulb('Lamp A'), bulb('Lamp B'), bulb('Other')]);
    before?.(ctx);
    ctx.client.reset();
    vi.advanceTimersByTime(10_000);
  }

  it('power on with a scene goes straight to the scene in one message', async () => {
    await fireRule(
      { action: { type: 'power', group: 'den', on: true, config: 'scene', brightness: 100, colorTemp: 0 } },
      DEN,
      ({ mgr }) => { mgr.setPower(A, false); mgr.setPower(B, false); },
    );
    expect(ctx.client.setsFor('Lamp A')).toEqual([{ state: 'ON', brightness: 254, color_temp: 454 }]);
    expect(ctx.client.setsFor('Lamp B')).toEqual([{ state: 'ON', brightness: 254, color_temp: 454 }]);
    expect(ctx.client.setsFor('Other')).toEqual([]);
  });

  it('an instant off keeps presence from switching the room back on', async () => {
    await fireRule(
      { action: { type: 'power', group: 'den', on: false } },
      DEN,
      undefined,
      { presence: { '0xdenmotion': { room: 'den', vacantAfterMinutes: 5, manualOffCooldownMinutes: 60, enabled: true } } },
    );
    const { body } = await request(ctx.app).get('/api/lighting/presence');
    expect(body[0].manualOffUntil).toBeGreaterThan(Date.now());
  });

  it('a windowed off leaves presence to the rule\'s own setting instead', async () => {
    await fireRule(
      { end: '09:00', action: { type: 'power', group: 'den', on: false }, presence: { mode: 'custom', brightness: 10 } },
      DEN,
      undefined,
      { presence: { '0xdenmotion': { room: 'den', vacantAfterMinutes: 5, manualOffCooldownMinutes: 60, enabled: true } } },
    );
    const { body } = await request(ctx.app).get('/api/lighting/presence');
    expect(body[0].manualOffUntil).toBeNull();
    expect((await request(ctx.app).get('/api/lighting/zones')).body.den).toMatchObject({ control: 'none' });
  });

  it('power off for "all" turns every bulb off', async () => {
    await fireRule({ action: { type: 'power', group: 'all', on: false } });
    for (const name of ['Lamp A', 'Lamp B', 'Other']) expect(ctx.client.lastSet(name)).toEqual({ state: 'OFF' });
  });

  it('a rule can target a single bulb that is not in any room', async () => {
    await fireRule({ action: { type: 'power', group: id('Other'), on: false } });
    expect(ctx.client.lastSet('Other')).toEqual({ state: 'OFF' });
    expect(ctx.client.setsFor('Lamp A')).toEqual([]);
  });

  it('reconfigure → auto puts the room on Auto', async () => {
    await fireRule({ action: { type: 'reconfigure', group: 'den', config: 'auto' } }, DEN);
    expect(readConfig().autoZones).toEqual(['den']);
    expect(ctx.client.setsFor('Lamp A').length).toBeGreaterThan(0);
    expect(ctx.client.setsFor('Other')).toEqual([]);
  });

  it('a windowed scene sets the room\'s look for its duration', async () => {
    await fireRule({ end: '08:00', action: { type: 'reconfigure', group: 'den', config: 'scene', brightness: 40, colorTemp: 10 } }, DEN);
    expect(ctx.client.lastSet('Lamp A')).toEqual({ state: 'ON', brightness: 102, color_temp: 424 });
    expect((await request(ctx.app).get('/api/lighting/zones')).body.den).toMatchObject({ control: 'rule', ruleName: 'Test' });
  });
});
