const express = require('express');
const axios   = require('axios');
const dgram   = require('dgram');
const router  = express.Router();
const config  = require('../config');

const SSDP_ADDR = '239.255.255.250';
const SSDP_PORT = 1900;
const SSDP_MSG  = Buffer.from(
  'M-SEARCH * HTTP/1.1\r\n' +
  `HOST: ${SSDP_ADDR}:${SSDP_PORT}\r\n` +
  'MAN: "ssdp:discover"\r\n' +
  'ST: roku:ecp\r\n' +
  'MX: 3\r\n\r\n'
);

function rokuBase() {
  const ip = config.get('rokuIp') ?? process.env.ROKU_IP;
  if (!ip) throw Object.assign(new Error('ROKU_IP not configured'), { code: 'NO_IP' });
  return `http://${ip}:8060`;
}

function xmlAttr(xml, tag, attr) {
  const re = new RegExp(`<${tag}\\b[^>]*\\s${attr}="([^"]*)"`, 'i');
  const m  = xml.match(re);
  return m ? m[1] : null;
}

function parseRokuTime(str) {
  if (!str) return 0;
  const m = str.match(/^(\d+):(\d+):(\d+)/);
  if (!m) return 0;
  return parseInt(m[1]) * 3600 + parseInt(m[2]) * 60 + parseInt(m[3]);
}

function xmlTag(xml, tag) {
  const m = xml.match(new RegExp(`<${tag}>([^<]*)<\\/${tag}>`));
  return m ? m[1].trim() : null;
}

function discoverRoku(timeoutMs = 3000) {
  return new Promise((resolve) => {
    const socket   = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    const foundIps = new Set();

    socket.on('message', (buf) => {
      const m = buf.toString().match(/LOCATION:\s*http:\/\/([^:/]+)/i);
      if (m) foundIps.add(m[1]);
    });

    socket.on('error', () => {});

    socket.bind(0, () => {
      socket.send(SSDP_MSG, SSDP_PORT, SSDP_ADDR);
    });

    setTimeout(async () => {
      try { socket.close(); } catch {}
      const devices = await Promise.all(
        [...foundIps].map(async (ip) => {
          try {
            const { data } = await axios.get(`http://${ip}:8060/query/device-info`, { timeout: 2000 });
            return {
              ip,
              name:  xmlTag(data, 'friendly-device-name') ?? ip,
              model: xmlTag(data, 'model-name') ?? null,
            };
          } catch {
            return { ip, name: ip, model: null };
          }
        })
      );
      resolve(devices);
    }, timeoutMs);
  });
}

router.get('/discover', async (_req, res) => {
  try {
    res.json(await discoverRoku());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/device', (_req, res) => {
  const ip   = config.get('rokuIp') ?? process.env.ROKU_IP ?? null;
  const name = config.get('rokuName') ?? ip;
  res.json(ip ? { ip, name } : null);
});

router.post('/select', (req, res) => {
  const { ip, name } = req.body ?? {};
  if (!ip) return res.status(400).json({ error: 'ip required' });
  config.set('rokuIp', ip);
  config.set('rokuName', name ?? ip);
  res.json({ ok: true });
});

router.get('/status', async (_req, res) => {
  try {
    const base = rokuBase();
    const [appRes, mediaRes] = await Promise.allSettled([
      axios.get(`${base}/query/active-app`,   { timeout: 6000 }),
      axios.get(`${base}/query/media-player`, { timeout: 6000 }),
    ]);

    let appId = null, appName = null;
    if (appRes.status === 'fulfilled') {
      const m = appRes.value.data.match(/<app\b[^>]*id="([^"]*)"[^>]*>([^<]*)<\/app>/);
      if (m) { appId = m[1]; appName = m[2].trim(); }
    }

    let playerState = 'none', position = 0, duration = 0;
    if (mediaRes.status === 'fulfilled') {
      const xml = mediaRes.value.data;
      playerState = xmlAttr(xml, 'player', 'state') ?? 'none';
      position    = parseRokuTime(xmlTag(xml, 'position'));
      duration    = parseRokuTime(xmlTag(xml, 'duration'));
    }

    res.json({ appId, appName, playerState, position, duration });
  } catch (err) {
    res.status(err.code === 'NO_IP' ? 400 : 503).json({ error: err.message });
  }
});

router.get('/apps', async (_req, res) => {
  try {
    const { data } = await axios.get(`${rokuBase()}/query/apps`, { timeout: 10000 });
    const apps = [];
    const re = /<app\b[^>]*id="([^"]*)"[^>]*>([^<]*)<\/app>/g;
    let m;
    while ((m = re.exec(data)) !== null) apps.push({ id: m[1], name: m[2].trim() });
    res.json(apps);
  } catch (err) {
    console.error('[tv] apps query failed:', err.code ?? err.message);
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
    let rokuKey = req.params.key;
    // Express decodes URL params — re-encode the literal char so Roku gets e.g. Lit_%20 not Lit_
    if (rokuKey.startsWith('Lit_')) {
      rokuKey = 'Lit_' + encodeURIComponent(rokuKey.slice(4));
    }
    await axios.post(`${rokuBase()}/keypress/${rokuKey}`, null, { timeout: 6000 });
    res.json({ ok: true });
  } catch (err) {
    console.error('[tv] keypress failed:', req.params.key, err.code ?? err.response?.status ?? err.message);
    res.status(err.code === 'NO_IP' ? 400 : 503).json({ error: err.message });
  }
});

router.post('/type', async (req, res) => {
  try {
    const text = String(req.body.text ?? '');
    const base = rokuBase();
    for (const char of text) {
      await axios.post(`${base}/keypress/Lit_${encodeURIComponent(char)}`, null, { timeout: 2000 });
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(err.code === 'NO_IP' ? 400 : 503).json({ error: err.message });
  }
});

router.post('/search', async (req, res) => {
  try {
    const keyword = (req.body.keyword ?? '').trim();
    if (!keyword) return res.status(400).json({ error: 'keyword required' });
    await axios.post(`${rokuBase()}/search/browse`, null, { params: { keyword }, timeout: 5000 });
    res.json({ ok: true });
  } catch (err) {
    console.error('[tv] search failed:', err.code ?? err.message);
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
