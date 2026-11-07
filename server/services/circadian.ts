import suncalc from 'suncalc';
import { LAT, LON } from '../location';
import type { CircadianPoint, CircadianState, LightValues } from '../types';

// The Auto look, from the sun's altitude. Which zones follow it is the lighting
// controller's call; this module just computes the curve and ticks it forward.

const INTERVAL_MS = 15 * 60 * 1000;

let intervalId:  NodeJS.Timeout | null = null;
let lastApplied: number | null         = null;
let current:     LightValues           = computeValues();

export function computeValues(date = new Date()): LightValues {
  const { altitude } = suncalc.getPosition(date, LAT, LON);
  if (altitude <= 0) return { brightness: 20, colorTemp: 5 };
  const t = Math.min(1, altitude / (Math.PI / 4));
  return {
    brightness: Math.round(35 + 65 * t),
    colorTemp:  Math.round(10 + 70 * t),
  };
}

/** The Auto look right now (as of the last tick). */
export function currentValues(): LightValues {
  return current;
}

export function getState(): CircadianState {
  return {
    brightness: current.brightness,
    colorTemp:  current.colorTemp,
    nextChange: lastApplied ? new Date(lastApplied + INTERVAL_MS).toISOString() : null,
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

/** Recomputes now and every 15 minutes, calling `onTick` with the new look each time. */
export function start(onTick: (values: LightValues) => void): void {
  const tick = () => {
    current     = computeValues();
    lastApplied = Date.now();
    onTick(current);
  };
  if (intervalId) clearInterval(intervalId);
  tick();
  intervalId = setInterval(tick, INTERVAL_MS);
}

export function stop(): void {
  if (intervalId) clearInterval(intervalId);
  intervalId = null;
}
