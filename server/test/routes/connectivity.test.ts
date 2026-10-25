import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { mockAxios } from '../helpers/http';
import { mountRouter } from '../helpers/router';

const SPOTIFY = 'HEAD https://api.spotify.com/';
const METEO   = 'HEAD https://api.open-meteo.com/';

let app: Express;

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  app = await mountRouter('/api/connectivity', () => import('../../routes/connectivity'));
});
afterEach(() => vi.useRealTimers());

const check = async () => (await request(app).get('/api/connectivity').expect(200)).body;

describe('GET /api/connectivity', () => {
  it('is offline when neither service can be reached', async () => {
    mockAxios({});
    expect(await check()).toEqual({ online: false });
  });

  it('is online if either service answers — even with an error status', async () => {
    mockAxios({ [METEO]: () => ({ status: 404 }) });
    expect(await check()).toEqual({ online: true });
  });

  it('caches the result for 15s', async () => {
    const calls = mockAxios({ [SPOTIFY]: () => '' });
    await check();
    vi.setSystemTime(Date.now() + 14_000);
    await check();
    expect(calls).toHaveLength(2); // one probe per URL

    vi.setSystemTime(Date.now() + 2_000);
    await check();
    expect(calls).toHaveLength(4);
  });

  it('notices when the internet comes back', async () => {
    let up = false;
    mockAxios({ [SPOTIFY]: () => { if (!up) throw new Error('getaddrinfo ENOTFOUND'); return ''; } });

    expect(await check()).toEqual({ online: false });
    up = true;
    vi.setSystemTime(Date.now() + 16_000);
    expect(await check()).toEqual({ online: true });
  });

  it('concurrent requests share a single probe', async () => {
    const calls = mockAxios({ [SPOTIFY]: () => '' });
    await Promise.all([check(), check(), check()]);
    expect(calls).toHaveLength(2);
  });
});
