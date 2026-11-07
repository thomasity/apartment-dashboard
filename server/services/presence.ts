import * as config from '../config';
import { ServiceError } from '../util';
import * as controller from './controller';
import * as activity from './activity';
import type { MqttManager } from '../mqtt/client';
import type { OccupancyEvent, PresenceConfigEntry, PresenceConfigMap, PresenceEntry } from '../types';

// Sensors are keyed by IEEE address and point at a room id. Presence never touches bulbs
// itself: it asks the controller, and while a rule window is in effect it follows that
// rule's presence setting (ignore / normal / custom look).

const DEFAULT_VACANT_MINUTES     = 5;
const DEFAULT_MANUAL_OFF_MINUTES = 120;

export interface CreateParams {
  sensor:                    string;
  room:                      string;
  vacantAfterMinutes?:       number;
  manualOffCooldownMinutes?: number;
  enabled?:                  boolean;
}

let mqttMgr: MqttManager | null = null;

/** room → pending "turn off after vacant" timeout */
const vacancyTimers  = new Map<string, NodeJS.Timeout>();
/** room → when its pending vacancy timer fires (ms) */
const vacancyAt      = new Map<string, number>();
/** room → timestamp ms; suppresses auto-on until this passes */
const manualOffUntil = new Map<string, number>();
/** rooms whose current cooldown has already logged a blocked switch-on — once is enough */
const blockLogged    = new Set<string>();
/** sensor → last reported occupancy. Sensors (mmWave especially) repeat the same value
 *  constantly; only a change should start a timer or switch lights. */
const lastOccupancy  = new Map<string, boolean>();

function getConfig(): PresenceConfigMap { return config.get('presence') ?? {}; }

function saveConfig(c: PresenceConfigMap): void { config.set('presence', c); }

function clearVacancyTimer(room: string): void {
  clearTimeout(vacancyTimers.get(room));
  vacancyTimers.delete(room);
  vacancyAt.delete(room);
}

/**
 * Registers (or re-registers) a sensor → room mapping. Call again with the same
 * sensor name to fully replace its config.
 */
export function create({ sensor, room, vacantAfterMinutes, manualOffCooldownMinutes, enabled = true }: CreateParams): PresenceEntry {
  if (!sensor || !room) throw new ServiceError('sensor and room required', 'INVALID');
  const cfg = getConfig();
  const entry: PresenceConfigEntry = {
    room,
    vacantAfterMinutes:       vacantAfterMinutes       ?? DEFAULT_VACANT_MINUTES,
    manualOffCooldownMinutes: manualOffCooldownMinutes ?? DEFAULT_MANUAL_OFF_MINUTES,
    enabled,
  };
  cfg[sensor] = entry;
  saveConfig(cfg);
  return { sensor, ...entry, occupancy: null, manualOffUntil: null, vacancyTimerActive: false };
}

export function update(sensor: string, patch: Partial<PresenceConfigEntry>): PresenceConfigEntry & { sensor: string } {
  const cfg = getConfig();
  const existing = cfg[sensor];
  if (!existing) throw new ServiceError('Presence sensor not configured', 'NOT_FOUND');
  const updated = { ...existing, ...patch };
  cfg[sensor] = updated;
  saveConfig(cfg);
  return { sensor, ...updated };
}

export function remove(sensor: string): void {
  const cfg  = getConfig();
  const room = cfg[sensor]?.room;
  delete cfg[sensor];
  saveConfig(cfg);
  if (room) clearVacancyTimer(room);
}

export function getState(): PresenceEntry[] {
  const sensorsState = mqttMgr?.getSensorsState() ?? {};
  return Object.entries(getConfig()).map(([sensor, c]) => ({
    sensor,
    ...c,
    occupancy:          sensorsState[sensor]?.occupancy ?? null,
    manualOffUntil:     manualOffUntil.get(c.room) ?? null,
    vacancyTimerActive: vacancyTimers.has(c.room),
  }));
}

/**
 * Called from the lighting routes whenever a room's power is set by the user (dashboard,
 * voice, etc.) — as opposed to presence's own automatic setPower calls below, which
 * must NOT feed back into this. Turning off starts the "don't auto-on" cooldown for the
 * room's configured sensor(s); turning back on clears it early.
 */
export function recordManualPower(room: string, on: boolean): void {
  blockLogged.delete(room);
  if (on) {
    manualOffUntil.delete(room);
    return;
  }
  const entry = Object.values(getConfig()).find((c) => c.room === room);
  if (!entry) return; // no presence sensor configured for this room — nothing to suppress
  manualOffUntil.set(room, Date.now() + Math.max(1, entry.manualOffCooldownMinutes) * 60000);
}

/** "Let the sensor work again": end a room's cooldown early. Returns whether one was running. */
export function clearCooldown(room: string): boolean {
  blockLogged.delete(room);
  const until = manualOffUntil.get(room);
  manualOffUntil.delete(room);
  return !!until && until > Date.now();
}

export interface RoomPresenceStatus {
  /** Sensors pointed at this room */
  sensors:       number;
  enabled:       boolean;
  /** Suppressing auto-on until (ms), if running */
  cooldownUntil: number | null;
  /** Minutes the cooldown lasts, to tell when it started */
  cooldownMinutes: number;
  /** When the room will switch off for being empty (ms), if pending */
  vacantOffAt:   number | null;
}

export function roomStatus(room: string): RoomPresenceStatus {
  const entries = Object.values(getConfig()).filter((c) => c.room === room);
  const until   = manualOffUntil.get(room);
  return {
    sensors:         entries.length,
    enabled:         entries.some((c) => c.enabled !== false),
    cooldownUntil:   until && until > Date.now() ? until : null,
    cooldownMinutes: entries[0]?.manualOffCooldownMinutes ?? DEFAULT_MANUAL_OFF_MINUTES,
    vacantOffAt:     vacancyAt.get(room) ?? null,
  };
}

function handleOccupancy({ sensor, occupancy }: OccupancyEvent): void {
  const previous = lastOccupancy.get(sensor);
  lastOccupancy.set(sensor, occupancy);
  if (previous === occupancy) return;

  const cfg = getConfig()[sensor];
  if (!cfg || cfg.enabled === false) return;
  const { room, vacantAfterMinutes } = cfg;

  // A rule window in effect decides what presence may do; "ignore" means neither on nor off.
  const policy = controller.presencePolicy(room);
  if (policy?.mode === 'ignore') return;

  clearVacancyTimer(room);

  if (occupancy) {
    const suppressUntil = manualOffUntil.get(room);
    if (suppressUntil && Date.now() < suppressUntil) {
      console.log(`[presence] ${room}: occupancy detected but manual-off cooldown active, skipping auto-on`);
      if (!blockLogged.has(room)) {
        blockLogged.add(room);
        activity.record({ zone: room, source: 'presence', action: 'blocked', note: 'cooldown' });
      }
      return;
    }
    // Only switch on a dark room — if any light is already on, someone set it that way.
    const off   = new Set(mqttMgr?.poweredOff ?? []);
    const bulbs = controller.zoneBulbs(room);
    if (bulbs.length === 0 || !bulbs.every((g) => off.has(g))) return;
    controller.presenceOn(room, policy?.mode === 'custom'
      ? { brightness: policy.brightness ?? 10, colorTemp: policy.colorTemp ?? 0 }
      : undefined);
  } else {
    const minutes = policy?.mode === 'custom' && policy.vacantAfterMinutes ? policy.vacantAfterMinutes : vacantAfterMinutes;
    const ms = Math.max(1, minutes) * 60000;
    vacancyAt.set(room, Date.now() + ms);
    vacancyTimers.set(room, setTimeout(() => {
      vacancyTimers.delete(room);
      vacancyAt.delete(room);
      controller.presenceOff(room);
      console.log(`[presence] ${room}: vacant, lights off`);
    }, ms));
  }
}

export function init(mgr: MqttManager): void {
  mqttMgr = mgr;
  mgr.on('occupancyChange', handleOccupancy);
}
