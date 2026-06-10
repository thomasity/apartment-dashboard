const express = require('express');
const { spawn, execFile } = require('child_process');
const router  = express.Router();

let scanInProgress = false;

// Run one or more bluetoothctl commands via stdin and return stdout
function bt(...cmds) {
  return new Promise((resolve, reject) => {
    const proc = spawn('bluetoothctl', [], { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';

    proc.stdout.on('data', (d) => { out += d.toString(); });
    proc.stderr.on('data', (d) => console.error('[bluetooth]', d.toString().trim()));

    cmds.forEach((c) => proc.stdin.write(c + '\n'));
    proc.stdin.write('exit\n');
    proc.stdin.end();

    const timer = setTimeout(() => { proc.kill(); resolve(out); }, 8000);
    proc.on('close', () => { clearTimeout(timer); resolve(out); });
    proc.on('error', (err) => { clearTimeout(timer); reject(err); });
  });
}

// Run bt() with a longer timeout for operations that take time (pair, connect)
function btSlow(...cmds) {
  return new Promise((resolve, reject) => {
    const proc = spawn('bluetoothctl', [], { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';

    proc.stdout.on('data', (d) => { out += d.toString(); });
    proc.stderr.on('data', (d) => console.error('[bluetooth]', d.toString().trim()));

    cmds.forEach((c) => proc.stdin.write(c + '\n'));
    proc.stdin.write('exit\n');
    proc.stdin.end();

    const timer = setTimeout(() => { proc.kill(); resolve(out); }, 20000);
    proc.on('close', () => { clearTimeout(timer); resolve(out); });
    proc.on('error', (err) => { clearTimeout(timer); reject(err); });
  });
}

function parseDeviceLines(stdout) {
  return stdout.split('\n')
    .map((line) => {
      const match = line.match(/Device\s+([0-9A-Fa-f:]{17})\s+(.+)/);
      return match ? { mac: match[1], name: match[2].trim() } : null;
    })
    .filter(Boolean);
}

// Paired devices with connected status
router.get('/devices', async (_req, res) => {
  try {
    const out = await bt('devices');
    const allDevices = parseDeviceLines(out);

    // Check connected status for each paired device
    const connectedOut = await bt('devices Connected');
    const connectedMacs = new Set(parseDeviceLines(connectedOut).map((d) => d.mac));

    const pairedOut = await bt('devices Paired');
    const pairedMacs = new Set(parseDeviceLines(pairedOut).map((d) => d.mac));

    const devices = allDevices
      .filter((d) => pairedMacs.has(d.mac))
      .map((d) => ({ ...d, connected: connectedMacs.has(d.mac) }));

    res.json(devices);
  } catch (err) {
    console.error('[bluetooth] /devices error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Scan for nearby unpaired devices (~8 seconds)
router.get('/scan', async (_req, res) => {
  if (scanInProgress) return res.status(409).json({ error: 'Scan already in progress' });
  scanInProgress = true;
  // Safety reset — never leave the flag stuck for more than 20 seconds
  const safetyTimer = setTimeout(() => { scanInProgress = false; }, 20000);

  try {
    // Power on then scan for 8 seconds via stdin
    await new Promise((resolve, reject) => {
      const proc = spawn('bluetoothctl', [], { stdio: ['pipe', 'pipe', 'pipe'] });
      let out = '';

      proc.stdout.on('data', (d) => { out += d.toString(); });
      proc.stderr.on('data', (d) => console.error('[bluetooth] scan:', d.toString().trim()));
      proc.on('error', reject);

      proc.stdin.write('power on\n');
      proc.stdin.write('scan on\n');

      // After 8 seconds, stop and exit
      setTimeout(() => {
        proc.stdin.write('scan off\n');
        proc.stdin.write('exit\n');
        proc.stdin.end();
      }, 8000);

      proc.on('close', resolve);
    });

    const [allOut, pairedOut] = await Promise.all([
      bt('devices'),
      bt('devices Paired'),
    ]);

    const pairedMacs = new Set(parseDeviceLines(pairedOut).map((d) => d.mac));
    const discovered = parseDeviceLines(allOut).filter((d) => !pairedMacs.has(d.mac));

    console.log(`[bluetooth] scan found ${discovered.length} unpaired device(s)`);
    res.json(discovered);
  } catch (err) {
    console.error('[bluetooth] scan error:', err.message);
    res.status(500).json({ error: err.message });
  } finally {
    clearTimeout(safetyTimer);
    scanInProgress = false;
  }
});

// Pair + trust + connect and set as audio output
router.post('/pair', async (req, res) => {
  const { mac } = req.body;
  if (!mac) return res.status(400).json({ error: 'mac required' });
  try {
    const out = await btSlow(`pair ${mac}`, `trust ${mac}`, `connect ${mac}`);
    console.log('[bluetooth] pair result:', out);
    const sinkId = await findBluetoothSink(mac);
    if (sinkId) {
      await wpctlSetDefault(sinkId);
      console.log(`[bluetooth] set default sink → ${sinkId} (${mac})`);
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Find the PipeWire sink index for a Bluetooth device by MAC, retrying for up to 5s
function findBluetoothSink(mac, retries = 10, delayMs = 500) {
  const sinkKey = 'bluez_output.' + mac.replace(/:/g, '_');
  return new Promise((resolve) => {
    let attempts = 0;
    const try_ = () => {
      execFile('pactl', ['list', 'sinks', 'short'], (err, stdout) => {
        if (!err) {
          const line = stdout.split('\n').find((l) => l.includes(sinkKey));
          if (line) { resolve(line.trim().split(/\s+/)[0]); return; }
        }
        if (++attempts < retries) setTimeout(try_, delayMs);
        else resolve(null);
      });
    };
    try_();
  });
}

function wpctlSetDefault(sinkId) {
  return new Promise((resolve) => {
    execFile('wpctl', ['set-default', String(sinkId)], (err) => {
      if (err) console.warn('[bluetooth] wpctl set-default failed:', err.message);
      resolve(!err);
    });
  });
}

function wpctlSetDefaultAlsa() {
  return new Promise((resolve) => {
    execFile('pactl', ['list', 'sinks', 'short'], (err, stdout) => {
      if (err) { resolve(); return; }
      const line = stdout.split('\n').find((l) => l.includes('alsa_output'));
      if (line) {
        const id = line.trim().split(/\s+/)[0];
        execFile('wpctl', ['set-default', id], () => resolve());
      } else {
        resolve();
      }
    });
  });
}

// Connect an already-paired device and set it as audio output
router.post('/connect', async (req, res) => {
  const { mac } = req.body;
  if (!mac) return res.status(400).json({ error: 'mac required' });
  try {
    await btSlow(`connect ${mac}`);
    const sinkId = await findBluetoothSink(mac);
    if (sinkId) {
      await wpctlSetDefault(sinkId);
      console.log(`[bluetooth] set default sink → ${sinkId} (${mac})`);
    } else {
      console.warn(`[bluetooth] connected ${mac} but no PipeWire sink found`);
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Disconnect and revert audio to ALSA
router.post('/disconnect', async (req, res) => {
  const { mac } = req.body;
  if (!mac) return res.status(400).json({ error: 'mac required' });
  try {
    await bt(`disconnect ${mac}`);
    await wpctlSetDefaultAlsa();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Forget (remove pairing)
router.delete('/device/:mac', async (req, res) => {
  try {
    await bt(`remove ${req.params.mac}`);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
