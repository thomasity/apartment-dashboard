import express, { type Response } from 'express';
import axios, { type Method } from 'axios';

const router = express.Router();

const CLIENT_ID     = process.env.SPOTIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;

// ── Spotify Web API shapes (only the fields this file reads) ──────────────────

interface SpImage   { url: string }
interface SpArtist  { name: string }
interface SpAlbum   { id: string; uri: string; name: string; artists: SpArtist[]; images?: SpImage[] }
interface SpShow    { id: string; uri: string; name: string; publisher: string; images?: SpImage[]; total_episodes: number }
interface SpTrack   { type: 'track'; id: string; uri: string; name: string; artists: SpArtist[]; album?: SpAlbum; duration_ms: number }
interface SpEpisode { type: 'episode'; id: string; uri: string; name: string; show?: SpShow; images?: SpImage[]; duration_ms: number }
interface SpPlaylist {
  id: string; uri: string; name: string; images?: SpImage[] | null;
  owner: { id: string }; collaborative: boolean; tracks?: { total: number };
}
interface SpDevice  { id: string; name: string; type: string; is_active: boolean; volume_percent: number }
interface SpPlayer {
  is_playing:     boolean;
  shuffle_state?: boolean;
  repeat_state?:  string;
  progress_ms?:   number;
  context?:       { type: string; uri: string } | null;
  item?:          SpTrack | SpEpisode | null;
  device?:        { name: string; volume_percent: number | null };
}
interface SpPage<T> { items: T[]; next: string | null; total: number }
interface SpSearch {
  tracks?:    SpPage<SpTrack>;
  albums?:    SpPage<SpAlbum>;
  playlists?: SpPage<SpPlaylist | null>;
  shows?:     SpPage<SpShow | null>;
  episodes?:  SpPage<SpEpisode | null>;
}

// ── Payloads sent to the client ───────────────────────────────────────────────

interface NowPlaying {
  isPlaying: boolean;
  shuffle:   boolean;
  repeat:    string;
  context:   { type: string; uri: string } | null;
  item: {
    uri:      string | null;
    name:     string | undefined;
    artist:   string | null;
    album:    string | null;
    art:      string | null;
    duration: number;
    progress: number;
    type:     string;
  };
  device: { name: string | undefined; volume: number };
}

interface PlaylistSummary { id: string; uri: string; name: string; image: string | null; total: number }
interface AlbumSummary    { id: string; uri: string; name: string; artist: string; image: string | null }

interface Cache<T> { data: T | null; at: number }

let accessToken: string | null = null;
let tokenExpiresAt = 0;

let nowPlayingCache: Cache<NowPlaying> = { data: null, at: 0 };
let nowPlayingBackoff  = 0;
const NOW_PLAYING_TTL  = 4_000;
const BACKOFF_DURATION = 30_000;

let playlistsCache: Cache<PlaylistSummary[]> = { data: null, at: 0 };
let albumsCache:    Cache<AlbumSummary[]>    = { data: null, at: 0 };
const LIBRARY_TTL  = 10 * 60 * 1000; // 10 minutes

const artistNames = (artists: SpArtist[]) => artists.map((a) => a.name).join(', ');

async function getAccessToken(): Promise<string> {
  if (Date.now() < tokenExpiresAt && accessToken) return accessToken;

  const { data } = await axios.post<{ access_token: string; expires_in: number }>(
    'https://accounts.spotify.com/api/token',
    new URLSearchParams({ grant_type: 'refresh_token', refresh_token: process.env.SPOTIFY_REFRESH_TOKEN ?? '' }),
    {
      headers: {
        'Content-Type':  'application/x-www-form-urlencoded',
        Authorization: `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64')}`,
      },
    },
  );

  accessToken    = data.access_token;
  tokenExpiresAt = Date.now() + (data.expires_in - 60) * 1000;
  return accessToken;
}

async function spotify<T = unknown>(method: Method, path: string, data?: unknown) {
  const token = await getAccessToken();
  return axios.request<T>({ method, url: `https://api.spotify.com/v1${path}`, data,
    headers: { Authorization: `Bearer ${token}` } });
}

// Spotify's Web API paginates list endpoints via a "next" URL — follow it until
// exhausted and return every item collected along the way.
async function fetchAllPages<T>(path: string): Promise<T[]> {
  const items: T[] = [];
  let url: string | null = path;
  while (url) {
    const { data }: { data: SpPage<T> } = await spotify<SpPage<T>>('GET', url);
    items.push(...data.items);
    url = data.next ? data.next.replace('https://api.spotify.com/v1', '') : null;
  }
  return items;
}

function spotifyError(label: string, err: unknown, res: Response): void {
  const response   = axios.isAxiosError(err) ? err.response : undefined;
  const status     = response?.status ?? 500;
  const retryAfter = response?.headers?.['retry-after'];
  const message    = response?.data?.error?.message ?? (err instanceof Error ? err.message : String(err));

  if (status === 429) {
    console.warn(`[spotify] ${label}: rate limited — Retry-After: ${retryAfter ?? 'unknown'}s`);
  } else {
    console.error(`[spotify] ${label}: HTTP ${status}`, response?.data ?? message);
  }

  res.status(status).json({ error: message, ...(retryAfter != null ? { retryAfter: Number(retryAfter) } : {}) });
}

router.get('/now-playing', async (_req, res) => {
  const now = Date.now();

  // Serve cached data during back-off or within TTL
  if (now < nowPlayingBackoff || now - nowPlayingCache.at < NOW_PLAYING_TTL) {
    return res.json(nowPlayingCache.data);
  }

  try {
    const { data } = await spotify<SpPlayer | ''>('GET', '/me/player?additional_types=track,episode');
    if (!data) {
      nowPlayingCache = { data: null, at: now };
      return res.json(null);
    }
    const item    = data.item;
    const episode = item?.type === 'episode' ? item : undefined;
    const track   = item?.type === 'track'   ? item : undefined;
    const payload: NowPlaying = {
      isPlaying: data.is_playing,
      shuffle:   data.shuffle_state ?? false,
      repeat:    data.repeat_state  ?? 'off',
      context: data.context ? { type: data.context.type, uri: data.context.uri } : null,
      item: {
        uri:      item?.uri ?? null,
        name:     item?.name,
        artist:   episode ? (episode.show?.name ?? null)          : (track ? artistNames(track.artists) : null),
        album:    episode ? (episode.show?.publisher ?? null)     : (track?.album?.name ?? null),
        art:      episode ? (episode.images?.[0]?.url ?? null)    : (track?.album?.images?.[0]?.url ?? null),
        duration: item?.duration_ms ?? 0,
        progress: data.progress_ms ?? 0,
        type:     item?.type ?? 'track',
      },
      device: {
        name:   data.device?.name,
        volume: data.device?.volume_percent ?? 100,
      },
    };
    nowPlayingCache = { data: payload, at: now };
    res.json(payload);
  } catch (err) {
    const status = axios.isAxiosError(err) ? err.response?.status : undefined;
    if (status === 204) {
      nowPlayingCache = { data: null, at: now };
      return res.json(null);
    }
    if (status === 429 && axios.isAxiosError(err)) {
      const retryAfter = err.response?.headers?.['retry-after'];
      const backoffMs  = retryAfter ? Number(retryAfter) * 1000 : BACKOFF_DURATION;
      nowPlayingBackoff = now + backoffMs;
      console.warn(`[spotify] now-playing: rate limited — Retry-After: ${retryAfter ?? '?'}s (backing off ${backoffMs / 1000}s)`);
      return res.json(nowPlayingCache.data);
    }
    spotifyError('now-playing', err, res);
  }
});

async function getPlayDeviceId(): Promise<string | null> {
  const targetName = process.env.SPOTIFY_DEVICE_NAME ?? 'raspotify';
  try {
    const { data } = await spotify<{ devices: SpDevice[] }>('GET', '/me/player/devices');
    const active = data.devices.find((d) => d.is_active);
    if (active) return null; // let Spotify keep using the active device
    const fallback = data.devices.find((d) =>
      d.name.toLowerCase().includes(targetName.toLowerCase()),
    );
    return fallback?.id ?? null;
  } catch {
    return null;
  }
}

interface PlayBody {
  context_uri?:     string;
  uris?:            string[];
  offset_uri?:      string;
  offset_position?: number;
}

router.post('/play', async (req, res) => {
  try {
    const reqBody = (req.body ?? {}) as PlayBody;
    const body: { context_uri?: string; uris?: string[]; offset?: { uri: string } | { position: number } } = {};
    if (reqBody.context_uri)              body.context_uri = reqBody.context_uri;
    if (reqBody.uris)                     body.uris        = reqBody.uris;
    if (reqBody.offset_uri)               body.offset      = { uri: reqBody.offset_uri };
    if (reqBody.offset_position != null)  body.offset      = { position: reqBody.offset_position };

    const deviceId = await getPlayDeviceId();
    const params = deviceId ? `?device_id=${deviceId}` : '';
    await spotify('PUT', `/me/player/play${params}`, Object.keys(body).length ? body : undefined);
    res.json({ ok: true });
  } catch (err) { spotifyError('play', err, res); }
});

router.get('/playlists', async (_req, res) => {
  if (playlistsCache.data && Date.now() - playlistsCache.at < LIBRARY_TTL) {
    return res.json(playlistsCache.data);
  }
  try {
    const { data: me } = await spotify<{ id: string }>('GET', '/me');
    const items = await fetchAllPages<SpPlaylist>('/me/playlists?limit=50');

    const owned = items.filter((pl) => pl.owner.id === me.id || pl.collaborative);
    const payload: PlaylistSummary[] = owned.map((pl) => ({
      id:    pl.id,
      uri:   pl.uri,
      name:  pl.name,
      image: pl.images?.[0]?.url ?? null,
      total: pl.tracks?.total ?? 0,
    }));
    playlistsCache = { data: payload, at: Date.now() };
    res.json(payload);
  } catch (err) { spotifyError('playlists', err, res); }
});

router.post('/pause',    async (_req, res) => {
  try { await spotify('PUT',  '/me/player/pause');    res.json({ ok: true }); }
  catch (err) { spotifyError('pause', err, res); }
});

router.post('/next',     async (_req, res) => {
  try { await spotify('POST', '/me/player/next');     res.json({ ok: true }); }
  catch (err) { spotifyError('next', err, res); }
});

router.post('/previous', async (_req, res) => {
  try { await spotify('POST', '/me/player/previous'); res.json({ ok: true }); }
  catch (err) { spotifyError('previous', err, res); }
});

router.post('/seek', async (req, res) => {
  try {
    const { position } = req.body as { position: number };
    await spotify('PUT', `/me/player/seek?position_ms=${position}`);
    res.json({ ok: true });
  } catch (err) { spotifyError('seek', err, res); }
});

router.post('/volume', async (req, res) => {
  try {
    const { volume } = req.body as { volume: number };
    await spotify('PUT', `/me/player/volume?volume_percent=${volume}`);
    res.json({ ok: true });
  } catch (err) { spotifyError('volume', err, res); }
});

router.get('/devices', async (_req, res) => {
  try {
    const { data } = await spotify<{ devices: SpDevice[] }>('GET', '/me/player/devices');
    res.json(data.devices.map((d) => ({
      id:       d.id,
      name:     d.name,
      type:     d.type.toLowerCase(),
      isActive: d.is_active,
      volume:   d.volume_percent,
    })));
  } catch (err) { spotifyError('devices', err, res); }
});

router.post('/shuffle', async (req, res) => {
  try {
    const { state } = req.body as { state: boolean };
    await spotify('PUT', `/me/player/shuffle?state=${state ? 'true' : 'false'}`);
    res.json({ ok: true });
  } catch (err) { spotifyError('shuffle', err, res); }
});

router.post('/repeat', async (req, res) => {
  try {
    const { state } = req.body as { state: 'off' | 'context' | 'track' };
    await spotify('PUT', `/me/player/repeat?state=${state}`);
    res.json({ ok: true });
  } catch (err) { spotifyError('repeat', err, res); }
});

router.get('/liked-songs', async (req, res) => {
  try {
    const countOnly = req.query.count_only === 'true';
    const [{ data: me }, { data: first }] = await Promise.all([
      spotify<{ id: string }>('GET', '/me'),
      spotify<SpPage<unknown>>('GET', '/me/tracks?limit=1'),
    ]);
    const collectionUri = `spotify:user:${me.id}:collection`;
    if (countOnly) return res.json({ total: first.total, collectionUri });

    const allItems = await fetchAllPages<{ track: SpTrack | null }>('/me/tracks?limit=50');
    res.json({
      total: first.total,
      collectionUri,
      tracks: allItems
        .map((i) => i.track)
        .filter((t): t is SpTrack => !!t?.id)
        .map((t) => ({
          id:       t.id,
          uri:      t.uri,
          name:     t.name,
          artist:   artistNames(t.artists),
          duration: t.duration_ms,
          art:      t.album?.images?.[2]?.url ?? t.album?.images?.[0]?.url ?? null,
        })),
    });
  } catch (err) { spotifyError('liked-songs', err, res); }
});

router.get('/shows', async (_req, res) => {
  try {
    const items = await fetchAllPages<{ show: SpShow }>('/me/shows?limit=50');
    res.json(items.map((i) => ({
      id:        i.show.id,
      uri:       i.show.uri,
      name:      i.show.name,
      publisher: i.show.publisher,
      image:     i.show.images?.[0]?.url ?? null,
      total:     i.show.total_episodes,
    })));
  } catch (err) { spotifyError('shows', err, res); }
});

router.get('/shows/:id/episodes', async (req, res) => {
  try {
    const items = await fetchAllPages<SpEpisode>(`/shows/${req.params.id}/episodes?limit=50&market=from_token`);
    res.json(items.map((ep) => ({
      id:       ep.id,
      uri:      ep.uri,
      name:     ep.name,
      duration: ep.duration_ms,
      art:      ep.images?.[0]?.url ?? null,
    })));
  } catch (err) { spotifyError('episodes', err, res); }
});

router.get('/albums', async (_req, res) => {
  if (albumsCache.data && Date.now() - albumsCache.at < LIBRARY_TTL) {
    return res.json(albumsCache.data);
  }
  try {
    const items = await fetchAllPages<{ album: SpAlbum }>('/me/albums?limit=50');
    const payload: AlbumSummary[] = items.map((i) => ({
      id:     i.album.id,
      uri:    i.album.uri,
      name:   i.album.name,
      artist: artistNames(i.album.artists),
      image:  i.album.images?.[0]?.url ?? null,
    }));
    albumsCache = { data: payload, at: Date.now() };
    res.json(payload);
  } catch (err) { spotifyError('albums', err, res); }
});

router.get('/album/:id/tracks', async (req, res) => {
  try {
    const [{ data: tracksData }, { data: albumData }] = await Promise.all([
      spotify<SpPage<SpTrack>>('GET', `/albums/${req.params.id}/tracks?limit=50`),
      spotify<SpAlbum>('GET', `/albums/${req.params.id}`),
    ]);
    const art = albumData.images?.[1]?.url ?? albumData.images?.[0]?.url ?? null;
    res.json(tracksData.items.map((t) => ({
      id:       t.id,
      uri:      t.uri,
      name:     t.name,
      artist:   artistNames(t.artists),
      duration: t.duration_ms,
      art,
    })));
  } catch (err) { spotifyError('album-tracks', err, res); }
});

router.get('/search', async (req, res) => {
  try {
    const q = String(req.query.q ?? '').trim();
    if (!q) return res.json({ tracks: [], albums: [], playlists: [], shows: [], episodes: [] });
    const { data } = await spotify<SpSearch>('GET', `/search?q=${encodeURIComponent(q)}&type=track,album,playlist,show,episode&limit=8`);
    const notNull = <T>(x: T | null): x is T => x !== null;
    res.json({
      tracks: (data.tracks?.items ?? []).map((t) => ({
        id:       t.id,
        uri:      t.uri,
        name:     t.name,
        artist:   artistNames(t.artists),
        duration: t.duration_ms,
        art:      t.album?.images?.[2]?.url ?? null,
      })),
      albums: (data.albums?.items ?? []).map((a) => ({
        id:     a.id,
        uri:    a.uri,
        name:   a.name,
        artist: artistNames(a.artists),
        image:  a.images?.[1]?.url ?? a.images?.[0]?.url ?? null,
      })),
      playlists: (data.playlists?.items ?? []).filter(notNull).map((p) => ({
        id:    p.id,
        uri:   p.uri,
        name:  p.name,
        image: p.images?.[0]?.url ?? null,
      })),
      shows: (data.shows?.items ?? []).filter(notNull).map((s) => ({
        id:        s.id,
        uri:       s.uri,
        name:      s.name,
        publisher: s.publisher,
        image:     s.images?.[0]?.url ?? null,
      })),
      episodes: (data.episodes?.items ?? []).filter(notNull).map((ep) => ({
        id:       ep.id,
        uri:      ep.uri,
        name:     ep.name,
        artist:   ep.show?.name ?? null,
        duration: ep.duration_ms,
        art:      ep.images?.[0]?.url ?? null,
      })),
    });
  } catch (err) { spotifyError('search', err, res); }
});

router.get('/playlist/:id/tracks', async (req, res) => {
  try {
    const allItems = await fetchAllPages<{ item: SpTrack | SpEpisode | null }>(`/playlists/${req.params.id}/items?limit=100`);
    res.json(
      allItems
        .map((i) => i.item)
        .filter((t): t is SpTrack => !!t?.id && t.type === 'track')
        .map((t) => ({
          id:       t.id,
          uri:      t.uri,
          name:     t.name,
          artist:   artistNames(t.artists),
          duration: t.duration_ms,
          art:      t.album?.images?.[2]?.url ?? t.album?.images?.[0]?.url ?? null,
        })),
    );
  } catch (err) { spotifyError('playlist-tracks', err, res); }
});

router.post('/transfer', async (req, res) => {
  try {
    const { deviceId, play } = req.body as { deviceId: string; play?: boolean };
    await spotify('PUT', '/me/player', { device_ids: [deviceId], play: play ?? false });
    res.json({ ok: true });
  } catch (err) { spotifyError('transfer', err, res); }
});

export default router;
