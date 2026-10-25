// Wiring that lives in app.ts: socket.io pushes and the rule executor.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { io as connectSocket, type Socket } from 'socket.io-client';
import request from 'supertest';
import { mockAxios } from './helpers/http';
import { bulb } from './helpers/fakeMqtt';
import { writeConfig } from './helpers/config';
import { startApp } from './helpers/app';

let ctx: Awaited<ReturnType<typeof startApp>>;
afterEach(async () => {
  vi.useRealTimers();
  await ctx?.close();
});

describe('socket.io', () => {
  let socket: Socket;
  afterEach(() => { socket?.disconnect(); });

  beforeEach(() => writeConfig({ rooms: { 'Living Room': ['Lamp'] } }));

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

    expect(received['lighting:state']).toMatchObject({ connected: true, groups: { Lamp: {}, Ceiling: {} } });
    expect(received['lighting:devices']).toMatchObject({ bridgeOnline: true });
    expect(received['lighting:rooms']).toEqual({ 'Living Room': ['Lamp'] });
    expect(received['lighting:circadian']).toMatchObject({ enabledGroups: [] });
    expect(received['lighting:override']).toEqual({});
  });

  it('pushes bulb changes reported over MQTT to every dashboard', async () => {
    ctx = await startApp();
    const url = await ctx.listen();
    socket = connectSocket(url, { transports: ['websocket'] });
    await new Promise<void>((resolve) => socket.on('connect', () => resolve()));

    const update = new Promise((resolve) => socket.on('lighting:state', resolve));
    ctx.client.deliver('zigbee2mqtt/Lamp', { brightness: 254 });

    expect(await update).toMatchObject({ groups: { Lamp: { brightness: 100 } } });
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

  async function fireRule(action: object, rooms: Record<string, string[]> = {}) {
    writeConfig({
      rooms,
      rules: [{ id: 'r1', name: 'Test', time: '07:00', days: [1], enabled: true, action } as never],
    });
    // Only fake the scheduler's clock — leave setTimeout alone for config debounce etc.
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    vi.setSystemTime(MONDAY_0659);
    ctx = await startApp([bulb('Lamp A'), bulb('Lamp B'), bulb('Other')]);
    ctx.client.reset();
    vi.advanceTimersByTime(10_000);
  }

  it('power on with a scene applies brightness/colorTemp to a room\'s devices', async () => {
    await fireRule(
      { type: 'power', group: 'Den', on: true, config: 'scene', brightness: 100, colorTemp: 0 },
      { Den: ['Lamp A', 'Lamp B'] },
    );
    expect(ctx.client.lastSet('Lamp A')).toEqual({ state: 'ON', brightness: 254, color_temp: 454 });
    expect(ctx.client.lastSet('Lamp B')).toEqual({ state: 'ON', brightness: 254, color_temp: 454 });
    expect(ctx.client.setsFor('Other')).toEqual([]);
  });

  it('power off for "all" turns every bulb off', async () => {
    await fireRule({ type: 'power', group: 'all', on: false });
    for (const name of ['Lamp A', 'Lamp B', 'Other']) expect(ctx.client.lastSet(name)).toEqual({ state: 'OFF' });
  });

  it('a rule can target a single bulb that is not in any room', async () => {
    await fireRule({ type: 'power', group: 'Other', on: false });
    expect(ctx.client.lastSet('Other')).toEqual({ state: 'OFF' });
    expect(ctx.client.setsFor('Lamp A')).toEqual([]);
  });

  it('reconfigure → auto puts a room\'s devices on circadian', async () => {
    await fireRule({ type: 'reconfigure', group: 'Den', config: 'auto' }, { Den: ['Lamp A', 'Lamp B'] });
    const circadian = await import('../services/circadian');
    expect(circadian.getState().enabledGroups.sort()).toEqual(['Lamp A', 'Lamp B']);
    expect(ctx.client.setsFor('Lamp A').length).toBeGreaterThan(0);
    expect(ctx.client.setsFor('Other')).toEqual([]);
  });
});
