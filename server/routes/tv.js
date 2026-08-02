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

// Roku's ECP responses are small, predictable XML fragments, so a handful of regexes
// are simpler here than pulling in a full XML parser.

function xmlAttr(xml, tag, attr) {
  const re    = new RegExp(`<${tag}\\b[^>]*\\s${attr}="([^"]*)"`, 'i');
  const match = xml.match(re);
  return match ? match[1] : null;
}

function xmlTag(xml, tag) {
  const match = xml.match(new RegExp(`<${tag}>([^<]*)<\\/${tag}>`));
  return match ? match[1].trim() : null;
}

// Roku reports playback position/duration as "HH:MM:SS" — convert to seconds.
function parseRokuTime(str) {
  if (!str) return 0;
  const match = str.match(/^(\d+):(\d+):(\d+)/);
  if (!match) return 0;
  return parseInt(match[1]) * 3600 + parseInt(match[2]) * 60 + parseInt(match[3]);
}

// Roku errors surface as a missing-config 400, everything else as a 503 (device unreachable).
function rokuErrorStatus(err) {
  return err.code === 'NO_IP' ? 400 : 503;
}

// Wake-on-LAN "magic packet": 6 bytes of 0xFF followed by the target MAC repeated 16 times.
function buildMagicPacket(mac) {
  const bytes = mac.replace(/[:\-]/g, '').match(/.{2}/g).map((h) => parseInt(h, 16));
  if (bytes.length !== 6) throw new Error('Invalid MAC: ' + mac);
  const buf = Buffer.alloc(102);
  buf.fill(0xff, 0, 6);
  for (let i = 0; i < 16; i++) bytes.forEach((b, j) => { buf[6 + i * 6 + j] = b; });
  return buf;
}

function sendWoL(mac, tvIp) {
  const packet  = buildMagicPacket(mac);
  const targets = ['255.255.255.255'];
  // Also broadcast to the TV's own subnet — some routers block the global broadcast address.
  if (tvIp) {
    const parts = tvIp.split('.');
    parts[3]    = '255';
    targets.push(parts.join('.'));
  }
  return Promise.all(targets.map((addr) => new Promise((resolve) => {
    try {
      const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
      sock.once('error', () => { try { sock.close(); } catch {} resolve(); });
      sock.bind(0, () => {
        sock.setBroadcast(true);
        sock.send(packet, 0, packet.length, 9, addr, () => {
          try { sock.close(); } catch {}
          resolve();
        });
      });
    } catch { resolve(); }
  })));
}

// Broadcasts an SSDP M-SEARCH for Roku's ECP service and collects replies for timeoutMs.
function discoverRoku(timeoutMs = 3000) {
  return new Promise((resolve) => {
    const socket   = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    const foundIps = new Set();

    socket.on('message', (buf) => {
      const match = buf.toString().match(/LOCATION:\s*http:\/\/([^:/]+)/i);
      if (match) foundIps.add(match[1]);
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

router.post('/select', async (req, res) => {
  const { ip, name } = req.body ?? {};
  if (!ip) return res.status(400).json({ error: 'ip required' });
  config.set('rokuIp', ip);
  config.set('rokuName', name ?? ip);
  // Fetch and cache MAC address so we can WoL later when TV is asleep
  try {
    const { data } = await axios.get(`http://${ip}:8060/query/device-info`, { timeout: 3000 });
    const mac = xmlTag(data, 'wifi-mac') ?? xmlTag(data, 'ethernet-mac');
    if (mac) { config.set('rokuMac', mac); console.log(`[tv] cached MAC for WoL: ${mac}`); }
  } catch {}
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
      const match = appRes.value.data.match(/<app\b[^>]*id="([^"]*)"[^>]*>([^<]*)<\/app>/);
      if (match) { appId = match[1]; appName = match[2].trim(); }
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
    res.status(rokuErrorStatus(err)).json({ error: err.message });
  }
});

router.get('/apps', async (_req, res) => {
  try {
    const { data } = await axios.get(`${rokuBase()}/query/apps`, { timeout: 10000 });
    const apps = [];
    const re = /<app\b[^>]*id="([^"]*)"[^>]*>([^<]*)<\/app>/g;
    let match;
    while ((match = re.exec(data)) !== null) apps.push({ id: match[1], name: match[2].trim() });
    res.json(apps);
  } catch (err) {
    console.error('[tv] apps query failed:', err.code ?? err.message);
    res.status(rokuErrorStatus(err)).json({ error: err.message });
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

router.post('/power-on', async (req, res) => {
  const ip  = config.get('rokuIp') ?? process.env.ROKU_IP;
  let   mac = config.get('rokuMac');

  // If MAC not yet cached, try fetching device-info now (TV may be on ARP cache / just woke)
  if (!mac && ip) {
    try {
      const { data } = await axios.get(`http://${ip}:8060/query/device-info`, { timeout: 1500 });
      mac = xmlTag(data, 'wifi-mac') ?? xmlTag(data, 'ethernet-mac');
      if (mac) config.set('rokuMac', mac);
    } catch {}
  }

  if (mac) {
    await sendWoL(mac, ip);
    console.log(`[tv] WoL sent to ${mac}`);
  }

  try {
    await axios.post(`${rokuBase()}/keypress/PowerOn`, null, { timeout: 4000 });
    res.json({ ok: true, waking: false });
  } catch {
    // ECP failed — TV is still waking from WoL (or WoL not supported)
    res.json({ ok: true, waking: !!mac });
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
    res.status(rokuErrorStatus(err)).json({ error: err.message });
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
    res.status(rokuErrorStatus(err)).json({ error: err.message });
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
    res.status(rokuErrorStatus(err)).json({ error: err.message });
  }
});

router.post('/launch/:appId', async (req, res) => {
  try {
    await axios.post(`${rokuBase()}/launch/${req.params.appId}`, null, { timeout: 3000 });
    res.json({ ok: true });
  } catch (err) {
    res.status(rokuErrorStatus(err)).json({ error: err.message });
  }
});

module.exports = router;
