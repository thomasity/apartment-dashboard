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
    const { data } = await spotify('GET', '/me/player');
    if (!data) return res.json(null);
    res.json({
      isPlaying: data.is_playing,
      track: {
        name:     data.item?.name,
        artist:   data.item?.artists?.map((a) => a.name).join(', '),
        album:    data.item?.album?.name,
        art:      data.item?.album?.images?.[0]?.url ?? null,
        duration: data.item?.duration_ms ?? 0,
        progress: data.progress_ms ?? 0,
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

router.post('/play', async (req, res) => {
  try {
    const body = req.body?.context_uri ? { context_uri: req.body.context_uri } : undefined;
    await spotify('PUT', '/me/player/play', body);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/playlists', async (_req, res) => {
  try {
    const { data } = await spotify('GET', '/me/playlists?limit=50');
    res.json(data.items.map((pl) => ({
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

router.post('/volume', async (req, res) => {
  try {
    await spotify('PUT', `/me/player/volume?volume_percent=${req.body.volume}`);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
