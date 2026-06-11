const express = require('express');
const axios   = require('axios');
const router  = express.Router();

function rokuBase() {
  const ip = process.env.ROKU_IP;
  if (!ip) throw Object.assign(new Error('ROKU_IP not configured'), { code: 'NO_IP' });
  return `http://${ip}:8060`;
}

function xmlAttr(xml, tag, attr) {
  const re = new RegExp(`<${tag}\\b[^>]*\\s${attr}="([^"]*)"`, 'i');
  const m  = xml.match(re);
  return m ? m[1] : null;
}

router.get('/status', async (_req, res) => {
  try {
    const base = rokuBase();
    const [appRes, mediaRes] = await Promise.allSettled([
      axios.get(`${base}/query/active-app`,   { timeout: 3000 }),
      axios.get(`${base}/query/media-player`, { timeout: 3000 }),
    ]);

    let appId = null, appName = null;
    if (appRes.status === 'fulfilled') {
      const m = appRes.value.data.match(/<app\b[^>]*id="([^"]*)"[^>]*>([^<]*)<\/app>/);
      if (m) { appId = m[1]; appName = m[2].trim(); }
    }

    let playerState = 'none';
    if (mediaRes.status === 'fulfilled') {
      playerState = xmlAttr(mediaRes.value.data, 'player', 'state') ?? 'none';
    }

    res.json({ appId, appName, playerState });
  } catch (err) {
    res.status(err.code === 'NO_IP' ? 400 : 503).json({ error: err.message });
  }
});

router.get('/apps', async (_req, res) => {
  try {
    const { data } = await axios.get(`${rokuBase()}/query/apps`, { timeout: 5000 });
    const apps = [];
    const re = /<app\b[^>]*id="([^"]*)"[^>]*>([^<]*)<\/app>/g;
    let m;
    while ((m = re.exec(data)) !== null) apps.push({ id: m[1], name: m[2].trim() });
    res.json(apps);
  } catch (err) {
    res.status(err.code === 'NO_IP' ? 400 : 503).json({ error: err.message });
  }
});

router.get('/icon/:appId', async (req, res) => {
  try {
    const response = await axios.get(
      `${rokuBase()}/query/icon/${req.params.appId}`,
      { responseType: 'stream', timeout: 5000 },
    );
    res.setHeader('Content-Type', response.headers['content-type'] || 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    response.data.pipe(res);
  } catch {
    res.status(404).end();
  }
});

router.post('/keypress/:key', async (req, res) => {
  try {
    await axios.post(`${rokuBase()}/keypress/${req.params.key}`, null, { timeout: 3000 });
    res.json({ ok: true });
  } catch (err) {
    res.status(err.code === 'NO_IP' ? 400 : 503).json({ error: err.message });
  }
});

router.post('/launch/:appId', async (req, res) => {
  try {
    await axios.post(`${rokuBase()}/launch/${req.params.appId}`, null, { timeout: 3000 });
    res.json({ ok: true });
  } catch (err) {
    res.status(err.code === 'NO_IP' ? 400 : 503).json({ error: err.message });
  }
});

module.exports = router;
