const express = require('express');
const { exec } = require('child_process');
const router  = express.Router();

router.get('/devices', (_req, res) => {
  exec('bluetoothctl devices Connected', (err, stdout) => {
    if (err || !stdout.trim()) return res.json([]);

    const devices = stdout.trim().split('\n')
      .map((line) => {
        // Format: "Device AA:BB:CC:DD:EE:FF Speaker Name"
        const match = line.match(/^Device\s+([0-9A-Fa-f:]{17})\s+(.+)$/);
        return match ? { mac: match[1], name: match[2] } : null;
      })
      .filter(Boolean);

    res.json(devices);
  });
});

module.exports = router;
