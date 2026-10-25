import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AxiosError } from 'axios';
import { mockAxios, type Call } from '../helpers/http';
import type { AppServer, NowPlaying } from '../../types';

const API = 'https://api.spotify.com/v1';

// What Spotify will report on the next poll — tests mutate this between ticks.
let player: Record<string, unknown> | null;
let internetUp: boolean;
let rateLimitNext: boolean;
let calls: Call[];

const track = (id: string, progress = 0, duration = 200_000) => ({
  is_playing: true, progress_ms: progress, device: { name: 'raspotify', volume_percent: 50 },
  item: { type: 'track', id, uri: `spotify:track:${id}`, name: id, duration_ms: duration, artists: [{ name: 'A' }] },
});

/** A stand-in for the socket.io server: records emits and lets tests "connect" sockets. */
function fakeIo() {
  let onConnection: (socket: { emit: (...a: unknown[]) => void }) => void = () => {};
  const io = {
    engine: { clientsCount: 0 },
    emit: vi.fn(),
    on: (_event: string, cb: typeof onConnection) => { onConnection = cb; },
    connect() {
      io.engine.clientsCount++;
      const socket = { emit: vi.fn() };
      onConnection(socket);
      return socket;
    },
  };
  return io;
}

async function setup() {
  vi.resetModules();
  const svc = await import('../../services/spotifyPlayer');
  const io  = fakeIo();
  svc.attach(io as unknown as AppServer);
  return { svc, io };
}

const pushes = (io: ReturnType<typeof fakeIo>) =>
  io.emit.mock.calls.filter(([e]) => e === 'spotify:state').map(([, s]) => s as NowPlaying | null);
const spotifyPolls = () => calls.filter((c) => c.url.startsWith(`${API}/me/player`)).length;

beforeEach(() => {
  vi.useFakeTimers();
  player = track('song-1');
  internetUp = true;
  rateLimitNext = false;
  const offline = () => { throw new AxiosError('getaddrinfo ENOTFOUND', 'ENOTFOUND'); };
  calls = mockAxios({
    'POST https://accounts.spotify.com/api/token': () => (internetUp ? { access_token: 't', expires_in: 3600 } : offline()),
    [`GET ${API}/me/player`]: () => {
      if (!internetUp) return offline();
      if (rateLimitNext) { rateLimitNext = false; return { status: 429, headers: { 'retry-after': '60' } }; }
      return player ?? { status: 204, data: '' };
    },
    'HEAD https://api.spotify.com/':    () => (internetUp ? '' : offline()),
    'HEAD https://api.open-meteo.com/': () => (internetUp ? '' : offline()),
  });
});
afterEach(() => vi.useRealTimers());

describe('lifecycle', () => {
  it('does not poll until a dashboard connects', async () => {
    await setup();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(spotifyPolls()).toBe(0);
  });

  it('polls on connect and pushes the first state', async () => {
    const { io } = await setup();
    io.connect();
    await vi.advanceTimersByTimeAsync(0);
    expect(pushes(io)).toEqual([expect.objectContaining({ isPlaying: true, item: expect.objectContaining({ name: 'song-1' }) })]);
  });

  it('pushes even "nothing playing" the first time, so dashboards can render', async () => {
    player = null;
    const { io } = await setup();
    io.connect();
    await vi.advanceTimersByTimeAsync(0);
    expect(pushes(io)).toEqual([null]);
  });

  it('sends the cached state straight to dashboards that connect later', async () => {
    const { io } = await setup();
    io.connect();
    await vi.advanceTimersByTimeAsync(0);
    const late = io.connect();
    expect(late.emit).toHaveBeenCalledWith('spotify:state', expect.objectContaining({ isPlaying: true }));
  });

  it('stops polling when the last dashboard disconnects, resumes on reconnect', async () => {
    const { io } = await setup();
    io.connect();
    await vi.advanceTimersByTimeAsync(0);
    io.engine.clientsCount = 0;
    await vi.advanceTimersByTimeAsync(5_000); // the pending tick sees nobody and stops
    const before = spotifyPolls();
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(spotifyPolls()).toBe(before);

    io.connect();
    await vi.advanceTimersByTimeAsync(0);
    expect(spotifyPolls()).toBe(before + 1);
  });
});

describe('adaptive interval', () => {
  it('polls every 5s while playing', async () => {
    const { io } = await setup();
    io.connect();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(5_000);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(spotifyPolls()).toBe(3);
  });

  it('polls every 30s while paused', async () => {
    player = { ...track('song-1'), is_playing: false };
    const { io } = await setup();
    io.connect();
    await vi.advanceTimersByTimeAsync(29_000);
    expect(spotifyPolls()).toBe(1);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(spotifyPolls()).toBe(2);
  });

  it('wakes up just after the current track should end', async () => {
    player = track('song-1', 198_000, 200_000); // 2s left
    const { io } = await setup();
    io.connect();
    await vi.advanceTimersByTimeAsync(0);
    player = track('song-2');
    await vi.advanceTimersByTimeAsync(3_500); // 2s + 1.5s slack, well before the 5s tick
    expect(pushes(io).at(-1)?.item.name).toBe('song-2');
  });

  it('a control command triggers a refresh within a second', async () => {
    player = { ...track('song-1'), is_playing: false };
    const { svc, io } = await setup();
    io.connect();
    await vi.advanceTimersByTimeAsync(0);

    player = track('song-1');
    svc.refreshSoon();
    await vi.advanceTimersByTimeAsync(600);
    expect(pushes(io).at(-1)?.isPlaying).toBe(true);
  });
});

describe('change detection', () => {
  it('does not push when only progress advanced as expected', async () => {
    const { io } = await setup();
    io.connect();
    await vi.advanceTimersByTimeAsync(0);
    player = track('song-1', 5_000);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(pushes(io)).toHaveLength(1);
  });

  it('pushes on a new track, pause, or volume change', async () => {
    const { io } = await setup();
    io.connect();
    await vi.advanceTimersByTimeAsync(0);

    player = track('song-2');
    await vi.advanceTimersByTimeAsync(5_000);
    player = { ...track('song-2', 5_000), device: { name: 'raspotify', volume_percent: 80 } };
    await vi.advanceTimersByTimeAsync(5_000);
    player = { ...track('song-2', 10_000), is_playing: false, device: { name: 'raspotify', volume_percent: 80 } };
    await vi.advanceTimersByTimeAsync(5_000);

    expect(pushes(io).map((s) => [s?.item.name, s?.isPlaying, s?.device.volume])).toEqual([
      ['song-1', true, 50], ['song-2', true, 50], ['song-2', true, 80], ['song-2', false, 80],
    ]);
  });

  it('pushes when progress jumps (someone seeked from another device)', async () => {
    const { io } = await setup();
    io.connect();
    await vi.advanceTimersByTimeAsync(0);
    player = track('song-1', 120_000);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(pushes(io).at(-1)?.item.progress).toBe(120_000);
  });
});

describe('failures', () => {
  it('honours Retry-After on a 429', async () => {
    const { io } = await setup();
    io.connect();
    await vi.advanceTimersByTimeAsync(0);

    rateLimitNext = true;
    await vi.advanceTimersByTimeAsync(5_000);  // poll #2 gets the 429
    await vi.advanceTimersByTimeAsync(59_000);
    expect(spotifyPolls()).toBe(2);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(spotifyPolls()).toBe(3);
  });

  it('goes quiet against Spotify while offline, and resumes when the internet returns', async () => {
    const { io } = await setup();
    io.connect();
    await vi.advanceTimersByTimeAsync(0);

    internetUp = false;
    await vi.advanceTimersByTimeAsync(5_000); // poll fails → connectivity probe says offline
    const pollsWhileOffline = spotifyPolls();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(spotifyPolls()).toBe(pollsWhileOffline);

    internetUp = true;
    player = track('song-2');
    await vi.advanceTimersByTimeAsync(15_000);
    expect(pushes(io).at(-1)?.item.name).toBe('song-2');
  });
});
