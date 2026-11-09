import express from 'express';
import * as circadian from '../services/circadian';
import * as controller from '../services/controller';
import * as roomsSvc from '../services/rooms';
import * as rulesSvc from '../services/rules';
import * as presenceSvc from '../services/presence';
import * as activity from '../services/activity';
import * as suggestions from '../services/suggestions';
import { explain } from '../services/explain';
import { isMigrated } from '../services/migrate';
import { ServiceError, errorCode, errorMessage, requestSource } from '../util';
import type { MqttManager } from '../mqtt/client';
import type { AppServer, LightValues, PresenceConfigEntry, Rule } from '../types';

// Request bodies as the client sends them. Express doesn't validate these — they
// document the expected shape and give the handlers typed access. `group` is always a
// target: "all", a room (id or name) or a bulb (IEEE address or name). `source` (or an
// X-Source header) says who's asking, for the activity log: the dashboard or voice.
interface LightBody { group?: string; brightness?: unknown; colorTemp?: unknown; source?: unknown }
interface PowerBody { group?: string; on?: unknown; source?: unknown }
interface AutoBody  { group?: string; enabled?: unknown; source?: unknown }
interface IdParams  { id: string }


// Brightness bottoms out at 1: 0 makes Zigbee2MQTT switch the bulb off without the app
// marking it powered off. Sliders send strings, so numeric strings are accepted.
function parseLevel(name: string, value: unknown, min: number): number | undefined {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (value === null || value === '' || !Number.isFinite(n)) {
    throw new ServiceError(`${name} must be a number`, 'INVALID');
  }
  return Math.min(100, Math.max(min, Math.round(n)));
}

function buildLightPayload({ brightness, colorTemp }: LightBody): Partial<LightValues> {
  const payload: Partial<LightValues> = {};
  const b = parseLevel('brightness', brightness, 1);
  const c = parseLevel('colorTemp',  colorTemp,  0);
  if (b !== undefined) payload.brightness = b;
  if (c !== undefined) payload.colorTemp  = c;
  return payload;
}

function requireBoolean(name: string, value: unknown): boolean {
  if (typeof value !== 'boolean') throw new ServiceError(`${name} must be true or false`, 'INVALID');
  return value;
}

/** Runs a handler, answering a ServiceError with its matching status. */
// Routes with :params name them, e.g. handle<IdParams>(…) — Express can't infer them
// through the wrapper.
function handle<P = object>(fn: (req: express.Request<P>, res: express.Response) => void): express.RequestHandler<P> {
  return (req, res) => {
    try {
      fn(req, res);
    } catch (err) {
      const code   = errorCode(err);
      const status = code === 'NOT_FOUND' ? 404 : code === 'EXISTS' || code === 'FULL' ? 409 : code ? 400 : 500;
      res.status(status).json({ error: errorMessage(err) });
    }
  };
}

export default function lightingRouter(io: AppServer, mqttManager: MqttManager) {
  const router = express.Router();

  const emitRooms = () => {
    io.emit('lighting:rooms', roomsSvc.get());
    controller.emitZones();
  };

  // Changes wait for the one-time id migration (it needs the bridge's device list), so
  // nothing writes new-format data over a config that hasn't been converted yet.
  router.use((req, res, next) => {
    if (req.method === 'GET' || isMigrated()) return next();
    res.status(503).json({ error: 'Lighting is still starting up — try again in a moment' });
  });

  // An explicit target that matches nothing is a 404, so voice hears about a misheard
  // room instead of a silent no-op.
  function bulbsFor(group: string | undefined): string[] {
    const bulbs = controller.resolveTargets(group);
    if (bulbs.length === 0 && group && group !== 'all') {
      throw new ServiceError(`No light or room named "${group}"`, 'NOT_FOUND');
    }
    return bulbs;
  }

  function zonesFor(group: string | undefined): string[] {
    const zones = controller.zonesForTarget(group);
    if (zones.length === 0 && group && group !== 'all') {
      throw new ServiceError(`No light or room named "${group}"`, 'NOT_FOUND');
    }
    return zones;
  }

  // ── Controls ─────────────────────────────────────────────────────────────

  router.post('/set', handle((req, res) => {
    const body = req.body as LightBody;
    const payload = buildLightPayload(body);
    controller.manualSet(bulbsFor(body.group), payload, requestSource(req));
    res.json({ ok: true });
  }));

  router.post('/power', handle((req, res) => {
    const body  = req.body as PowerBody;
    const on    = requireBoolean('on', body.on);
    const bulbs = bulbsFor(body.group);
    controller.manualPower(bulbs, on, requestSource(req));
    // A manual off starts presence's "don't switch back on" cooldown; on clears it.
    new Set(bulbs.map(roomsSvc.zoneOf)).forEach((zone) => presenceSvc.recordManualPower(zone, on));
    res.json({ ok: true });
  }));

  router.post('/auto', handle((req, res) => {
    const body = req.body as AutoBody;
    controller.setAuto(zonesFor(body.group), requireBoolean('enabled', body.enabled), requestSource(req));
    res.json({ ok: true });
  }));

  router.get('/zones', (_req, res) => res.json(controller.getZonesState()));

  // The assistant changing lights on its own: a look that ends by itself (it never freezes
  // the room like your changes do), or switching off. Always with a reason.
  router.post('/assistant', handle((req, res) => {
    const body = req.body as LightBody & { power?: unknown; minutes?: unknown; reason?: unknown };
    if (typeof body.reason !== 'string' || !body.reason.trim()) throw new ServiceError('reason required', 'INVALID');
    if (body.power !== undefined && body.power !== 'on' && body.power !== 'off') throw new ServiceError('power must be "on" or "off"', 'INVALID');
    const values = buildLightPayload(body);
    const look = values.brightness !== undefined || values.colorTemp !== undefined
      ? { brightness: values.brightness ?? 70, colorTemp: values.colorTemp ?? 30 }
      : undefined;
    if (!look && !body.power) throw new ServiceError('give a look (brightness/colorTemp) or power', 'INVALID');
    const results = controller.assistantSet(zonesFor(body.group), {
      ...(body.power && { power: body.power }),
      ...(look && { look }),
      ...(typeof body.minutes === 'number' && { minutes: body.minutes }),
      reason: body.reason.trim(),
    });
    res.json({ ok: results.every((r) => r.ok), results });
  }));

  // "Resume": hand a zone (id or name, or "all") back to automation — ends its manual
  // session and lets its motion sensor switch it on again.
  router.post('/zones/:id/resume', handle<IdParams>((req, res) => {
    const source = requestSource(req);
    for (const zone of zonesFor(req.params.id)) {
      const ended     = controller.endManual(zone);
      const cleared   = presenceSvc.clearCooldown(zone);
      const unassisted = controller.endAssistant(zone, true); // you overruling the assistant is a "no"
      if (ended || cleared || unassisted) activity.record({ zone, source, action: 'resume' });
    }
    res.json({ ok: true });
  }));

  // Why each zone looks the way it does, what's holding automation back, and what
  // happened in the last `hours` (default 24). `group` narrows it like any target.
  router.get('/explain', handle((req, res) => {
    const { group, hours } = req.query as { group?: string; hours?: string };
    const h = Math.min(24 * activity.RETENTION_DAYS, Math.max(1, Number(hours) || 24));
    const since = Date.now() - h * 60 * 60 * 1000;
    res.json(zonesFor(group).map((zone) => explain(zone, since)));
  }));

  // ── Suggestions ───────────────────────────────────────────────────────────

  router.get('/suggestions', (_req, res) => res.json(suggestions.current()));

  router.post('/suggestions/:id/dismiss', handle<IdParams>((req, res) => {
    const { forever } = req.body as { forever?: unknown };
    if (!suggestions.dismiss(req.params.id, forever === true)) throw new ServiceError('No such suggestion', 'NOT_FOUND');
    res.json({ ok: true });
  }));

  router.post('/suggestions/:id/accept', handle<IdParams>((req, res) => {
    if (!suggestions.accept(req.params.id)) throw new ServiceError('No such suggestion', 'NOT_FOUND');
    res.json({ ok: true });
  }));

  router.get('/circadian', (_req, res) => {
    res.json({ ...circadian.getState(), timeline: circadian.getTimeline() });
  });

  // ── Rules ─────────────────────────────────────────────────────────────────

  router.get('/rules/debug', (_req, res) => res.json(rulesSvc.debugInfo()));

  router.get('/rules', (_req, res) => res.json(rulesSvc.getRules()));

  // Open dashboards update when rules change — including by voice or the assistant
  const rulesChanged = () => {
    io.emit('lighting:rules', rulesSvc.getRules());
    controller.emitZones();
  };

  // Who changed it (and, from the assistant, why) goes into the rule change history.
  // `reason` rides along in the body; it isn't part of the rule.
  const changeMeta = (req: express.Request<object>) => {
    const { reason } = (req.body ?? {}) as { reason?: unknown };
    return { by: requestSource(req), ...(typeof reason === 'string' && reason && { reason }) };
  };
  // A rule's target may come as a name ("Living Room", "Desk Lamp"); it's stored by id.
  const ruleBody = <T>(req: express.Request<object>): T => {
    const { reason: _reason, source: _source, ...rule } = (req.body ?? {}) as Record<string, unknown>;
    const action = rule.action as { group?: string } | undefined;
    if (action?.group && action.group !== 'all' && !roomsSvc.getRoom(action.group) && !mqttManager.groups[action.group]) {
      const room  = roomsSvc.findRoom(action.group);
      const bulbs = room ? [] : controller.resolveTargets(action.group);
      if (!room && bulbs.length !== 1) throw new ServiceError(`No light or room named "${action.group}"`, 'NOT_FOUND');
      rule.action = { ...action, group: room ?? bulbs[0] };
    }
    return rule as T;
  };

  router.post('/rules', handle((req, res) => {
    res.json(rulesSvc.create(ruleBody<rulesSvc.NewRule>(req), changeMeta(req)));
    rulesChanged();
  }));

  router.patch('/rules/:id', handle<IdParams>((req, res) => {
    res.json(rulesSvc.update(req.params.id, ruleBody<Partial<Rule>>(req), changeMeta(req)));
    rulesChanged();
  }));

  router.delete('/rules/:id', handle<IdParams>((req, res) => {
    rulesSvc.remove(req.params.id, changeMeta(req));
    rulesChanged();
    res.json({ ok: true });
  }));

  // The last 30 days of rule changes, newest first, and the deleted rules among them
  router.get('/rule-changes', (_req, res) => res.json(rulesSvc.changes()));
  router.get('/rule-changes/removed', (_req, res) => res.json(rulesSvc.removedRules()));

  // Undo one change: restores a deleted rule, puts an edit back, or removes a new rule
  router.post('/rule-changes/:id/undo', handle<IdParams>((req, res) => {
    res.json({ ok: true, rule: rulesSvc.undo(req.params.id, changeMeta(req)) });
    rulesChanged();
  }));

  // ── Presence (sensors by IEEE address) ───────────────────────────────────

  router.get('/presence', (_req, res) => res.json(presenceSvc.getState()));

  router.post('/presence', handle((req, res) => {
    res.json(presenceSvc.create(req.body as presenceSvc.CreateParams));
  }));

  router.patch('/presence/:id', handle<IdParams>((req, res) => {
    res.json(presenceSvc.update(req.params.id, req.body as Partial<PresenceConfigEntry>));
  }));

  router.delete('/presence/:id', handle<IdParams>((req, res) => {
    presenceSvc.remove(req.params.id);
    res.json({ ok: true });
  }));

  // ── Rooms (by id) ─────────────────────────────────────────────────────────

  router.get('/rooms', (_req, res) => res.json(roomsSvc.get()));

  router.post('/rooms', handle((req, res) => {
    const { name } = req.body as { name?: string };
    const id = roomsSvc.create(name ?? '');
    emitRooms();
    res.json({ ok: true, id });
  }));

  // Must come before /:id routes so Express doesn't treat "assign" as an :id
  router.post('/rooms/assign', handle((req, res) => {
    const { device, room } = req.body as { device?: string; room?: string | null };
    if (!device) throw new ServiceError('device required', 'INVALID');
    roomsSvc.assignDevice(device, room ?? null);
    emitRooms();
    res.json({ ok: true });
  }));

  router.patch('/rooms/:id', handle<IdParams>((req, res) => {
    const { name } = req.body as { name?: string };
    roomsSvc.rename(req.params.id, name ?? '');
    emitRooms();
    res.json({ ok: true });
  }));

  router.delete('/rooms/:id', handle<IdParams>((req, res) => {
    roomsSvc.remove(req.params.id);
    emitRooms();
    res.json({ ok: true });
  }));

  // ── Devices ──────────────────────────────────────────────────────────────

  router.get('/state', (_req, res) => {
    res.json(mqttManager.getState());
  });

  router.get('/devices', (_req, res) => {
    res.json(mqttManager.getDevicesState());
  });

  router.get('/sensors', (_req, res) => {
    res.json(mqttManager.getSensorsState());
  });

  router.post('/sensors/:id/set', handle<IdParams>((req, res) => {
    mqttManager.setSensorProperty(req.params.id, req.body as Record<string, unknown>);
    res.json({ ok: true });
  }));

  router.post('/pair', (req, res) => {
    const { enable } = req.body as { enable?: boolean };
    mqttManager.permitJoin(!!enable);
    res.json({ ok: true });
  });

  // Zigbee2MQTT accepts either the friendly name or the IEEE address for both of these.
  router.post('/devices/rename', handle((req, res) => {
    const { from, to } = req.body as { from?: string; to?: string };
    if (!from || !to) throw new ServiceError('from and to required', 'INVALID');
    mqttManager.renameDevice(from, to);
    res.json({ ok: true });
  }));

  router.post('/devices/remove', handle((req, res) => {
    const { id } = req.body as { id?: string };
    if (!id) throw new ServiceError('id required', 'INVALID');
    mqttManager.removeDevice(id);
    res.json({ ok: true });
  }));

  return router;
}
