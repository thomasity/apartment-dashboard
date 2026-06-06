const express = require('express');

module.exports = (io, mqttManager) => {
  const router = express.Router();

  router.get('/state', (_req, res) => {
    res.json(mqttManager.getState());
  });

  router.get('/devices', (_req, res) => {
    res.json(mqttManager.getDevicesState());
  });

  router.post('/pair', (req, res) => {
    mqttManager.permitJoin(!!req.body.enable);
    res.json({ ok: true });
  });

  router.post('/set', (req, res) => {
    const { group, brightness, colorTemp } = req.body;

    const payload = {
      brightness: brightness !== undefined ? Number(brightness) : undefined,
      colorTemp:  colorTemp  !== undefined ? Number(colorTemp)  : undefined,
    };

    if (!group || group === 'all') {
      // Fan out to every configured group
      Object.keys(mqttManager.groups).forEach((g) => mqttManager.setGroup(g, payload));
    } else {
      mqttManager.setGroup(group, payload);
    }

    res.json({ ok: true });
  });

  return router;
};
