import * as config from '../config';
import * as activity from './activity';
import * as controller from './controller';
import { occupancyHistory } from './presence';
import { mediaLog } from './media';
import { assistantLog } from './assistantLog';
import { homeLog } from './home';
import { clock, describeLook } from './explain';
import type {
  ActivityEntry, AssistantEntry, AssistantSummary, Habit, HabitKind, HomeLogEntry, LightValues, MediaEntry, Patterns,
  PresenceLogEntry,
} from '../types';

// The nightly summary of your habits, from the logs: things that recur at about the same
// time on most weekdays (or weekends), reported at their real times with how much they
// vary — "6:40 day starts ±10 min · 9 of 10 weekdays". Plain counting, no AI.
//
// A "day" runs from 4 AM to 4 AM, so a late night belongs to the day it started on.
// Something counts as a habit when it happens within CLUSTER_MIN of the same time on
// MIN_DAYS or more days, and on at least MIN_SHARE of the days it could have.

const DAY_MS        = 24 * 60 * 60 * 1000;
const DAY_START_MIN = 4 * 60;
const LOOKBACK_DAYS = 28;
const MIN_HISTORY   = 7;
const MIN_DAYS      = 3;
const MIN_SHARE     = 0.5;
const CLUSTER_MIN   = 30;
const LOOK_SLACK    = 10;
const AWAY_MIN      = 120;           // no sign of anyone for this long = out…
const LIGHTS_OFF_MIN = 30;           // …and every light off within this of the last motion
const PHONE_AWAY_MIN = 30;           // with a tracked phone: gone this long = out
const SESSION_MAX   = 6 * 60;        // a play with no pause within this has no known length
const REFRESH_AT    = 3 * 60 + 30;   // 3:30 AM
const STALE_MS      = 20 * 60 * 60 * 1000;

export interface PatternInput {
  presence:  PresenceLogEntry[];
  lighting:  ActivityEntry[];
  media:     MediaEntry[];
  assistant: AssistantEntry[];
  /** Your phone arriving and leaving — when present, it decides "leaves" / "home again" */
  home?:     HomeLogEntry[];
}

interface Day {
  key:     string;
  /** ms at 4 AM */
  start:   number;
  weekday: number;
}

/** Something that happened on a day, at `m` minutes after that day's 4 AM. */
interface Ev {
  day:       string;
  m:         number;
  duration?: number;
  look?:     LightValues;
  from?:     string;
  fromUri?:  string;
  app?:      string;
}

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
};

const round5 = (n: number): number => Math.round(n / 5) * 5;

/** The most common value, or undefined. */
function mode<T>(xs: Array<T | undefined>): T | undefined {
  const counts = new Map<T, number>();
  xs.forEach((x) => { if (x !== undefined) counts.set(x, (counts.get(x) ?? 0) + 1); });
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0];
}

/** The 4 AM that starts the day `at` belongs to. */
function dayStartOf(at: number): number {
  const d = new Date(at);
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 4);
  if (start.getTime() > at) start.setDate(start.getDate() - 1);
  return start.getTime();
}

const dayKeyOf = (start: number): string => {
  const d = new Date(start);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const isManual = (source: string): boolean => source === 'dashboard' || source === 'voice';

const clockOf = (m: number): string => {
  const minutes = (m + DAY_START_MIN) % 1440;
  return clock(new Date(2000, 0, 1, Math.floor(minutes / 60), minutes % 60));
};

const lengthText = (min: number): string =>
  min < 60 ? `${round5(min)} min` : `${Math.round(min / 30) / 2} h`;

// ── Clustering ──────────────────────────────────────────────────────────────

interface Cluster { evs: Ev[]; center: number; spread: number }

/**
 * Groups events into habits: the anchor time with the most days having an event within
 * CLUSTER_MIN (the closest one per day), repeatedly, until nothing left qualifies.
 */
function cluster(evs: Ev[], days: Day[], similar: (a: Ev, b: Ev) => boolean = () => true): Cluster[] {
  const result: Cluster[] = [];
  let remaining = [...evs];
  const dayKeys = new Set(days.map((d) => d.key));

  while (remaining.length) {
    let best: Ev[] = [];
    let bestAnchor: Ev | null = null;
    for (const anchor of remaining) {
      const hits = new Map<string, Ev>();
      for (const e of remaining) {
        if (!dayKeys.has(e.day) || Math.abs(e.m - anchor.m) > CLUSTER_MIN || !similar(anchor, e)) continue;
        const prev = hits.get(e.day);
        if (!prev || Math.abs(e.m - anchor.m) < Math.abs(prev.m - anchor.m)) hits.set(e.day, e);
      }
      if (hits.size > best.length) { best = [...hits.values()]; bestAnchor = anchor; }
    }
    if (!bestAnchor || best.length < MIN_DAYS || best.length / days.length < MIN_SHARE) break;

    const center = bestAnchor.m + median(best.map((e) => e.m - bestAnchor!.m));
    const spread = Math.max(5, round5(median(best.map((e) => Math.abs(e.m - center)))));
    result.push({ evs: best, center, spread });
    remaining = remaining.filter((e) => !best.includes(e));
  }
  return result;
}

// ── Per-day events from the logs ────────────────────────────────────────────

interface Extracted { kind: HabitKind; series: string; ev: Ev; zone?: string; action?: 'on' | 'off' | 'set' }

function extract(input: PatternInput, dayOf: (at: number) => Day | undefined): Extracted[] {
  const out: Extracted[] = [];
  const at = (t: number): { day: Day; m: number } | null => {
    const day = dayOf(t);
    return day ? { day, m: Math.floor((t - day.start) / 60000) } : null;
  };

  // Signs someone is up and about, and things done on the way to bed
  const activity: number[] = [
    ...input.presence.filter((e) => e.occupied).map((e) => e.at),
    ...input.lighting.filter((e) => isManual(e.source)).map((e) => e.at),
    ...input.media.filter((e) => e.action === 'play' || e.action === 'on' || e.action === 'app' || isManual(e.source)).map((e) => e.at),
  ];
  const winding = [
    ...activity,
    ...input.media.filter((e) => e.action === 'pause' || e.action === 'off').map((e) => e.at),
  ];
  const first = new Map<string, number>(), last = new Map<string, number>();
  activity.forEach((t) => { const d = dayOf(t); if (d && (!first.has(d.key) || t < first.get(d.key)!)) first.set(d.key, t); });
  winding.forEach((t) => { const d = dayOf(t); if (d && (!last.has(d.key) || t > last.get(d.key)!)) last.set(d.key, t); });
  for (const [key, t] of first) out.push({ kind: 'day-start', series: 'day-start', ev: { day: key, m: at(t)!.m } });
  for (const [key, t] of last)  out.push({ kind: 'day-end',   series: 'day-end',   ev: { day: key, m: at(t)!.m } });

  // Out, by your phone: from when it was last seen to when it came back. It knows "out"
  // from "in a room without a sensor", so it's used whenever there's phone data.
  const outing = (left: number, back: number): void => {
    const l = at(left), r = at(back);
    if (!l || !r || l.day.key !== r.day.key) return; // out overnight is travel, not a routine
    out.push({ kind: 'leave',  series: 'leave',  ev: { day: l.day.key, m: l.m, duration: Math.round((back - left) / 60000) } });
    out.push({ kind: 'return', series: 'return', ev: { day: r.day.key, m: r.m } });
  };
  const phone = [...(input.home ?? [])].sort((a, b) => a.at - b.at);
  phone.forEach((e, i) => {
    if (e.home) return;
    const left = e.lastSeen ?? e.at;
    const back = phone.slice(i + 1).find((n) => n.mac === e.mac && n.home);
    if (back && back.at - left >= PHONE_AWAY_MIN * 60000) outing(left, back.at);
  });

  // Without a phone: every sensor empty and nothing done by hand for AWAY_MIN or longer —
  // and the lights all off soon after. Sensors don't cover every room, so an evening on the sofa
  // in a room without one would otherwise look like being out; leaving means lights off.
  const lightChanges = [...input.lighting].filter((e) => ['on', 'off', 'set'].includes(e.action)).sort((a, b) => a.at - b.at);
  const lightsOnAt = (t: number): boolean => {
    const on = new Map<string, boolean>();
    for (const e of lightChanges) {
      if (e.at > t) break;
      on.set(e.zone, e.action !== 'off');
    }
    return [...on.values()].some(Boolean);
  };
  const homeSignals = [
    ...input.presence.filter((e) => e.occupied).map((e) => e.at),
    ...input.lighting.filter((e) => isManual(e.source)).map((e) => e.at),
    ...input.media.filter((e) => isManual(e.source)).map((e) => e.at),
  ].sort((a, b) => a - b);
  const occupied = new Set<string>();
  for (const e of phone.length ? [] : [...input.presence].sort((a, b) => a.at - b.at)) {
    if (e.occupied) { occupied.add(e.sensor); continue; }
    occupied.delete(e.sensor);
    if (occupied.size) continue;
    const back = homeSignals.find((t) => t > e.at);
    if (back === undefined || back - e.at < AWAY_MIN * 60000) continue;
    if (lightsOnAt(e.at + LIGHTS_OFF_MIN * 60000)) continue;
    outing(e.at, back);
  }

  // Lights you changed by hand, per room and what you did
  for (const e of input.lighting) {
    if (!isManual(e.source) || e.bulbs || !['on', 'off', 'set'].includes(e.action)) continue;
    const p = at(e.at);
    if (!p) continue;
    const action = e.action as 'on' | 'off' | 'set';
    out.push({ kind: 'lights', series: `lights|${e.zone}|${action}`, zone: e.zone, action, ev: { day: p.day.key, m: p.m, ...(e.look && { look: e.look }) } });
  }

  // Music sessions: a play until the next pause; TV: on until off, with its first app
  const media = [...input.media].sort((a, b) => a.at - b.at);
  media.forEach((e, i) => {
    const p = at(e.at);
    if (!p) return;
    if (e.device === 'spotify' && e.action === 'play') {
      const end = media.slice(i + 1).find((n) => n.device === 'spotify' && n.action === 'pause');
      const duration = end && end.at - e.at < SESSION_MAX * 60000 ? Math.round((end.at - e.at) / 60000) : undefined;
      out.push({ kind: 'music', series: 'music', ev: { day: p.day.key, m: p.m, duration, from: e.from, fromUri: e.fromUri } });
    } else if (e.device === 'tv' && e.action === 'on') {
      const later = media.slice(i + 1).filter((n) => n.device === 'tv');
      const end = later.find((n) => n.action === 'off');
      const app = e.app ?? later.find((n) => n.action === 'app' && n.at - e.at < 15 * 60000)?.app;
      const duration = end && end.at - e.at < SESSION_MAX * 60000 ? Math.round((end.at - e.at) / 60000) : undefined;
      out.push({ kind: 'tv', series: 'tv', ev: { day: p.day.key, m: p.m, duration, app } });
    }
  });

  return out;
}

// ── Assistant ───────────────────────────────────────────────────────────────

function summarizeAssistant(entries: AssistantEntry[]): AssistantSummary {
  const count = <K>(keys: K[]) => {
    const map = new Map<string, { key: K; count: number }>();
    keys.forEach((k) => { const id = JSON.stringify(k); map.set(id, { key: k, count: (map.get(id)?.count ?? 0) + 1 }); });
    return [...map.values()].sort((a, b) => b.count - a.count);
  };
  const normalize = (s: string) => s.toLowerCase().replace(/[^\w\s']/g, '').replace(/\s+/g, ' ').trim();

  return {
    requests: entries.length,
    topTools: count(entries.flatMap((e) => e.tools.map((t) => t.name))).slice(0, 5)
      .map(({ key, count: n }) => ({ name: key, count: n })),
    repeated: count(entries.map((e) => normalize(e.request))).filter((r) => r.count >= 3).slice(0, 5)
      .map(({ key, count: n }) => ({ request: key, count: n })),
    failures: count(entries.flatMap((e) => e.tools.filter((t) => !t.ok).map((t) => ({ name: t.name, error: t.error ?? 'failed' }))))
      .filter((f) => f.count >= 2).slice(0, 5)
      .map(({ key, count: n }) => ({ ...key, count: n })),
  };
}

// ── Putting it together ─────────────────────────────────────────────────────

/** Habits from the logs. Pure — `now` is the clock, `zoneName` names rooms. */
export function computePatterns(input: PatternInput, now: number, zoneName: (zone: string) => string = (z) => z): Patterns {
  const firstAt = Math.min(
    ...[input.presence, input.lighting, input.media, input.assistant].map((l) => l[0]?.at ?? Infinity),
  );
  const today = dayStartOf(now);
  const historyDays = Number.isFinite(firstAt) ? Math.floor((today - dayStartOf(firstAt)) / DAY_MS) : 0;
  const since = now - LOOKBACK_DAYS * DAY_MS;
  const assistant = summarizeAssistant(input.assistant.filter((e) => e.at >= since));
  if (historyDays < MIN_HISTORY) return { generatedAt: now, historyDays, weekdays: [], weekends: [], assistant };

  // Complete days in the lookback, since the logs began
  const days: Day[] = [];
  for (let i = 1; i <= Math.min(LOOKBACK_DAYS, historyDays); i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const start = d.getTime();
    days.push({ key: dayKeyOf(start), start, weekday: new Date(start).getDay() });
  }
  const byKey = new Map(days.map((d) => [d.key, d]));
  const dayOf = (at: number) => byKey.get(dayKeyOf(dayStartOf(at)));

  const extracted = extract(input, dayOf);
  const habitsFor = (weekdays: number[], label: string): Habit[] => {
    const setDays = days.filter((d) => weekdays.includes(d.weekday));
    const inSet = new Set(setDays.map((d) => d.key));
    const series = new Map<string, Extracted[]>();
    extracted.filter((x) => inSet.has(x.ev.day)).forEach((x) => series.set(x.series, [...(series.get(x.series) ?? []), x]));

    const habits: Habit[] = [];
    for (const items of series.values()) {
      const { kind, zone, action } = items[0]!;
      const similar = action === 'set'
        ? (a: Ev, b: Ev) => !!a.look && !!b.look
          && Math.abs(a.look.brightness - b.look.brightness) <= LOOK_SLACK
          && Math.abs(a.look.colorTemp - b.look.colorTemp) <= LOOK_SLACK
        : undefined;

      for (const c of cluster(items.map((x) => x.ev), setDays, similar)) {
        const durations = c.evs.map((e) => e.duration).filter((d): d is number => d !== undefined);
        const looks = c.evs.map((e) => e.look).filter((l): l is LightValues => !!l);
        const habit: Habit = {
          kind,
          minutes:  (Math.round(c.center) + DAY_START_MIN) % 1440,
          spread:   c.spread,
          matched:  c.evs.length,
          eligible: setDays.length,
          ...(durations.length >= MIN_DAYS && { duration: round5(median(durations)) }),
          ...(zone && { zone }),
          ...(action && { action }),
          ...(looks.length && { look: { brightness: round5(median(looks.map((l) => l.brightness))), colorTemp: round5(median(looks.map((l) => l.colorTemp))) } }),
          ...(kind === 'music' && { from: mode(c.evs.map((e) => e.from)), fromUri: mode(c.evs.map((e) => e.fromUri)) }),
          ...(kind === 'tv' && { app: mode(c.evs.map((e) => e.app)) }),
          text: '',
        };
        habit.text = `${clockOf(Math.round(c.center))} ${describeHabit(habit, zoneName)} ±${c.spread} min · ${c.evs.length} of ${setDays.length} ${label}`;
        habits.push(habit);
      }
    }
    // In the order the day happens; at the same minute the day starts first and ends last
    const order = (h: Habit) => ((h.minutes - DAY_START_MIN + 1440) % 1440) + (h.kind === 'day-start' ? -0.5 : h.kind === 'day-end' ? 0.5 : 0);
    return habits.sort((a, b) => order(a) - order(b));
  };

  return {
    generatedAt: now,
    historyDays,
    weekdays: habitsFor([1, 2, 3, 4, 5], 'weekdays'),
    weekends: habitsFor([0, 6], 'weekend days'),
    assistant,
  };
}

function describeHabit(h: Habit, zoneName: (zone: string) => string): string {
  const length = h.duration ? `, about ${lengthText(h.duration)}` : '';
  switch (h.kind) {
    case 'day-start': return 'day starts';
    case 'day-end':   return 'day ends';
    case 'leave':     return `leaves${h.duration ? ` (out about ${lengthText(h.duration)})` : ''}`;
    case 'return':    return 'home again';
    case 'lights': {
      const room = zoneName(h.zone!);
      if (h.action === 'set') return `${room} set to ${h.look ? describeLook(h.look) : 'a new look'}`;
      return `${room} lights ${h.action}${h.action === 'on' && h.look ? ` (${describeLook(h.look)})` : ''}`;
    }
    case 'music': return `Spotify${h.from ? `: ${h.from}` : ''}${length}`;
    case 'tv':    return `TV on${h.app ? `: ${h.app}` : ''}${length}`;
  }
}

// ── Wiring ──────────────────────────────────────────────────────────────────

let timer: NodeJS.Timeout | undefined;

/** Recompute from the logs and save. */
export function refresh(now = Date.now()): Patterns {
  const since = now - (LOOKBACK_DAYS + 2) * DAY_MS;
  const patterns = computePatterns({
    presence:  occupancyHistory(since),
    lighting:  activity.list(since),
    media:     mediaLog.list(since),
    assistant: assistantLog.list(since),
    home:      homeLog.list(since),
  }, now, controller.zoneName);
  config.set('patterns', patterns);
  return patterns;
}

/** The last summary, recomputing first if it's missing or more than a day old. */
export function current(now = Date.now()): Patterns {
  const saved = config.get('patterns');
  return saved && now - saved.generatedAt < STALE_MS ? saved : refresh(now);
}

/** Next 3:30 AM after `now`. */
function nextRefresh(now: number): number {
  const d = new Date(now);
  const next = new Date(d.getFullYear(), d.getMonth(), d.getDate(), Math.floor(REFRESH_AT / 60), REFRESH_AT % 60);
  if (next.getTime() <= now) next.setDate(next.getDate() + 1);
  return next.getTime();
}

export function init(): void {
  current();
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(() => { refresh(); schedule(); }, nextRefresh(Date.now()) - Date.now());
    timer.unref?.();
  };
  schedule();
}
