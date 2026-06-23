const express      = require('express');
const circadian    = require('../services/circadian');
const roomsSvc     = require('../services/rooms');
const overrideSvc  = require('../services/override');
const rulesSvc     = require('../services/rules');

module.exports = (io, mqttManager) => {
  const router = express.Router();

  const emitRooms = () => io.emit('lighting:rooms', roomsSvc.get());

  function setOverride(groups) {
    groups.forEach((g) => overrideSvc.set(g));
  }

  // ── Override ─────────────────────────────────────────────────────────────

  router.get('/override', (_req, res) => {
    res.json(overrideSvc.getState());
  });

  router.delete('/override/:group', (req, res) => {
    overrideSvc.clear(req.params.group);
    circadian.applyToGroup(req.params.group);
    res.json({ ok: true });
  });

  // ── Rules ─────────────────────────────────────────────────────────────────

  router.get('/rules', (_req, res) => res.json(rulesSvc.getRules()));

  router.post('/rules', (req, res) => {
    try {
      const rule = rulesSvc.create(req.body);
      res.json(rule);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  router.patch('/rules/:id', (req, res) => {
    try {
      const rule = rulesSvc.update(req.params.id, req.body);
      res.json(rule);
    } catch (err) {
      res.status(err.code === 'NOT_FOUND' ? 404 : 400).json({ error: err.message });
    }
  });

  router.delete('/rules/:id', (req, res) => {
    rulesSvc.remove(req.params.id);
    res.json({ ok: true });
  });

  // ── Room CRUD ────────────────────────────────────────────────────────────

  router.get('/rooms', (_req, res) => res.json(roomsSvc.get()));

  router.post('/rooms', (req, res) => {
    try {
      roomsSvc.create(req.body.name ?? '');
      emitRooms();
      res.json({ ok: true });
    } catch (err) {
      res.status(err.code === 'EXISTS' ? 409 : 400).json({ error: err.message });
    }
  });

  // Must come before /:name routes so Express doesn't treat "assign" as a :name
  router.post('/rooms/assign', (req, res) => {
    const { device, room } = req.body;
    if (!device) return res.status(400).json({ error: 'device required' });
    roomsSvc.assignDevice(device, room ?? null);
    emitRooms();
    res.json({ ok: true });
  });

  router.patch('/rooms/:name', (req, res) => {
    try {
      roomsSvc.rename(req.params.name, req.body.newName ?? '');
      emitRooms();
      res.json({ ok: true });
    } catch (err) {
      const code = err.code === 'NOT_FOUND' ? 404 : err.code === 'EXISTS' ? 409 : 400;
      res.status(code).json({ error: err.message });
    }
  });

  router.delete('/rooms/:name', (req, res) => {
    roomsSvc.remove(req.params.name);
    emitRooms();
    res.json({ ok: true });
  });

  // ── Room-level actions (fan out to member devices) ───────────────────────

  router.post('/rooms/:name/set', (req, res) => {
    const { brightness, colorTemp } = req.body;
    const payload = {
      brightness: brightness !== undefined ? Number(brightness) : undefined,
      colorTemp:  colorTemp  !== undefined ? Number(colorTemp)  : undefined,
    };
    const groups = roomsSvc.getDevices(req.params.name);
    groups.forEach((g) => mqttManager.setGroup(g, payload));
    setOverride(groups);
    res.json({ ok: true });
  });

  router.post('/rooms/:name/power', (req, res) => {
    const { on } = req.body;
    const groups = roomsSvc.getDevices(req.params.name);
    groups.forEach((g) => mqttManager.setPower(g, on));
    setOverride(groups);
    res.json({ ok: true });
  });

  router.post('/rooms/:name/circadian', (req, res) => {
    const { enabled } = req.body;
    const groups = roomsSvc.getDevices(req.params.name);
    groups.forEach((g) => {
      if (enabled) circadian.enable(g);
      else circadian.disable(g);
      overrideSvc.clear(g); // enabling circadian cancels any active override
    });
    res.json({ ok: true });
  });

  router.delete('/rooms/:name/override', (req, res) => {
    const groups = roomsSvc.getDevices(req.params.name);
    groups.forEach((g) => {
      overrideSvc.clear(g);
      circadian.applyToGroup(g);
    });
    res.json({ ok: true });
  });

  // ── Device management ────────────────────────────────────────────────────

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

  // ── Global set / power ───────────────────────────────────────────────────

  router.post('/set', (req, res) => {
    const { group, brightness, colorTemp } = req.body;
    const payload = {
      brightness: brightness !== undefined ? Number(brightness) : undefined,
      colorTemp:  colorTemp  !== undefined ? Number(colorTemp)  : undefined,
    };
    const groups = (!group || group === 'all')
      ? Object.keys(mqttManager.groups)
      : [group];
    groups.forEach((g) => mqttManager.setGroup(g, payload));
    setOverride(groups);
    res.json({ ok: true });
  });

  router.post('/power', (req, res) => {
    const { group = 'all', on } = req.body;
    mqttManager.setPower(group, on);
    const groups = (!group || group === 'all')
      ? Object.keys(mqttManager.groups)
      : [group];
    setOverride(groups);
    res.json({ ok: true });
  });

  // ── Circadian ────────────────────────────────────────────────────────────

  router.get('/circadian', (_req, res) => {
    res.json({ ...circadian.getState(), timeline: circadian.getTimeline() });
  });

  router.post('/circadian', (req, res) => {
    const { group = 'all', enabled } = req.body;
    if (enabled) circadian.enable(group);
    else circadian.disable(group);
    // Enabling circadian cancels override for the affected groups
    if (enabled) {
      const groups = group === 'all' ? Object.keys(mqttManager.groups) : [group];
      groups.forEach((g) => overrideSvc.clear(g));
    }
    res.json({ ok: true });
  });

  return router;
};
