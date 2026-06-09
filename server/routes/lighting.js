const express   = require('express');
const circadian = require('../services/circadian');

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

  router.post('/devices/rename', (req, res) => {
    const { from, to } = req.body;
    if (!from || !to) return res.status(400).json({ error: 'from and to required' });
    mqttManager.renameDevice(from, to);
    res.json({ ok: true });
  });

  router.post('/devices/remove', (req, res) => {
    const { id } = req.body;
    if (!id) return res.status(400).json({ error: 'id required' });
    mqttManager.removeDevice(id);
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

  router.post('/power', (req, res) => {
    const { group = 'all', on } = req.body;
    mqttManager.setPower(group, on);
    res.json({ ok: true });
  });

  router.get('/circadian', (_req, res) => {
    res.json({ ...circadian.getState(), timeline: circadian.getTimeline() });
  });

  router.post('/circadian', (req, res) => {
    const { group = 'all', enabled } = req.body;
    if (enabled) circadian.enable(group);
    else circadian.disable(group);
    res.json({ ok: true });
  });

  return router;
};
