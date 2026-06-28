const express = require('express');
const axios   = require('axios');
const router  = express.Router();

const CLIENT_ID     = process.env.SPOTIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;

let accessToken    = null;
let tokenExpiresAt = 0;

let nowPlayingCache    = { data: null, at: 0 };
let nowPlayingBackoff  = 0;
const NOW_PLAYING_TTL  = 4_000;
const BACKOFF_DURATION = 30_000;

let playlistsCache = { data: null, at: 0 };
let albumsCache    = { data: null, at: 0 };
const LIBRARY_TTL  = 10 * 60 * 1000; // 10 minutes

async function getAccessToken() {
  if (Date.now() < tokenExpiresAt && accessToken) return accessToken;

  const { data } = await axios.post(
    'https://accounts.spotify.com/api/token',
    new URLSearchParams({ grant_type: 'refresh_token', refresh_token: process.env.SPOTIFY_REFRESH_TOKEN }),
    {
      headers: {
        'Content-Type':  'application/x-www-form-urlencoded',
        Authorization: `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64')}`,
      },
    }
  );

  accessToken    = data.access_token;
  tokenExpiresAt = Date.now() + (data.expires_in - 60) * 1000;
  return accessToken;
}

async function spotify(method, path, data) {
  const token = await getAccessToken();
  return axios({ method, url: `https://api.spotify.com/v1${path}`, data,
    headers: { Authorization: `Bearer ${token}` } });
}

function spotifyError(label, err, res) {
  const status     = err.response?.status ?? 500;
  const retryAfter = err.response?.headers?.['retry-after'];
  const message    = err.response?.data?.error?.message ?? err.message;

  if (status === 429) {
    console.warn(`[spotify] ${label}: rate limited — Retry-After: ${retryAfter ?? 'unknown'}s`);
  } else {
    console.error(`[spotify] ${label}: HTTP ${status}`, err.response?.data ?? err.message);
  }

  res.status(status).json({ error: message, ...(retryAfter != null ? { retryAfter: Number(retryAfter) } : {}) });
}

router.get('/now-playing', async (req, res) => {
  const now = Date.now();

  // Serve cached data during back-off or within TTL
  if (now < nowPlayingBackoff || now - nowPlayingCache.at < NOW_PLAYING_TTL) {
    return res.json(nowPlayingCache.data);
  }

  try {
    const { data } = await spotify('GET', '/me/player?additional_types=track,episode');
    if (!data) {
      nowPlayingCache = { data: null, at: now };
      return res.json(null);
    }
    const item      = data.item;
    const isEpisode = item?.type === 'episode';
    const payload = {
      isPlaying: data.is_playing,
      shuffle:   data.shuffle_state ?? false,
      repeat:    data.repeat_state  ?? 'off',
      context: data.context ? { type: data.context.type, uri: data.context.uri } : null,
      item: {
        uri:      item?.uri ?? null,
        name:     item?.name,
        artist:   isEpisode ? (item?.show?.name ?? null)          : (item?.artists?.map((a) => a.name).join(', ') ?? null),
        album:    isEpisode ? (item?.show?.publisher ?? null)     : (item?.album?.name ?? null),
        art:      isEpisode ? (item?.images?.[0]?.url ?? null)    : (item?.album?.images?.[0]?.url ?? null),
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
    if (err.response?.status === 204) {
      nowPlayingCache = { data: null, at: now };
      return res.json(null);
    }
    if (err.response?.status === 429) {
      const retryAfter = err.response?.headers?.['retry-after'];
      const backoffMs  = retryAfter ? Number(retryAfter) * 1000 : BACKOFF_DURATION;
      nowPlayingBackoff = now + backoffMs;
      console.warn(`[spotify] now-playing: rate limited — Retry-After: ${retryAfter ?? '?'}s (backing off ${backoffMs / 1000}s)`);
      return res.json(nowPlayingCache.data);
    }
    spotifyError('now-playing', err, res);
  }
});

async function getPlayDeviceId() {
  const targetName = process.env.SPOTIFY_DEVICE_NAME ?? 'raspotify';
  try {
    const { data } = await spotify('GET', '/me/player/devices');
    const active = data.devices.find((d) => d.is_active);
    if (active) return null; // let Spotify keep using the active device
    const fallback = data.devices.find((d) =>
      d.name.toLowerCase().includes(targetName.toLowerCase())
    );
    return fallback?.id ?? null;
  } catch {
    return null;
  }
}

router.post('/play', async (req, res) => {
  try {
    const body = {};
    if (req.body?.context_uri)              body.context_uri = req.body.context_uri;
    if (req.body?.uris)                     body.uris        = req.body.uris;
    if (req.body?.offset_uri)               body.offset      = { uri: req.body.offset_uri };
    if (req.body?.offset_position != null)  body.offset      = { position: req.body.offset_position };

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
    const { data: me } = await spotify('GET', '/me');
    const userId = me.id;

    const items = [];
    let url = '/me/playlists?limit=50';
    while (url) {
      const { data } = await spotify('GET', url);
      items.push(...data.items);
      url = data.next ? data.next.replace('https://api.spotify.com/v1', '') : null;
    }

    const owned = items.filter((pl) => pl.owner.id === userId || pl.collaborative);
    const payload = owned.map((pl) => ({
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
    await spotify('PUT', `/me/player/seek?position_ms=${req.body.position}`);
    res.json({ ok: true });
  } catch (err) { spotifyError('seek', err, res); }
});

router.post('/volume', async (req, res) => {
  try {
    await spotify('PUT', `/me/player/volume?volume_percent=${req.body.volume}`);
    res.json({ ok: true });
  } catch (err) { spotifyError('volume', err, res); }
});

router.get('/devices', async (_req, res) => {
  try {
    const { data } = await spotify('GET', '/me/player/devices');
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
    await spotify('PUT', `/me/player/shuffle?state=${req.body.state ? 'true' : 'false'}`);
    res.json({ ok: true });
  } catch (err) { spotifyError('shuffle', err, res); }
});

router.post('/repeat', async (req, res) => {
  try {
    await spotify('PUT', `/me/player/repeat?state=${req.body.state}`);
    res.json({ ok: true });
  } catch (err) { spotifyError('repeat', err, res); }
});

router.get('/liked-songs', async (req, res) => {
  try {
    const countOnly = req.query.count_only === 'true';
    const [{ data: me }, { data: first }] = await Promise.all([
      spotify('GET', '/me'),
      spotify('GET', '/me/tracks?limit=1'),
    ]);
    const collectionUri = `spotify:user:${me.id}:collection`;
    if (countOnly) return res.json({ total: first.total, collectionUri });

    const allItems = [];
    let url = '/me/tracks?limit=50';
    while (url) {
      const { data } = await spotify('GET', url);
      allItems.push(...data.items);
      url = data.next ? data.next.replace('https://api.spotify.com/v1', '') : null;
    }
    res.json({
      total: first.total,
      collectionUri,
      tracks: allItems
        .filter((i) => i.track?.id)
        .map((i) => ({
          id:       i.track.id,
          uri:      i.track.uri,
          name:     i.track.name,
          artist:   i.track.artists.map((a) => a.name).join(', '),
          duration: i.track.duration_ms,
          art:      i.track.album?.images?.[2]?.url ?? i.track.album?.images?.[0]?.url ?? null,
        })),
    });
  } catch (err) { spotifyError('liked-songs', err, res); }
});

router.get('/shows', async (_req, res) => {
  try {
    const items = [];
    let url = '/me/shows?limit=50';
    while (url) {
      const { data } = await spotify('GET', url);
      items.push(...data.items);
      url = data.next ? data.next.replace('https://api.spotify.com/v1', '') : null;
    }
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
    const items = [];
    let url = `/shows/${req.params.id}/episodes?limit=50&market=from_token`;
    while (url) {
      const { data } = await spotify('GET', url);
      items.push(...data.items);
      url = data.next ? data.next.replace('https://api.spotify.com/v1', '') : null;
    }
    res.json(items.map((ep) => ({
      id:       ep.id,
      uri:      ep.uri,
      name:     ep.name,
      duration: ep.duration_ms,
      art:      ep.images?.[0]?.url ?? null,
    })));
  } catch (err) { spotifyError('episodes', err, res); }
});

router.get('/albums', async (req, res) => {
  if (albumsCache.data && Date.now() - albumsCache.at < LIBRARY_TTL) {
    return res.json(albumsCache.data);
  }
  try {
    const items = [];
    let url = '/me/albums?limit=50';
    while (url) {
      const { data } = await spotify('GET', url);
      items.push(...data.items);
      url = data.next ? data.next.replace('https://api.spotify.com/v1', '') : null;
    }
    const payload = items.map((i) => ({
      id:     i.album.id,
      uri:    i.album.uri,
      name:   i.album.name,
      artist: i.album.artists.map((a) => a.name).join(', '),
      image:  i.album.images?.[0]?.url ?? null,
    }));
    albumsCache = { data: payload, at: Date.now() };
    res.json(payload);
  } catch (err) { spotifyError('albums', err, res); }
});

router.get('/album/:id/tracks', async (req, res) => {
  try {
    const [{ data: tracksData }, { data: albumData }] = await Promise.all([
      spotify('GET', `/albums/${req.params.id}/tracks?limit=50`),
      spotify('GET', `/albums/${req.params.id}`),
    ]);
    const art = albumData.images?.[1]?.url ?? albumData.images?.[0]?.url ?? null;
    res.json(tracksData.items.map((t) => ({
      id:       t.id,
      uri:      t.uri,
      name:     t.name,
      artist:   t.artists.map((a) => a.name).join(', '),
      duration: t.duration_ms,
      art,
    })));
  } catch (err) { spotifyError('album-tracks', err, res); }
});

router.get('/search', async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    if (!q) return res.json({ tracks: [], albums: [], playlists: [], shows: [], episodes: [] });
    const { data } = await spotify('GET', `/search?q=${encodeURIComponent(q)}&type=track,album,playlist,show,episode&limit=8`);
    res.json({
      tracks: (data.tracks?.items ?? []).map((t) => ({
        id:       t.id,
        uri:      t.uri,
        name:     t.name,
        artist:   t.artists.map((a) => a.name).join(', '),
        duration: t.duration_ms,
        art:      t.album?.images?.[2]?.url ?? null,
      })),
      albums: (data.albums?.items ?? []).map((a) => ({
        id:     a.id,
        uri:    a.uri,
        name:   a.name,
        artist: a.artists.map((x) => x.name).join(', '),
        image:  a.images?.[1]?.url ?? a.images?.[0]?.url ?? null,
      })),
      playlists: (data.playlists?.items ?? []).filter(Boolean).map((p) => ({
        id:    p.id,
        uri:   p.uri,
        name:  p.name,
        image: p.images?.[0]?.url ?? null,
      })),
      shows: (data.shows?.items ?? []).filter(Boolean).map((s) => ({
        id:        s.id,
        uri:       s.uri,
        name:      s.name,
        publisher: s.publisher,
        image:     s.images?.[0]?.url ?? null,
      })),
      episodes: (data.episodes?.items ?? []).filter(Boolean).map((ep) => ({
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
    let path = `/playlists/${req.params.id}/items?limit=100`;
    let allItems = [];
    while (path) {
      const { data } = await spotify('GET', path);
      allItems = allItems.concat(data.items);
      path = data.next ? data.next.replace('https://api.spotify.com/v1', '') : null;
    }
    res.json(
      allItems
        .filter((i) => i.item?.id && i.item?.type === 'track')
        .map((i) => ({
          id:       i.item.id,
          uri:      i.item.uri,
          name:     i.item.name,
          artist:   i.item.artists.map((a) => a.name).join(', '),
          duration: i.item.duration_ms,
          art:      i.item.album?.images?.[2]?.url ?? i.item.album?.images?.[0]?.url ?? null,
        }))
    );
  } catch (err) { spotifyError('playlist-tracks', err, res); }
});

router.post('/transfer', async (req, res) => {
  try {
    await spotify('PUT', '/me/player', { device_ids: [req.body.deviceId], play: req.body.play ?? false });
    res.json({ ok: true });
  } catch (err) { spotifyError('transfer', err, res); }
});

module.exports = router;
