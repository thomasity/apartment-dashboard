const express  = require('express');
const { exec }        = require('child_process');
const { spawn }       = require('child_process');
const router   = express.Router();

let scanInProgress = false;

function bt(cmd) {
  return new Promise((resolve, reject) => {
    // Pipe cmd + exit through stdin so bluetoothctl exits cleanly
    exec(`echo -e "${cmd}\\nexit" | bluetoothctl`, { timeout: 8000 }, (err, stdout, stderr) => {
      if (err && !err.killed) {
        console.error(`[bluetooth] "${cmd}" failed:`, stderr || err.message);
        return reject(err);
      }
      resolve(stdout ?? '');
    });
  });
}

function parseDeviceLines(stdout) {
  return stdout.trim().split('\n')
    .map((line) => {
      const match = line.match(/^Device\s+([0-9A-Fa-f:]{17})\s+(.+)$/);
      return match ? { mac: match[1], name: match[2] } : null;
    })
    .filter(Boolean);
}

// Paired devices with connected status
router.get('/devices', async (_req, res) => {
  try {
    const [pairedOut, connectedOut] = await Promise.all([
      bt('devices Paired'),
      bt('devices Connected'),
    ]);

    const connectedMacs = new Set(
      parseDeviceLines(connectedOut).map((d) => d.mac)
    );

    const devices = parseDeviceLines(pairedOut).map((d) => ({
      ...d,
      connected: connectedMacs.has(d.mac),
    }));

    res.json(devices);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Scan for nearby unpaired devices (~8 seconds)
router.get('/scan', async (_req, res) => {
  if (scanInProgress) return res.status(409).json({ error: 'Scan already in progress' });

  scanInProgress = true;
  try {
    await bt('power on');

    // Use timeout to auto-kill the scan after 8 seconds
    const proc = spawn('timeout', ['8', 'bluetoothctl', 'scan', 'on']);
    proc.stderr.on('data', (d) => console.error('[bluetooth] scan:', d.toString()));
    await new Promise((resolve) => { proc.on('close', resolve); });

    const [allOut, pairedOut] = await Promise.all([
      bt('devices'),
      bt('devices Paired'),
    ]);

    const pairedMacs = new Set(parseDeviceLines(pairedOut).map((d) => d.mac));
    const discovered = parseDeviceLines(allOut).filter((d) => !pairedMacs.has(d.mac));

    res.json(discovered);
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    scanInProgress = false;
  }
});

// Pair + trust + connect
router.post('/pair', async (req, res) => {
  const { mac } = req.body;
  if (!mac) return res.status(400).json({ error: 'mac required' });

  await bt(`pair ${mac}`);
  await bt(`trust ${mac}`);
  await bt(`connect ${mac}`);
  res.json({ ok: true });
});

// Connect an already-paired device
router.post('/connect', async (req, res) => {
  const { mac } = req.body;
  if (!mac) return res.status(400).json({ error: 'mac required' });
  await bt(`connect ${mac}`);
  res.json({ ok: true });
});

// Disconnect
router.post('/disconnect', async (req, res) => {
  const { mac } = req.body;
  if (!mac) return res.status(400).json({ error: 'mac required' });
  await bt(`disconnect ${mac}`);
  res.json({ ok: true });
});

// Forget (remove pairing)
router.delete('/device/:mac', async (req, res) => {
  await bt(`remove ${req.params.mac}`);
  res.json({ ok: true });
});

module.exports = router;
