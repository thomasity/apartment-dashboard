import express from 'express';
import * as circadian from '../services/circadian';
import * as roomsSvc from '../services/rooms';
import overrideSvc from '../services/override';
import * as rulesSvc from '../services/rules';
import * as presenceSvc from '../services/presence';
import { errorCode, errorMessage } from '../util';
import type { MqttManager } from '../mqtt/client';
import type { AppServer, LightValues, PresenceConfigEntry, Rule } from '../types';

// Request bodies as the client sends them. Express doesn't validate these — they
// document the expected shape and give the handlers typed access.
interface LightBody      { group?: string; brightness?: number | string; colorTemp?: number | string }
interface PowerBody      { group?: string; on: boolean }
interface CircadianBody  { group?: string; enabled: boolean }

export default function lightingRouter(io: AppServer, mqttManager: MqttManager) {
  const router = express.Router();

  const emitRooms = () => io.emit('lighting:rooms', roomsSvc.get());

  function setOverride(groups: string[]): void {
    groups.forEach((g) => overrideSvc.set(g));
  }

  // Maps a list of device/group names back to their rooms and tells presence
  // about the manual power change, so it can suppress or clear auto-on suppression.
  function recordManualPowerForGroups(groups: string[], on: boolean): void {
    const rooms = new Set(groups.map((g) => roomsSvc.getRoomForDevice(g)).filter((r): r is string => r !== null));
    rooms.forEach((room) => presenceSvc.recordManualPower(room, on));
  }

  // "all" (or no group) expands to every configured group; otherwise just the one named.
  function resolveGroups(group: string | undefined): string[] {
    return (!group || group === 'all') ? Object.keys(mqttManager.groups) : [group];
  }

  // Only pass through brightness/colorTemp fields that were actually provided.
  function buildLightPayload({ brightness, colorTemp }: LightBody): Partial<LightValues> {
    return {
      brightness: brightness !== undefined ? Number(brightness) : undefined,
      colorTemp:  colorTemp  !== undefined ? Number(colorTemp)  : undefined,
    };
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

  router.get('/rules/debug', (_req, res) => res.json(rulesSvc.debugInfo()));

  router.get('/rules', (_req, res) => res.json(rulesSvc.getRules()));

  router.post('/rules', (req, res) => {
    try {
      res.json(rulesSvc.create(req.body as rulesSvc.NewRule));
    } catch (err) {
      res.status(400).json({ error: errorMessage(err) });
    }
  });

  router.patch('/rules/:id', (req, res) => {
    try {
      res.json(rulesSvc.update(req.params.id, req.body as Partial<Rule>));
    } catch (err) {
      res.status(errorCode(err) === 'NOT_FOUND' ? 404 : 400).json({ error: errorMessage(err) });
    }
  });

  router.delete('/rules/:id', (req, res) => {
    rulesSvc.remove(req.params.id);
    res.json({ ok: true });
  });

  // ── Presence ─────────────────────────────────────────────────────────────

  router.get('/presence', (_req, res) => res.json(presenceSvc.getState()));

  router.post('/presence', (req, res) => {
    try {
      res.json(presenceSvc.create(req.body as presenceSvc.CreateParams));
    } catch (err) {
      res.status(400).json({ error: errorMessage(err) });
    }
  });

  router.patch('/presence/:sensor', (req, res) => {
    try {
      res.json(presenceSvc.update(req.params.sensor, req.body as Partial<PresenceConfigEntry>));
    } catch (err) {
      res.status(errorCode(err) === 'NOT_FOUND' ? 404 : 400).json({ error: errorMessage(err) });
    }
  });

  router.delete('/presence/:sensor', (req, res) => {
    presenceSvc.remove(req.params.sensor);
    res.json({ ok: true });
  });

  // ── Room CRUD ────────────────────────────────────────────────────────────

  router.get('/rooms', (_req, res) => res.json(roomsSvc.get()));

  router.post('/rooms', (req, res) => {
    try {
      const { name } = req.body as { name?: string };
      roomsSvc.create(name ?? '');
      emitRooms();
      res.json({ ok: true });
    } catch (err) {
      res.status(errorCode(err) === 'EXISTS' ? 409 : 400).json({ error: errorMessage(err) });
    }
  });

  // Must come before /:name routes so Express doesn't treat "assign" as a :name
  router.post('/rooms/assign', (req, res) => {
    const { device, room } = req.body as { device?: string; room?: string | null };
    if (!device) return res.status(400).json({ error: 'device required' });
    roomsSvc.assignDevice(device, room ?? null);
    emitRooms();
    res.json({ ok: true });
  });

  router.patch('/rooms/:name', (req, res) => {
    try {
      const { newName } = req.body as { newName?: string };
      roomsSvc.rename(req.params.name, newName ?? '');
      emitRooms();
      res.json({ ok: true });
    } catch (err) {
      const code = errorCode(err);
      const status = code === 'NOT_FOUND' ? 404 : code === 'EXISTS' ? 409 : 400;
      res.status(status).json({ error: errorMessage(err) });
    }
  });

  router.delete('/rooms/:name', (req, res) => {
    roomsSvc.remove(req.params.name);
    emitRooms();
    res.json({ ok: true });
  });

  // ── Room-level actions (fan out to member devices) ───────────────────────

  router.post('/rooms/:name/set', (req, res) => {
    const payload = buildLightPayload(req.body as LightBody);
    const groups  = roomsSvc.getDevices(req.params.name);
    groups.forEach((g) => mqttManager.setGroup(g, payload));
    setOverride(groups);
    res.json({ ok: true });
  });

  router.post('/rooms/:name/power', (req, res) => {
    const { on } = req.body as PowerBody;
    const groups = roomsSvc.getDevices(req.params.name);
    groups.forEach((g) => mqttManager.setPower(g, on));
    presenceSvc.recordManualPower(req.params.name, on);
    res.json({ ok: true });
  });

  router.post('/rooms/:name/circadian', (req, res) => {
    const { enabled } = req.body as CircadianBody;
    const groups = roomsSvc.getDevices(req.params.name);
    // Clear overrides BEFORE enabling so apply() inside enable() sees no active overrides
    groups.forEach((g) => overrideSvc.clear(g));
    groups.forEach((g) => {
      if (enabled) circadian.enable(g);
      else circadian.disable(g);
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

  router.get('/sensors', (_req, res) => {
    res.json(mqttManager.getSensorsState());
  });

  router.post('/sensors/:name/set', (req, res) => {
    mqttManager.setSensorProperty(req.params.name, req.body as Record<string, unknown>);
    res.json({ ok: true });
  });

  router.post('/pair', (req, res) => {
    const { enable } = req.body as { enable?: boolean };
    mqttManager.permitJoin(!!enable);
    res.json({ ok: true });
  });

  router.post('/devices/rename', (req, res) => {
    const { from, to } = req.body as { from?: string; to?: string };
    if (!from || !to) return res.status(400).json({ error: 'from and to required' });
    mqttManager.renameDevice(from, to);
    res.json({ ok: true });
  });

  router.post('/devices/remove', (req, res) => {
    const { id } = req.body as { id?: string };
    if (!id) return res.status(400).json({ error: 'id required' });
    mqttManager.removeDevice(id);
    res.json({ ok: true });
  });

  // ── Global set / power ───────────────────────────────────────────────────

  router.post('/set', (req, res) => {
    const body    = req.body as LightBody;
    const payload = buildLightPayload(body);
    const groups  = resolveGroups(body.group);
    groups.forEach((g) => mqttManager.setGroup(g, payload));
    setOverride(groups);
    res.json({ ok: true });
  });

  router.post('/power', (req, res) => {
    const { group = 'all', on } = req.body as PowerBody;
    mqttManager.setPower(group, on);
    recordManualPowerForGroups(resolveGroups(group), on);
    res.json({ ok: true });
  });

  // ── Circadian ────────────────────────────────────────────────────────────

  router.get('/circadian', (_req, res) => {
    res.json({ ...circadian.getState(), timeline: circadian.getTimeline() });
  });

  router.post('/circadian', (req, res) => {
    const { group = 'all', enabled } = req.body as CircadianBody;
    if (enabled) {
      // Clear overrides BEFORE enabling so apply() sees no active overrides
      resolveGroups(group).forEach((g) => overrideSvc.clear(g));
      circadian.enable(group);
    } else {
      circadian.disable(group);
    }
    res.json({ ok: true });
  });

  return router;
}
