import * as controller from './controller';
import * as home from './home';
import * as patterns from './patterns';
import { history } from './history';
import { dateKey } from './rules';
import { errorMessage } from '../util';
import type { MqttManager } from '../mqtt/client';

// What wakes the assistant on its own. Each trigger fires at most once for its occasion,
// and the whole thing is capped per day, so it costs a handful of model calls a day:
//
//   arrival     — Thomas is inside (phone home, then living-room motion)
//   day-start   — the first movement of his day
//   habit       — HABIT_LEAD_MIN before something he usually does (music, lights)
//   away-lights — he's been out AWAY_LIGHTS_MIN and lights are still on
//   nightly     — its review at 3:45 AM (learn from the day, look after the rules)
//
// The assistant itself decides whether to do anything; "nothing" is the usual answer.

export type Runner = (r: { trigger: 'event' | 'nightly'; event: string }) => Promise<string>;

const RUNS_PER_DAY    = 12;
const MIN_GAP_MS      = 5 * 60_000;
const HABIT_LEAD_MIN  = 5;
const AWAY_LIGHTS_MIN = 30;
const DAY_START_HOUR  = 4;
const NIGHTLY_AT      = 3 * 60 + 45;
const CHECK_MS        = 60_000;

let run: Runner | null = null;
let runs = { day: '', count: 0 };
let lastRunAt = 0;
let busy = false;
/** Occasions already handled: "day-start|2026-06-22", "habit|<text>|2026-06-22", "away|<since>" */
const fired = new Set<string>();
let timers: NodeJS.Timeout[] = [];

/** Wake the assistant for an event, within the limits. Returns false when held back. */
export async function fire(key: string, event: string, { urgent = false } = {}): Promise<boolean> {
  if (!run || fired.has(key)) return false;
  const now = Date.now();
  const today = dateKey(new Date(now));
  if (runs.day !== today) runs = { day: today, count: 0 };
  if (busy || runs.count >= RUNS_PER_DAY || (!urgent && now - lastRunAt < MIN_GAP_MS)) return false;

  fired.add(key);
  busy = true;
  runs.count++;
  lastRunAt = now;
  try {
    await run({ trigger: 'event', event });
  } catch (err) {
    console.error('[assistant] run failed:', errorMessage(err));
  } finally {
    busy = false;
  }
  return true;
}

function onInside(): void {
  const left = home.lastLeft();
  const back = home.lastArrived() ?? Date.now(); // the phone returning, before he walked in
  const happened = left
    ? history({ since: left, categories: ['lights', 'music', 'tv', 'rules'], limit: 8 })
      .filter((l) => l.at <= back).map((l) => l.text)
    : [];
  void fire(`arrival|${Date.now()}`, `Thomas just got home and is in the living room.${
    happened.length ? ` While he was out: ${happened.join('; ')}.` : ''}`, { urgent: true });
}

function onMotion(): void {
  const now = new Date();
  if (now.getHours() < DAY_START_HOUR || home.isHome() === false) return;
  void fire(`day-start|${dateKey(now)}`, 'Thomas\'s day just started — his first movement this morning.');
}

/** Every minute: a habit coming up, or lights left on while he's out. */
export function check(now = new Date()): void {
  const today = dateKey(now);
  const minutes = now.getHours() * 60 + now.getMinutes();

  if (home.isHome() !== false) {
    const weekend = now.getDay() === 0 || now.getDay() === 6;
    const p = patterns.current(now.getTime());
    for (const h of weekend ? p.weekends : p.weekdays) {
      if (h.kind !== 'music' && h.kind !== 'lights') continue;
      if ((h.minutes - minutes + 1440) % 1440 !== HABIT_LEAD_MIN) continue;
      void fire(`habit|${h.text}|${today}`, `In about ${HABIT_LEAD_MIN} minutes Thomas usually: ${h.text}.`);
    }
  }

  const away = home.awayFor(now.getTime());
  if (away !== null && away >= AWAY_LIGHTS_MIN * 60_000) {
    const on = Object.keys(controller.getZonesState()).filter(controller.isZoneOn).map(controller.zoneName);
    if (on.length) {
      void fire(`away|${home.lastLeft()}`, `Thomas has been out for ${Math.round(away / 60_000)} minutes and these lights are still on: ${on.join(', ')}.`);
    }
  }
}

function msUntil(minuteOfDay: number, now = new Date()): number {
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate(), Math.floor(minuteOfDay / 60), minuteOfDay % 60);
  if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1);
  return next.getTime() - now.getTime();
}

function scheduleNightly(): void {
  const t = setTimeout(async () => {
    try {
      await run?.({ trigger: 'nightly', event: 'Nightly review.' });
    } catch (err) {
      console.error('[assistant] nightly review failed:', errorMessage(err));
    }
    scheduleNightly();
  }, msUntil(NIGHTLY_AT));
  t.unref?.();
  timers.push(t);
}

/** Start listening for triggers. Only from index.ts, and only with a Claude API key. */
export function start(mgr: MqttManager, runner: Runner): void {
  stop();
  run = runner;
  home.homeEvents.on('inside', onInside);
  mgr.on('occupancyChange', ({ occupancy }) => { if (occupancy) onMotion(); });
  const interval = setInterval(() => check(), CHECK_MS);
  interval.unref?.();
  timers.push(interval);
  scheduleNightly();
}

export function stop(): void {
  timers.forEach((t) => clearTimeout(t));
  timers = [];
  home.homeEvents.off('inside', onInside);
  run = null;
  fired.clear();
  runs = { day: '', count: 0 };
  lastRunAt = 0;
}
