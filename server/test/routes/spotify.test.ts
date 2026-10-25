import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { mockAxios, type Call } from '../helpers/http';
import { mountRouter } from '../helpers/router';

const API   = 'https://api.spotify.com/v1';
const TOKEN = 'POST https://accounts.spotify.com/api/token';
const token = () => ({ access_token: 'tok-1', expires_in: 3600 });

const player = {
  is_playing: true, shuffle_state: true, repeat_state: 'context', progress_ms: 1234,
  context: { type: 'playlist', uri: 'spotify:playlist:abc', href: 'ignored' },
  item: {
    type: 'track', id: 't1', uri: 'spotify:track:t1', name: 'Song', duration_ms: 200000,
    artists: [{ name: 'A' }, { name: 'B' }],
    album: { id: 'al', uri: 'spotify:album:al', name: 'Album', artists: [], images: [{ url: 'big.jpg' }] },
  },
  device: { name: 'raspotify', volume_percent: 55 },
};

const apiCalls = (calls: Call[]) => calls.filter((c) => c.url.startsWith(API)).map((c) => `${c.method} ${c.url.slice(API.length)}`);

let app: Express;

beforeEach(async () => {
  process.env.SPOTIFY_CLIENT_ID     = 'id';
  process.env.SPOTIFY_CLIENT_SECRET = 'secret';
  process.env.SPOTIFY_REFRESH_TOKEN = 'refresh';
  vi.useFakeTimers({ toFake: ['Date'] });
  app = await mountRouter('/api/spotify', () => import('../../routes/spotify'));
});
afterEach(() => vi.useRealTimers());

describe('auth', () => {
  it('exchanges the refresh token once and reuses the access token', async () => {
    const calls = mockAxios({ [TOKEN]: token, [`GET ${API}/me/player/devices`]: () => ({ devices: [] }) });
    await request(app).get('/api/spotify/devices').expect(200);
    await request(app).get('/api/spotify/devices').expect(200);

    const tokenCalls = calls.filter((c) => c.url.includes('accounts.spotify.com'));
    expect(tokenCalls).toHaveLength(1);
    expect(tokenCalls[0]!.headers.Authorization).toBe(`Basic ${Buffer.from('id:secret').toString('base64')}`);
    expect(String(tokenCalls[0]!.data)).toBe('grant_type=refresh_token&refresh_token=refresh');
    expect(calls.at(-1)!.headers.Authorization).toBe('Bearer tok-1');
  });

  it('refreshes once the token is about to expire', async () => {
    const calls = mockAxios({ [TOKEN]: token, [`GET ${API}/me/player/devices`]: () => ({ devices: [] }) });
    await request(app).get('/api/spotify/devices');
    vi.setSystemTime(Date.now() + 3541 * 1000); // within the 60s safety margin
    await request(app).get('/api/spotify/devices');
    expect(calls.filter((c) => c.url.includes('accounts.spotify.com'))).toHaveLength(2);
  });
});

describe('GET /api/spotify/now-playing', () => {
  it('flattens the player response for the dashboard', async () => {
    mockAxios({ [TOKEN]: token, [`GET ${API}/me/player`]: () => player });
    const { body } = await request(app).get('/api/spotify/now-playing').expect(200);
    expect(body).toEqual({
      isPlaying: true, shuffle: true, repeat: 'context',
      context: { type: 'playlist', uri: 'spotify:playlist:abc' },
      item: { uri: 'spotify:track:t1', name: 'Song', artist: 'A, B', album: 'Album', art: 'big.jpg', duration: 200000, progress: 1234, type: 'track' },
      device: { name: 'raspotify', volume: 55 },
    });
  });

  it('shows podcast episodes with the show as the "artist"', async () => {
    mockAxios({
      [TOKEN]: token,
      [`GET ${API}/me/player`]: () => ({
        ...player,
        item: { type: 'episode', id: 'e1', uri: 'spotify:episode:e1', name: 'Ep 1', duration_ms: 1, images: [{ url: 'ep.jpg' }],
                show: { name: 'The Show', publisher: 'Pub' } },
      }),
    });
    const { body } = await request(app).get('/api/spotify/now-playing');
    expect(body.item).toMatchObject({ name: 'Ep 1', artist: 'The Show', album: 'Pub', art: 'ep.jpg', type: 'episode' });
  });

  it('returns null when nothing is playing', async () => {
    mockAxios({ [TOKEN]: token, [`GET ${API}/me/player`]: () => ({ status: 204, data: '' }) });
    const { body } = await request(app).get('/api/spotify/now-playing').expect(200);
    expect(body).toBeNull();
  });

  it('caches for 4s so polling dashboards do not hammer the API', async () => {
    const calls = mockAxios({ [TOKEN]: token, [`GET ${API}/me/player`]: () => player });
    await request(app).get('/api/spotify/now-playing');
    vi.setSystemTime(Date.now() + 3000);
    await request(app).get('/api/spotify/now-playing');
    expect(apiCalls(calls)).toHaveLength(1);

    vi.setSystemTime(Date.now() + 2000);
    await request(app).get('/api/spotify/now-playing');
    expect(apiCalls(calls)).toHaveLength(2);
  });

  it('on 429, serves the last good value and backs off for Retry-After', async () => {
    let limited = false;
    const calls = mockAxios({
      [TOKEN]: token,
      [`GET ${API}/me/player`]: () => limited ? { status: 429, headers: { 'retry-after': '20' } } : player,
    });
    await request(app).get('/api/spotify/now-playing');
    limited = true;
    vi.setSystemTime(Date.now() + 5000);

    const { body } = await request(app).get('/api/spotify/now-playing').expect(200);
    expect(body.item.name).toBe('Song');

    vi.setSystemTime(Date.now() + 15_000); // still inside the 20s back-off
    await request(app).get('/api/spotify/now-playing');
    expect(apiCalls(calls)).toHaveLength(2);
  });
});

describe('playback control', () => {
  it('play targets the Pi when no device is active', async () => {
    const calls = mockAxios({
      [TOKEN]: token,
      [`GET ${API}/me/player/devices`]: () => ({ devices: [
        { id: 'phone', name: 'iPhone', type: 'Smartphone', is_active: false, volume_percent: 1 },
        { id: 'pi',    name: 'raspotify (apartment)', type: 'Speaker', is_active: false, volume_percent: 1 },
      ] }),
      [`PUT ${API}/me/player/play`]: () => ({ status: 204 }),
    });
    await request(app).post('/api/spotify/play').send({ context_uri: 'spotify:playlist:x', offset_position: 3 }).expect(200);

    const play = calls.find((c) => c.method === 'PUT')!;
    expect(play.url).toBe(`${API}/me/player/play?device_id=pi`);
    expect(play.data).toEqual({ context_uri: 'spotify:playlist:x', offset: { position: 3 } });
  });

  it('play leaves the active device alone', async () => {
    const calls = mockAxios({
      [TOKEN]: token,
      [`GET ${API}/me/player/devices`]: () => ({ devices: [{ id: 'phone', name: 'iPhone', type: 'x', is_active: true, volume_percent: 1 }] }),
      [`PUT ${API}/me/player/play`]: () => ({ status: 204 }),
    });
    await request(app).post('/api/spotify/play').send({}).expect(200);
    const play = calls.find((c) => c.method === 'PUT')!;
    expect(play.url).toBe(`${API}/me/player/play`);
    expect(play.data).toBeUndefined();
  });

  it('simple controls map to the right Spotify calls', async () => {
    const calls = mockAxios({ [TOKEN]: token, [`PUT ${API}/`]: () => ({ status: 204 }), [`POST ${API}/`]: () => ({ status: 204 }) });
    await request(app).post('/api/spotify/pause');
    await request(app).post('/api/spotify/next');
    await request(app).post('/api/spotify/volume').send({ volume: 30 });
    await request(app).post('/api/spotify/shuffle').send({ state: false });
    await request(app).post('/api/spotify/seek').send({ position: 5000 });
    await request(app).post('/api/spotify/transfer').send({ deviceId: 'pi' });

    expect(apiCalls(calls)).toEqual([
      'PUT /me/player/pause',
      'POST /me/player/next',
      'PUT /me/player/volume?volume_percent=30',
      'PUT /me/player/shuffle?state=false',
      'PUT /me/player/seek?position_ms=5000',
      'PUT /me/player',
    ]);
    expect(calls.at(-1)!.data).toEqual({ device_ids: ['pi'], play: false });
  });

  it('passes Spotify errors through with their status and message', async () => {
    mockAxios({
      [TOKEN]: token,
      [`PUT ${API}/me/player/pause`]: () => ({ status: 404, data: { error: { message: 'No active device' } } }),
      [`POST ${API}/me/player/next`]: () => ({ status: 429, headers: { 'retry-after': '7' } }),
    });
    const pause = await request(app).post('/api/spotify/pause').expect(404);
    expect(pause.body).toEqual({ error: 'No active device' });

    const next = await request(app).post('/api/spotify/next').expect(429);
    expect(next.body.retryAfter).toBe(7);
  });
});

describe('library', () => {
  it('playlists follow pagination and only include ones you own or collaborate on', async () => {
    const pl = (id: string, owner: string, collaborative = false) =>
      ({ id, uri: `spotify:playlist:${id}`, name: id, owner: { id: owner }, collaborative, tracks: { total: 1 } });
    const calls = mockAxios({
      [TOKEN]: token,
      [`GET ${API}/me/playlists?limit=50&offset=50`]: () => ({ items: [pl('mine2', 'me'), pl('collab', 'bob', true)], next: null }),
      [`GET ${API}/me/playlists`]: () => ({ items: [pl('mine1', 'me'), pl('followed', 'bob')], next: `${API}/me/playlists?limit=50&offset=50` }),
      [`GET ${API}/me`]: () => ({ id: 'me' }),
    });
    const { body } = await request(app).get('/api/spotify/playlists').expect(200);
    expect(body.map((p: { id: string }) => p.id)).toEqual(['mine1', 'mine2', 'collab']);

    // Cached for 10 minutes
    await request(app).get('/api/spotify/playlists');
    expect(apiCalls(calls).filter((c) => c.includes('playlists'))).toHaveLength(2);
  });

  it('search with an empty query short-circuits', async () => {
    const calls = mockAxios({});
    const { body } = await request(app).get('/api/spotify/search?q=%20').expect(200);
    expect(body).toEqual({ tracks: [], albums: [], playlists: [], shows: [], episodes: [] });
    expect(calls).toEqual([]);
  });

  it('search drops the null entries Spotify sometimes returns', async () => {
    mockAxios({
      [TOKEN]: token,
      [`GET ${API}/search`]: () => ({
        playlists: { items: [null, { id: 'p', uri: 'u', name: 'P', images: null, owner: { id: 'x' }, collaborative: false }] },
      }),
    });
    const { body } = await request(app).get('/api/spotify/search?q=chill').expect(200);
    expect(body.playlists).toEqual([{ id: 'p', uri: 'u', name: 'P', image: null }]);
  });
});
