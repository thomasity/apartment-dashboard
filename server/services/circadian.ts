import suncalc from 'suncalc';
import * as config from '../config';
import type { MqttManager } from '../mqtt/client';
import type { AppServer, CircadianPoint, CircadianState, LightValues } from '../types';

const LAT = parseFloat(process.env.LAT || '40.7128');
const LON = parseFloat(process.env.LON || '-74.0060');
const INTERVAL_MS = 15 * 60 * 1000;

type IsOverriddenFn = (group: string) => boolean;

const enabledGroups = new Set<string>();
let intervalId:   NodeJS.Timeout | null = null;
let mqttMgr:      MqttManager | null    = null;
let io:           AppServer | null      = null;
let lastApplied:  number | null         = null;
let current:      LightValues           = { brightness: 50, colorTemp: 50 };
let isOverridden: IsOverriddenFn        = () => false;

function saveEnabledGroups(): void {
  config.set('circadianGroups', [...enabledGroups]);
}

function computeValues(date = new Date()): LightValues {
  const { altitude } = suncalc.getPosition(date, LAT, LON);
  if (altitude <= 0) return { brightness: 20, colorTemp: 5 };
  const t = Math.min(1, altitude / (Math.PI / 4));
  return {
    brightness: Math.round(35 + 65 * t),
    colorTemp:  Math.round(10 + 70 * t),
  };
}

function startInterval(): void {
  if (!intervalId && enabledGroups.size > 0) {
    intervalId = setInterval(apply, INTERVAL_MS);
  }
}

function apply(): void {
  const mgr = mqttMgr;
  if (!mgr || enabledGroups.size === 0) return;
  current     = computeValues();
  lastApplied = Date.now();
  enabledGroups.forEach((g) => { if (!isOverridden(g)) mgr.setGroup(g, current); });
  io?.emit('lighting:circadian', getState());
}

export function getState(): CircadianState {
  return {
    enabledGroups: [...enabledGroups],
    brightness:    current.brightness,
    colorTemp:     current.colorTemp,
    nextChange:    enabledGroups.size > 0 && lastApplied
      ? new Date(lastApplied + INTERVAL_MS).toISOString()
      : null,
  };
}

export function getTimeline(): CircadianPoint[] {
  const today = new Date();
  return Array.from({ length: 24 }, (_, h) => {
    const d = new Date(today);
    d.setHours(h, 0, 0, 0);
    return { hour: h, ...computeValues(d) };
  });
}

export function init(mgr: MqttManager, server: AppServer, overridden?: IsOverriddenFn): void {
  mqttMgr      = mgr;
  io           = server;
  isOverridden = overridden ?? (() => false);

  // Restore persisted auto groups
  (config.get('circadianGroups') ?? []).forEach((g) => enabledGroups.add(g));
  if (enabledGroups.size > 0) {
    apply();
    startInterval();
  }
}

export function enable(group: string): void {
  if (group === 'all') {
    Object.keys(mqttMgr?.groups ?? {}).forEach((g) => enabledGroups.add(g));
  } else {
    enabledGroups.add(group);
  }
  saveEnabledGroups();
  apply();
  startInterval();
}

export function disable(group: string): void {
  if (group === 'all') {
    enabledGroups.clear();
  } else {
    enabledGroups.delete(group);
  }
  saveEnabledGroups();
  if (enabledGroups.size === 0 && intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
  io?.emit('lighting:circadian', getState());
}

/** Re-apply current circadian values to one group immediately (used when override expires). */
export function applyToGroup(group: string): void {
  if (!mqttMgr || !enabledGroups.has(group)) return;
  mqttMgr.setGroup(group, computeValues());
}
