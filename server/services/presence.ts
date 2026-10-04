import * as config from '../config';
import { ServiceError } from '../util';
import type { MqttManager } from '../mqtt/client';
import type { OccupancyEvent, PresenceConfigEntry, PresenceConfigMap, PresenceEntry } from '../types';
import type * as RoomsService from './rooms';

const DEFAULT_VACANT_MINUTES     = 5;
const DEFAULT_MANUAL_OFF_MINUTES = 120;

export interface CreateParams {
  sensor:                    string;
  room:                      string;
  vacantAfterMinutes?:       number;
  manualOffCooldownMinutes?: number;
  enabled?:                  boolean;
}

let mqttMgr:  MqttManager | null          = null;
let roomsSvc: typeof RoomsService | null  = null;

/** room → pending "turn off after vacant" timeout */
const vacancyTimers  = new Map<string, NodeJS.Timeout>();
/** room → timestamp ms; suppresses auto-on until this passes */
const manualOffUntil = new Map<string, number>();

function getConfig(): PresenceConfigMap { return config.get('presence') ?? {}; }

function saveConfig(c: PresenceConfigMap): void { config.set('presence', c); }

function clearVacancyTimer(room: string): void {
  clearTimeout(vacancyTimers.get(room));
  vacancyTimers.delete(room);
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
  if (on) {
    manualOffUntil.delete(room);
    return;
  }
  const entry = Object.values(getConfig()).find((c) => c.room === room);
  if (!entry) return; // no presence sensor configured for this room — nothing to suppress
  manualOffUntil.set(room, Date.now() + Math.max(1, entry.manualOffCooldownMinutes) * 60000);
}

function setRoomPower(room: string, on: boolean): void {
  roomsSvc?.getDevices(room).forEach((g) => mqttMgr?.setPower(g, on));
}

function handleOccupancy({ name, occupancy }: OccupancyEvent): void {
  const cfg = getConfig()[name];
  if (!cfg || cfg.enabled === false) return;
  const { room, vacantAfterMinutes } = cfg;

  clearVacancyTimer(room);

  if (occupancy) {
    const suppressUntil = manualOffUntil.get(room);
    if (suppressUntil && Date.now() < suppressUntil) {
      console.log(`[presence] ${room}: occupancy detected but manual-off cooldown active, skipping auto-on`);
      return;
    }
    setRoomPower(room, true);
  } else {
    const ms = Math.max(1, vacantAfterMinutes) * 60000;
    vacancyTimers.set(room, setTimeout(() => {
      vacancyTimers.delete(room);
      setRoomPower(room, false);
      console.log(`[presence] ${room}: vacant, lights off`);
    }, ms));
  }
}

export function init(mgr: MqttManager, rooms: typeof RoomsService): void {
  mqttMgr  = mgr;
  roomsSvc = rooms;
  mgr.on('occupancyChange', handleOccupancy);
}
