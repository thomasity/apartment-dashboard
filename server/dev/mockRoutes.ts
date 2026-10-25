// Mock routes for the external services (MOCK=true): Spotify, Bluetooth, Roku, Open-Meteo,
// voice and the connectivity check. Mounted on /api before the real routers. Lighting is
// deliberately absent — it runs for real against fakeZigbee.ts.
//
// The mocks keep state, so controls behave: play/pause/skip/seek/volume push spotify:state
// over socket.io, launching a TV app changes what's "playing", pairing a speaker adds it.

import express, { type Request, type Response } from 'express';
import type { AppServer, NowPlaying } from '../types';
import * as mock from './mockData';

const MOCKED_PREFIXES = ['/spotify', '/bluetooth', '/tv', '/weather', '/voice', '/connectivity'];

const ok = (_req: Request, res: Response) => res.json({ ok: true });
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function createMockRouter(io: AppServer) {
  const router = express.Router();
  const spotify = spotifyPlayer(io);

  // ── Spotify ─────────────────────────────────────────────────────────────────
  router.get('/spotify/now-playing', (_req, res) => res.json(spotify.snapshot()));
  router.get('/spotify/devices',     (_req, res) => res.json(spotify.devices()));
  router.get('/spotify/playlists',   (_req, res) => res.json(mock.playlists));
  router.get('/spotify/albums',      (_req, res) => res.json(mock.albums));
  router.get('/spotify/shows',       (_req, res) => res.json(mock.shows));
  router.get('/spotify/playlist/:id/tracks', (req, res) => res.json(mock.playlistTracks[req.params.id] ?? []));
  router.get('/spotify/album/:id/tracks',    (req, res) => res.json(mock.albumTracks[req.params.id] ?? []));
  router.get('/spotify/shows/:id/episodes',  (req, res) => res.json(mock.showEpisodes[req.params.id] ?? []));
  router.get('/spotify/liked-songs', (req, res) => {
    const summary = { total: mock.likedTracks.length, collectionUri: mock.LIKED_COLLECTION_URI };
    res.json(req.query.count_only === 'true' ? summary : { ...summary, tracks: mock.likedTracks });
  });
  router.get('/spotify/search', (req, res) => {
    const q = String(req.query.q ?? '').trim().toLowerCase();
    const hit = (s: string) => s.toLowerCase().includes(q);
    if (!q) return res.json({ tracks: [], albums: [], playlists: [], shows: [], episodes: [] });
    res.json({
      tracks:    mock.allTracks().filter((t) => hit(t.name) || hit(t.artist)),
      albums:    mock.albums.filter((a) => hit(a.name) || hit(a.artist)),
      playlists: mock.playlists.filter((p) => hit(p.name)),
      shows:     mock.shows.filter((s) => hit(s.name) || hit(s.publisher)),
      episodes:  Object.values(mock.showEpisodes).flat().filter((e) => hit(e.name)).map((e) => ({ ...e, artist: null })),
    });
  });
  router.post('/spotify/play', (req, res) => {
    const { context_uri, offset_uri, uris } = (req.body ?? {}) as { context_uri?: string; offset_uri?: string; uris?: string[] };
    spotify.play(context_uri, offset_uri ?? uris?.[0]);
    res.json({ ok: true });
  });
  router.post('/spotify/pause',    (_req, res) => { spotify.update({ isPlaying: false }); res.json({ ok: true }); });
  router.post('/spotify/next',     (_req, res) => { spotify.skip(1);  res.json({ ok: true }); });
  router.post('/spotify/previous', (_req, res) => { spotify.skip(-1); res.json({ ok: true }); });
  router.post('/spotify/seek',     (req, res) => { spotify.seek(Number(req.body?.position_ms ?? req.body?.position ?? 0)); res.json({ ok: true }); });
  router.post('/spotify/volume',   (req, res) => { spotify.volume(Number(req.body?.volume ?? req.body?.volume_percent ?? 50)); res.json({ ok: true }); });
  router.post('/spotify/shuffle',  (req, res) => { spotify.update({ shuffle: Boolean(req.body?.state) }); res.json({ ok: true }); });
  router.post('/spotify/repeat',   (req, res) => { spotify.update({ repeat: String(req.body?.state ?? 'off') }); res.json({ ok: true }); });
  router.post('/spotify/transfer', (req, res) => { spotify.transfer(String(req.body?.deviceId), Boolean(req.body?.play)); res.json({ ok: true }); });

  // ── Bluetooth ───────────────────────────────────────────────────────────────
  const paired = structuredClone(mock.bluetoothPaired);
  router.get('/bluetooth/devices', (_req, res) => res.json(paired));
  router.get('/bluetooth/scan', async (_req, res) => {
    await delay(1500); // the real scan takes a while; let the UI show its scanning state
    res.json(mock.bluetoothDiscovered.filter((d) => !paired.some((p) => p.mac === d.mac)));
  });
  router.post('/bluetooth/pair', (req, res) => {
    const found = mock.bluetoothDiscovered.find((d) => d.mac === req.body?.mac);
    if (found && !paired.some((p) => p.mac === found.mac)) paired.push({ mac: found.mac, name: found.name ?? found.mac, connected: true });
    res.json({ ok: true });
  });
  const setConnected = (connected: boolean) => (req: Request, res: Response) => {
    const d = paired.find((p) => p.mac === req.body?.mac);
    if (d) d.connected = connected;
    res.json({ ok: true });
  };
  router.post('/bluetooth/connect',    setConnected(true));
  router.post('/bluetooth/disconnect', setConnected(false));
  router.delete('/bluetooth/device/:mac', (req, res) => {
    const i = paired.findIndex((p) => p.mac === req.params.mac);
    if (i >= 0) paired.splice(i, 1);
    res.json({ ok: true });
  });

  // ── TV / Roku ───────────────────────────────────────────────────────────────
  let tvDevice: { ip: string; name: string } | null = { ip: mock.tvDiscovered[0]!.ip, name: mock.tvDiscovered[0]!.name };
  let tvApp = mock.tvApps[0]!;
  let tvStartedAt = Date.now() - 12 * 60_000;
  const TV_DURATION = 47 * 60; // seconds
  router.get('/tv/status', (_req, res) => {
    const position = Math.floor((Date.now() - tvStartedAt) / 1000) % TV_DURATION;
    res.json({ appId: tvApp.id, appName: tvApp.name, playerState: 'play', position, duration: TV_DURATION });
  });
  router.get('/tv/apps',        (_req, res) => res.json(mock.tvApps));
  router.get('/tv/icon/:appId', (_req, res) => res.status(404).end()); // the UI falls back to the app name
  router.get('/tv/discover',    async (_req, res) => { await delay(1000); res.json(mock.tvDiscovered); });
  router.get('/tv/device',      (_req, res) => res.json(tvDevice));
  router.post('/tv/select', (req, res) => {
    tvDevice = { ip: String(req.body?.ip), name: String(req.body?.name ?? req.body?.ip) };
    res.json({ ok: true });
  });
  router.post('/tv/launch/:appId', (req, res) => {
    tvApp = mock.tvApps.find((a) => a.id === req.params.appId) ?? tvApp;
    tvStartedAt = Date.now();
    res.json({ ok: true });
  });
  router.post('/tv/power-on',      ok);
  router.post('/tv/keypress/:key', ok);
  router.post('/tv/type',          ok);
  router.post('/tv/search',        ok);

  // ── Weather ─────────────────────────────────────────────────────────────────
  router.get('/weather', (_req, res) => res.json(mock.weather()));

  // ── Voice ───────────────────────────────────────────────────────────────────
  router.get('/voice/voices', (_req, res) => res.json({
    active: 'Rachel',
    voices: [{ name: 'Rachel', description: 'Mock voice', active: true }],
  }));
  router.post('/voice/chat', async (req, res) => {
    await delay(800);
    const message = String(req.body?.message ?? '');
    res.json({ reply: `Mock mode — I heard "${message}".`, keepListening: false });
  });
  // Half a second of silence, so the speaking state plays out and ends normally
  router.post('/voice/speak', (_req, res) => {
    res.set('Content-Type', 'audio/wav');
    res.send(silentWav(0.5));
  });

  // ── Connectivity ────────────────────────────────────────────────────────────
  router.get('/connectivity', (_req, res) => res.json({ online: true }));

  // Anything else under a mocked service must not fall through to the real routes,
  // which would try to reach Spotify / the Roku / the internet.
  router.use(MOCKED_PREFIXES, (req, res) => {
    console.warn(`[mock] no mock for ${req.method} /api${req.originalUrl.slice(4)}`);
    res.status(501).json({ error: `No mock for ${req.method} ${req.originalUrl}` });
  });

  return { router, spotifySnapshot: () => spotify.snapshot() };
}

// ── Spotify player simulation ─────────────────────────────────────────────────

function spotifyPlayer(io: AppServer) {
  let state: NowPlaying = mock.initialNowPlaying();
  let since = Date.now(); // when state.item.progress was last accurate
  const devices = structuredClone(mock.spotifyDevices);

  const progress = () => Math.min(state.item.progress + (state.isPlaying ? Date.now() - since : 0), state.item.duration);

  function snapshot(): NowPlaying {
    return { ...state, item: { ...state.item, progress: progress() } };
  }

  function push(): void {
    state = snapshot();
    since = Date.now();
    io.emit('spotify:state', state);
  }

  function queue(): mock.MockTrack[] {
    const uri = state.context?.uri ?? '';
    const id  = uri.split(':').pop() ?? '';
    if (uri === mock.LIKED_COLLECTION_URI) return mock.likedTracks;
    if (uri.startsWith('spotify:playlist:')) return mock.playlistTracks[id] ?? [];
    if (uri.startsWith('spotify:album:'))    return mock.albumTracks[id] ?? [];
    return mock.allTracks();
  }

  function load(t: { uri: string; name: string; artist?: string | null; duration: number }, type = 'track'): void {
    state.item = { uri: t.uri, name: t.name, artist: t.artist ?? null, album: null, art: null, duration: t.duration, progress: 0, type };
    since = Date.now();
  }

  function skip(dir: 1 | -1): void {
    const q = queue();
    if (!q.length) return;
    const i = q.findIndex((t) => t.uri === state.item.uri);
    const next = state.shuffle ? Math.floor(Math.random() * q.length) : (i + dir + q.length) % q.length;
    load(q[next]!);
    state.isPlaying = true;
    push();
  }

  // Auto-advance at the end of a track, the way a real player would
  setInterval(() => {
    if (!state.isPlaying || progress() < state.item.duration) return;
    if (state.repeat === 'track') { state.item.progress = 0; since = Date.now(); push(); }
    else skip(1);
  }, 1000).unref();

  return {
    snapshot,
    devices: () => devices,
    update(patch: Partial<NowPlaying>): void {
      state = { ...snapshot(), ...patch };
      push();
    },
    play(contextUri?: string, itemUri?: string): void {
      state = snapshot();
      if (contextUri) state.context = { type: contextUri.split(':')[1] ?? 'playlist', uri: contextUri };
      const episode = Object.values(mock.showEpisodes).flat().find((e) => e.uri === itemUri);
      const target  = episode ?? (itemUri ? mock.allTracks().find((t) => t.uri === itemUri) : contextUri ? queue()[0] : undefined);
      if (target) load(target, episode ? 'episode' : 'track');
      state.isPlaying = true;
      push();
    },
    skip,
    seek(ms: number): void {
      state.item.progress = Math.max(0, Math.min(ms, state.item.duration));
      since = Date.now();
      push();
    },
    volume(v: number): void {
      state.device.volume = v;
      const active = devices.find((d) => d.isActive);
      if (active) active.volume = v;
      push();
    },
    transfer(deviceId: string, play: boolean): void {
      const target = devices.find((d) => d.id === deviceId);
      if (!target) return;
      devices.forEach((d) => { d.isActive = d === target; });
      state = { ...snapshot(), device: { name: target.name, volume: target.volume } };
      if (play) state.isPlaying = true;
      push();
    },
  };
}

function silentWav(seconds: number): Buffer {
  const rate = 8000, samples = Math.round(rate * seconds);
  const buf = Buffer.alloc(44 + samples); // 8-bit mono; silence is 128
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + samples, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate, 28); buf.writeUInt16LE(1, 32); buf.writeUInt16LE(8, 34);
  buf.write('data', 36); buf.writeUInt32LE(samples, 40);
  buf.fill(128, 44);
  return buf;
}
