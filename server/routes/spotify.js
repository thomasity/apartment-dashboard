const express = require('express');
const axios   = require('axios');
const router  = express.Router();

const CLIENT_ID     = process.env.SPOTIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;

let accessToken    = null;
let tokenExpiresAt = 0;

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

router.get('/now-playing', async (req, res) => {
  try {
    const { data } = await spotify('GET', '/me/player?additional_types=track,episode');
    if (!data) return res.json(null);
    const item      = data.item;
    const isEpisode = item?.type === 'episode';
    res.json({
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
    });
  } catch (err) {
    if (err.response?.status === 204) return res.json(null);
    res.status(500).json({ error: err.message });
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
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/playlists', async (_req, res) => {
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
    res.json(owned.map((pl) => ({
      id:    pl.id,
      uri:   pl.uri,
      name:  pl.name,
      image: pl.images?.[0]?.url ?? null,
      total: pl.tracks?.total ?? 0,
    })));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/pause',    async (_req, res) => {
  try { await spotify('PUT',  '/me/player/pause');    res.json({ ok: true }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/next',     async (_req, res) => {
  try { await spotify('POST', '/me/player/next');     res.json({ ok: true }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/previous', async (_req, res) => {
  try { await spotify('POST', '/me/player/previous'); res.json({ ok: true }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/seek', async (req, res) => {
  try {
    await spotify('PUT', `/me/player/seek?position_ms=${req.body.position}`);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/volume', async (req, res) => {
  try {
    await spotify('PUT', `/me/player/volume?volume_percent=${req.body.volume}`);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
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
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/shuffle', async (req, res) => {
  try {
    await spotify('PUT', `/me/player/shuffle?state=${req.body.state ? 'true' : 'false'}`);
    res.json({ ok: true });
  } catch (err) {
    console.error('[spotify] shuffle error:', err.response?.status, err.response?.data ?? err.message);
    res.status(err.response?.status ?? 500).json({ error: err.response?.data?.error?.message ?? err.message });
  }
});

router.post('/repeat', async (req, res) => {
  try {
    await spotify('PUT', `/me/player/repeat?state=${req.body.state}`);
    res.json({ ok: true });
  } catch (err) {
    console.error('[spotify] repeat error:', err.response?.status, err.response?.data ?? err.message);
    res.status(err.response?.status ?? 500).json({ error: err.response?.data?.error?.message ?? err.message });
  }
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
  } catch (err) {
    console.error('[spotify] liked-songs error:', err.response?.status, err.response?.data ?? err.message);
    res.status(err.response?.status ?? 500).json({ error: err.response?.data?.error?.message ?? err.message });
  }
});

router.get('/albums', async (req, res) => {
  try {
    const items = [];
    let url = '/me/albums?limit=50';
    while (url) {
      const { data } = await spotify('GET', url);
      items.push(...data.items);
      url = data.next ? data.next.replace('https://api.spotify.com/v1', '') : null;
    }
    res.json(items.map((i) => ({
      id:     i.album.id,
      uri:    i.album.uri,
      name:   i.album.name,
      artist: i.album.artists.map((a) => a.name).join(', '),
      image:  i.album.images?.[0]?.url ?? null,
    })));
  } catch (err) {
    console.error('[spotify] albums error:', err.response?.status, err.response?.data ?? err.message);
    res.status(err.response?.status ?? 500).json({ error: err.response?.data?.error?.message ?? err.message });
  }
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
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/search', async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    if (!q) return res.json({ tracks: [], albums: [], playlists: [] });
    const { data } = await spotify('GET', `/search?q=${encodeURIComponent(q)}&type=track,album,playlist&limit=8`);
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
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
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
  } catch (err) {
    console.error('[spotify] tracks error:', err.response?.status, err.response?.data ?? err.message);
    res.status(500).json({ error: err.message });
  }
});

router.post('/transfer', async (req, res) => {
  try {
    await spotify('PUT', '/me/player', { device_ids: [req.body.deviceId], play: req.body.play ?? false });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
