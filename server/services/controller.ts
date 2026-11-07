import * as config from '../config';
import * as roomsSvc from './rooms';
import * as circadian from './circadian';
import * as rulesSvc from './rules';
import * as activity from './activity';
import type { MqttManager } from '../mqtt/client';
import type { ActivityEntry, ActivitySource, AppServer, LightValues, Rule, RulePresence, ZoneRuntime, ZoneState } from '../types';

// The one place that decides what lights look like. Sources (dashboard/voice, rules,
// presence, Auto) never talk to bulbs themselves — they call into here, and the look of
// each bulb is resolved per zone (a room, or a bulb not in one) in priority order:
//
//   1. a manual session  — any manual change starts one for the whole zone; it lasts
//                          until the zone is off, however it got there
//   2. presence's look   — when presence switched the zone on under a rule's custom look
//   3. the latest rule window covering the zone, if it sets a look (scene / auto)
//   4. Auto (circadian), if the zone is on Auto
//   5. nothing           — the bulb is left as it is
//
// Power is event-driven (a rule starting, presence, you); looks are state: reconcile()
// re-resolves and only sends what changed. Every event is recorded in the activity log
// with its source; Auto's drift isn't.

let mgr: MqttManager | null = null;
let io:  AppServer | null   = null;

/** bulb → look the controller last sent it, so reconciling doesn't re-send the same thing */
const lastSent = new Map<string, string>();

const knownBulbs = (): string[] => Object.keys(mgr?.groups ?? {});
const zoneMap    = (): Record<string, string[]> => roomsSvc.zones(knownBulbs());
const runtime    = (): Record<string, ZoneRuntime> => config.get('zones') ?? {};
const saveRuntime = (r: Record<string, ZoneRuntime>): void => config.set('zones', r);
const autoZones  = (): Set<string> => new Set(config.get('autoZones') ?? []);
const isOff      = (bulb: string): boolean => mgr?.poweredOff.has(bulb) ?? true;

// ── Targets ─────────────────────────────────────────────────────────────────

/** A bulb address from an address or a (case-insensitive) friendly name. */
function findBulb(idOrName: string): string | null {
  const groups = mgr?.groups ?? {};
  if (groups[idOrName]) return idOrName;
  const lower = idOrName.trim().toLowerCase();
  return Object.keys(groups).find((id) => groups[id]!.label.toLowerCase() === lower) ?? null;
}

/** "all"/nothing, a room (id or name), or a bulb (address or name) → bulb addresses. */
export function resolveTargets(target?: string): string[] {
  if (!target || target === 'all') return knownBulbs();
  const room = roomsSvc.findRoom(target);
  if (room) return zoneMap()[room] ?? [];
  const bulb = findBulb(target);
  return bulb ? [bulb] : [];
}

/** Same targets, as the zones they fall in. */
export function zonesForTarget(target?: string): string[] {
  const zones = zoneMap();
  if (!target || target === 'all') return Object.keys(zones).filter((z) => zones[z]!.length > 0);
  const room = roomsSvc.findRoom(target);
  if (room) return [room];
  const bulb = findBulb(target);
  return bulb ? [roomsSvc.zoneOf(bulb)] : [];
}

export function zoneBulbs(zone: string): string[] {
  return zoneMap()[zone] ?? [];
}

/** A zone's display name: the room's name, or the bulb's. */
export function zoneName(zone: string): string {
  return roomsSvc.getRoom(zone)?.name ?? mgr?.groups[zone]?.label ?? zone;
}

export function isZoneOn(zone: string): boolean {
  return zoneBulbs(zone).some((b) => !isOff(b));
}

/** Names of the zone's bulbs the bridge can't reach. */
export function offlineBulbs(zone: string): string[] {
  const availability = mgr?.availability ?? {};
  return zoneBulbs(zone).filter((b) => availability[b] === false).map((b) => mgr!.groups[b]?.label ?? b);
}

export function zoneRuntime(zone: string): ZoneRuntime {
  return runtime()[zone] ?? {};
}

const bulbLook = (bulb: string): LightValues | undefined => {
  const g = mgr?.groups[bulb];
  return g && { brightness: g.brightness, colorTemp: g.colorTemp };
};

/**
 * Logs one entry per zone the bulbs fall in. `bulbs` is only set on the entry when they
 * aren't the whole zone — by default every bulb in it; `whole` can narrow that (a room
 * slider moves only the bulbs that are on, and that still counts as the room).
 */
function recordForBulbs(
  bulbs: string[],
  entry: Pick<ActivityEntry, 'source' | 'action'>,
  whole: (zone: string) => string[] = zoneBulbs,
): void {
  const byZone = new Map<string, string[]>();
  bulbs.forEach((b) => {
    const zone = roomsSvc.zoneOf(b);
    byZone.set(zone, [...(byZone.get(zone) ?? []), b]);
  });
  for (const [zone, touched] of byZone) {
    const isWhole = whole(zone).every((b) => touched.includes(b));
    activity.record({
      ...entry, zone,
      ...(entry.action !== 'off' && { look: bulbLook(touched[0]!) }),
      ...(!isWhole && { bulbs: touched }),
    });
  }
}

// ── Resolution ──────────────────────────────────────────────────────────────

/** The active rule window that decides for `zone`: the one that started most recently. */
export function governingWindow(zone: string): rulesSvc.ActiveWindow | null {
  let best: rulesSvc.ActiveWindow | null = null;
  for (const w of rulesSvc.activeWindows()) {
    if (!zonesForTarget(w.rule.action.group).includes(zone)) continue;
    if (!best || w.start > best.start) best = w;
  }
  return best;
}

function ruleLook(rule: Rule): LightValues | null {
  const { action } = rule;
  if (action.config === 'scene') {
    return { brightness: action.brightness ?? 70, colorTemp: action.colorTemp ?? 30 };
  }
  if (action.config === 'auto') return circadian.currentValues();
  return null;
}

export function resolveLook(zone: string, bulb: string): LightValues | null {
  const rt = runtime()[zone];
  if (rt?.manual) return rt.manual.looks[bulb] ?? null;
  if (rt?.presenceLook) return rt.presenceLook;
  const window = governingWindow(zone);
  const fromRule = window && ruleLook(window.rule);
  if (fromRule) return fromRule;
  if (autoZones().has(zone)) return circadian.currentValues();
  return null;
}

/** What presence may do in `zone` right now — null when no rule window applies. */
export function presencePolicy(zone: string): RulePresence | null {
  const window = governingWindow(zone);
  return window ? (window.rule.presence ?? { mode: 'normal' }) : null;
}

// ── Sending ─────────────────────────────────────────────────────────────────

function sendLook(bulb: string, look: LightValues): void {
  if (!mgr || isOff(bulb)) return;
  const key = JSON.stringify(look);
  if (lastSent.get(bulb) === key) return;
  lastSent.set(bulb, key);
  mgr.setGroup(bulb, look);
}

function powerOn(bulb: string, look?: LightValues | null): void {
  if (!mgr) return;
  const resolved = look ?? resolveLook(roomsSvc.zoneOf(bulb), bulb);
  if (resolved) lastSent.set(bulb, JSON.stringify(resolved));
  mgr.setPower(bulb, true, resolved ?? undefined);
}

function powerOff(bulb: string): void {
  mgr?.setPower(bulb, false);
}

/** Re-resolve and send looks for these zones (default: all). */
export function reconcile(zones?: string[]): void {
  const map = zoneMap();
  for (const zone of zones ?? Object.keys(map)) {
    for (const bulb of map[zone] ?? []) {
      const look = resolveLook(zone, bulb);
      if (look) sendLook(bulb, look);
    }
  }
  emitZones();
}

// ── Sessions ────────────────────────────────────────────────────────────────

// A zone that's fully off has no session and no presence look — that's what "the
// session ends when the room goes off" means, whoever switched it off. Also drops
// state for zones that no longer exist (room deleted, bulb moved into a room).
function endSessionsForDarkZones(): void {
  const rt = runtime();
  const map = zoneMap();
  let changed = false;
  for (const zone of Object.keys(rt)) {
    const bulbs = map[zone];
    if (bulbs && bulbs.length > 0 && !bulbs.every(isOff)) continue;
    delete rt[zone];
    changed = true;
  }
  if (!changed) return;
  saveRuntime(rt);
  emitZones();
}

// ── Sources ─────────────────────────────────────────────────────────────────

/** You changed brightness/colour (dashboard, voice): starts or extends a manual session. */
export function manualSet(bulbs: string[], values: Partial<LightValues>, source: ActivitySource = 'dashboard'): void {
  if (!mgr) return;
  const rt = runtime();
  const touched = bulbs.filter((b) => !isOff(b)); // nothing to adjust on a dark bulb
  for (const bulb of touched) {
    const zone  = roomsSvc.zoneOf(bulb);
    const entry = (rt[zone] ??= {});
    if (!entry.manual) {
      // The whole zone freezes at its current look, not just the bulb you touched
      const looks: Record<string, LightValues> = {};
      for (const b of zoneBulbs(zone)) {
        const g = mgr.groups[b];
        if (g) looks[b] = { brightness: g.brightness, colorTemp: g.colorTemp };
      }
      entry.manual = { startedAt: Date.now(), looks };
    }
    const current = mgr.groups[bulb]!;
    const look = { brightness: current.brightness, colorTemp: current.colorTemp, ...entry.manual.looks[bulb], ...values };
    entry.manual.looks[bulb] = look;
    lastSent.set(bulb, JSON.stringify(look));
    mgr.setGroup(bulb, values);
  }
  saveRuntime(rt);
  // A room slider touches every bulb that's on — that counts as the whole room
  recordForBulbs(touched, { source, action: 'set' }, (zone) => zoneBulbs(zone).filter((b) => !isOff(b)));
  emitZones();
}

/** You switched lights on or off. On comes up with the zone's resolved look. */
export function manualPower(bulbs: string[], on: boolean, source: ActivitySource = 'dashboard'): void {
  bulbs.forEach((b) => (on ? powerOn(b) : powerOff(b)));
  recordForBulbs(bulbs, { source, action: on ? 'on' : 'off' });
  endSessionsForDarkZones();
}

/** "Resume": end a zone's manual session now. Returns whether there was one. */
export function endManual(zone: string): boolean {
  const rt = runtime();
  const had = !!rt[zone]?.manual;
  if (had) {
    delete rt[zone]!.manual;
    saveRuntime(rt);
  }
  reconcile([zone]);
  return had;
}

/** The Auto toggle. Turning it on also hands the zone back from any manual session. */
export function setAuto(zones: string[], enabled: boolean, source: ActivitySource = 'dashboard'): void {
  const auto = autoZones();
  const rt   = runtime();
  for (const zone of zones) {
    if (auto.has(zone) !== enabled) activity.record({ zone, source, action: enabled ? 'auto-on' : 'auto-off' });
    if (enabled) {
      auto.add(zone);
      if (rt[zone]?.manual) delete rt[zone]!.manual;
    } else {
      auto.delete(zone);
    }
  }
  config.set('autoZones', [...auto]);
  saveRuntime(rt);
  reconcile(zones);
}

export function isAuto(zone: string): boolean {
  return autoZones().has(zone);
}

/** Presence switched a dark zone on — optionally with a rule's custom (night-light) look. */
export function presenceOn(zone: string, look?: LightValues): void {
  if (look) {
    const rt = runtime();
    (rt[zone] ??= {}).presenceLook = look;
    saveRuntime(rt);
  }
  zoneBulbs(zone).forEach((b) => powerOn(b));
  activity.record({ zone, source: 'presence', action: 'on', look: look ?? bulbLook(zoneBulbs(zone)[0]!), ...(look && { note: 'night light' }) });
  emitZones();
}

export function presenceOff(zone: string): void {
  if (isZoneOn(zone)) activity.record({ zone, source: 'presence', action: 'off', note: 'empty' });
  zoneBulbs(zone).forEach(powerOff);
  endSessionsForDarkZones();
}

/** A rule's start (or late catch-up). Zones in a manual session are skipped unless the rule overrides them. */
export function ruleStart(rule: Rule): void {
  const { action } = rule;
  const rt = runtime();
  const overridden = new Set<string>();
  const zones = zonesForTarget(action.group).filter((zone) => {
    if (!rt[zone]?.manual) return true;
    if (!rule.overrideManual) {
      activity.record({ zone, source: 'rule', rule: rule.name, action: 'skipped', note: 'manual session' });
      return false;
    }
    delete rt[zone]!.manual;
    overridden.add(zone);
    return true;
  });
  saveRuntime(rt);

  // An instant rule changes the zone's standing setup: a scene takes it off Auto (the
  // look then stays until something changes it), 'auto' puts it on. A window's look only
  // lasts while it's in effect, which resolveLook already accounts for.
  let instantScene: LightValues | null = null;
  if (!rule.end && action.config === 'scene') {
    instantScene = ruleLook(rule);
    const auto = autoZones();
    zones.forEach((z) => auto.delete(z));
    config.set('autoZones', [...auto]);
  } else if (!rule.end && action.config === 'auto') {
    const auto = autoZones();
    zones.forEach((z) => auto.add(z));
    config.set('autoZones', [...auto]);
  }

  const bulbs = zones.flatMap(zoneBulbs);
  if (action.type === 'power' && action.on) {
    bulbs.forEach((b) => powerOn(b, instantScene));
  } else if (action.type === 'power') {
    bulbs.forEach(powerOff);
  } else if (instantScene) {
    bulbs.forEach((b) => sendLook(b, instantScene));
  }

  const look = ruleLook(rule);
  for (const zone of zones) {
    const entryAction =
        action.type === 'power' ? (action.on ? 'on' : 'off')
      : look                    ? 'set'
      : null;
    const autoAction = !rule.end && action.config === 'auto' ? 'auto-on' : null;
    const recorded = entryAction ?? autoAction;
    if (!recorded) continue;
    activity.record({
      zone, source: 'rule', rule: rule.name, action: recorded,
      ...(look && recorded !== 'off' && { look }),
      ...(overridden.has(zone) && { note: 'overrode manual' }),
    });
  }

  endSessionsForDarkZones();
  reconcile(zones);
}

// ── State for dashboards ────────────────────────────────────────────────────

export function getZonesState(): Record<string, ZoneState> {
  const rt   = runtime();
  const auto = autoZones();
  const result: Record<string, ZoneState> = {};
  for (const [zone, bulbs] of Object.entries(zoneMap())) {
    if (bulbs.length === 0 && !roomsSvc.getRoom(zone)) continue;
    const window = governingWindow(zone);
    const control: ZoneState['control'] =
        rt[zone]?.manual       ? 'manual'
      : rt[zone]?.presenceLook ? 'presence'
      : window && ruleLook(window.rule) ? 'rule'
      : auto.has(zone)         ? 'auto'
      : 'none';
    result[zone] = {
      auto:     auto.has(zone),
      control,
      ruleName: control === 'rule' ? window!.rule.name : null,
      until:    control === 'rule' ? window!.end.toISOString() : null,
    };
  }
  return result;
}

export function emitZones(): void {
  io?.emit('lighting:zones', getZonesState());
}

export function init(manager: MqttManager, server: AppServer): void {
  mgr = manager;
  io  = server;
  lastSent.clear();

  manager.on('stateChange', endSessionsForDarkZones);
  manager.on('devicesChange', emitZones);
  // Wall switch: a bulb coming back from no power counts as you switching it on, with
  // whatever look its zone should have — never a replay of an old "off".
  manager.on('availabilityChange', ({ id, online, previous }) => {
    if (!manager.groups[id]) return;
    const zone = roomsSvc.zoneOf(id);
    if (online && previous === false) {
      powerOn(id);
      activity.record({ zone, source: 'wall', action: 'on' });
    } else if (!online && previous === true) {
      activity.record({ zone, source: 'wall', action: 'off' });
    }
  });

  circadian.start(() => reconcile());
}
