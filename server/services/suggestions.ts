import * as config from '../config';
import * as activity from './activity';
import * as controller from './controller';
import * as rulesSvc from './rules';
import { describeLook, clock } from './explain';
import { genId } from '../util';
import type {
  ActivityEntry, AppServer, DismissedSuggestion, LightValues, Rule, RuleSuggestion, SuggestionKind, SuggestionsState,
} from '../types';

// Rule suggestions from the activity log: "you do this by hand at the same time most
// days — make it a rule?" Deliberately rare. A pattern has to clear every bar below, at
// most one new suggestion appears a week, and only one is shown at a time.
//
//  - history:     the log reaches back at least MIN_HISTORY_DAYS
//  - repeated:    the same manual change to the same whole room (off / on / about the
//                 same look) within TIME_SLACK_MIN of the same time, on MIN_DAYS of the
//                 last LOOKBACK_DAYS days
//  - consistent:  on at least MIN_SHARE of the days it could have happened (all days,
//                 else weekdays, else weekends)
//  - new:         no rule already acts on that room around then, and it wasn't dismissed

const DAY_MS           = 24 * 60 * 60 * 1000;
const MIN_HISTORY_DAYS = 14;
const LOOKBACK_DAYS    = 14;
const MIN_DAYS         = 5;
const MIN_SHARE        = 0.7;
const TIME_SLACK_MIN   = 30;
const LOOK_SLACK       = 10;
const DISMISS_SLACK_MIN = 45;
const NEW_EVERY_MS     = 7 * DAY_MS;
const SNOOZE_MS        = 30 * DAY_MS;
const CHECK_EVERY_MS   = 6 * 60 * 60 * 1000;

const DAY_SETS: Array<{ days: number[]; label: string }> = [
  { days: [0, 1, 2, 3, 4, 5, 6], label: 'days' },
  { days: [1, 2, 3, 4, 5],       label: 'weekdays' },
  { days: [0, 6],                label: 'weekend days' },
];

export interface Pattern {
  zone:     string;
  kind:     SuggestionKind;
  days:     number[];
  daysLabel: string;
  /** Minutes after midnight, rounded to 5 */
  minutes:  number;
  look?:    LightValues;
  matched:  number;
  eligible: number;
}

export interface DetectOptions {
  /** True when a rule already handles this zone around `minutes` on any of `days` */
  covered:   (zone: string, minutes: number, days: number[]) => boolean;
  dismissed: DismissedSuggestion[];
}

const minuteOf = (at: number): number => { const d = new Date(at); return d.getHours() * 60 + d.getMinutes(); };

/** Distance between two times of day, across midnight. */
const gap = (a: number, b: number): number => { const d = Math.abs(a - b) % 1440; return Math.min(d, 1440 - d); };

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
};

const round5 = (n: number): number => Math.round(n / 5) * 5;

const isDismissed = (p: Pattern, dismissed: DismissedSuggestion[], now: number): boolean =>
  dismissed.some((d) =>
    d.zone === p.zone && d.kind === p.kind
    && (d.until === null || d.until > now)
    && d.days.some((day) => p.days.includes(day))
    && gap(d.minutes, p.minutes) <= DISMISS_SLACK_MIN);

/** The strongest pattern in the log worth suggesting, or null. Pure — `now` is the clock. */
export function detect(entries: ActivityEntry[], now: number, { covered, dismissed }: DetectOptions): Pattern | null {
  const today = new Date(now);
  const dayStart = (offset: number) => new Date(today.getFullYear(), today.getMonth(), today.getDate() - offset).getTime();

  if (entries.length === 0 || entries[0]!.at > dayStart(MIN_HISTORY_DAYS)) return null;

  // The last LOOKBACK_DAYS complete days, as [start, weekday]
  const days = Array.from({ length: LOOKBACK_DAYS }, (_, i) => {
    const start = dayStart(i + 1);
    return { start, end: dayStart(i), weekday: new Date(start).getDay() };
  });
  const from = days.at(-1)!.start, to = days[0]!.end;

  const manual = entries.filter((e) =>
    (e.source === 'dashboard' || e.source === 'voice')
    && (e.action === 'on' || e.action === 'off' || e.action === 'set')
    && !e.bulbs // a pattern is about a whole room
    && e.at >= from && e.at < to);

  const groups = new Map<string, ActivityEntry[]>();
  for (const e of manual) {
    const key = `${e.zone}|${e.action}`;
    groups.set(key, [...(groups.get(key) ?? []), e]);
  }

  const found: Pattern[] = [];
  for (const group of groups.values()) {
    const { zone } = group[0]!;
    const kind = group[0]!.action as SuggestionKind;
    let best: Pattern | null = null;

    for (const anchor of group) {
      const at = minuteOf(anchor.at);
      const similar = (e: ActivityEntry) =>
        gap(minuteOf(e.at), at) <= TIME_SLACK_MIN
        && (kind !== 'set' || (!!e.look && !!anchor.look
          && Math.abs(e.look.brightness - anchor.look.brightness) <= LOOK_SLACK
          && Math.abs(e.look.colorTemp  - anchor.look.colorTemp)  <= LOOK_SLACK));

      // Per day, the closest similar entry
      const hits = new Map<number, ActivityEntry>();
      for (const day of days) {
        const match = group
          .filter((e) => e.at >= day.start && e.at < day.end && similar(e))
          .sort((a, b) => gap(minuteOf(a.at), at) - gap(minuteOf(b.at), at))[0];
        if (match) hits.set(day.start, match);
      }

      for (const set of DAY_SETS) {
        const eligible = days.filter((d) => set.days.includes(d.weekday));
        const matched  = eligible.map((d) => hits.get(d.start)).filter((e): e is ActivityEntry => !!e);
        if (matched.length < MIN_DAYS || matched.length / eligible.length < MIN_SHARE) continue;

        const offsets = matched.map((e) => { const m = minuteOf(e.at); const d = m - at; return Math.abs(d) > 720 ? d - Math.sign(d) * 1440 : d; });
        const looks   = matched.map((e) => e.look).filter((l): l is LightValues => !!l);
        const pattern: Pattern = {
          zone, kind,
          days: set.days, daysLabel: set.label,
          minutes: (round5(at + median(offsets)) + 1440) % 1440,
          ...(kind === 'set' && looks.length && {
            look: { brightness: Math.max(5, round5(median(looks.map((l) => l.brightness)))), colorTemp: round5(median(looks.map((l) => l.colorTemp))) },
          }),
          matched: matched.length, eligible: eligible.length,
        };
        if (!best || pattern.matched > best.matched) best = pattern;
        break; // the broadest day set that qualifies
      }
    }
    if (best) found.push(best);
  }

  return found
    .filter((p) => !isDismissed(p, dismissed, now) && !covered(p.zone, p.minutes, p.days))
    .sort((a, b) => b.matched - a.matched || b.matched / b.eligible - a.matched / a.eligible)[0] ?? null;
}

// ── Wiring ──────────────────────────────────────────────────────────────────

let io: AppServer | null = null;
let interval: NodeJS.Timeout | undefined;

function getState(): SuggestionsState {
  return config.get('suggestions') ?? { current: null, lastNewAt: 0, dismissed: [] };
}

function save(state: SuggestionsState, changed: boolean): void {
  const now = Date.now();
  state.dismissed = state.dismissed.filter((d) => d.until === null || d.until > now);
  config.set('suggestions', state);
  if (changed) io?.emit('lighting:suggestion', state.current);
}

const toMinutes = (time: string): number => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));

const hhmm = (minutes: number): string =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

/** A rule on this zone that starts near `minutes`, or whose window spans it, on one of `days`. */
function covered(zone: string, minutes: number, days: number[]): boolean {
  const today = new Date();
  return rulesSvc.getRules().some((rule: Rule) => {
    if (!rule.enabled || !rule.days.some((d) => days.includes(d))) return false;
    if (!controller.zonesForTarget(rule.action.group).includes(zone)) return false;
    const start = rulesSvc.atTime(rule.time, today);
    if (!start) return false;
    const s = start.getHours() * 60 + start.getMinutes();
    if (gap(s, minutes) <= TIME_SLACK_MIN) return true;
    const end = rule.end && rulesSvc.endFor(rule, start);
    if (!end) return false;
    const e = end.getHours() * 60 + end.getMinutes();
    return s <= e ? minutes >= s && minutes <= e : minutes >= s || minutes <= e;
  });
}

function build(p: Pattern): RuleSuggestion {
  const name = controller.zoneName(p.zone);
  const time = hhmm(p.minutes);
  const when = clock(new Date(2000, 0, 1, Math.floor(p.minutes / 60), p.minutes % 60));
  const did =
      p.kind === 'off' ? `turned off ${name}`
    : p.kind === 'on'  ? `turned on ${name}`
    : `set ${name} to about ${describeLook(p.look!)}`;
  const action: Rule['action'] =
      p.kind === 'off' ? { type: 'power', group: p.zone, on: false }
    : p.kind === 'on'  ? { type: 'power', group: p.zone, on: true, config: 'none' }
    : { type: 'reconfigure', group: p.zone, config: 'scene', ...p.look! };
  return {
    id: genId(),
    zone: p.zone,
    kind: p.kind,
    time,
    days: p.days,
    ...(p.look && { look: p.look }),
    text: `You've ${did} around ${when} on ${p.matched} of the last ${p.eligible} ${p.daysLabel}.`,
    rule: {
      name: p.kind === 'set' ? `${name} ${p.look!.brightness}%` : `${name} ${p.kind}`,
      time,
      days: p.days,
      action,
    },
    createdAt: Date.now(),
  };
}

/** The suggestion on show, if any — dropped once a rule covers it. */
export function current(): RuleSuggestion | null {
  const state = getState();
  const s = state.current;
  if (s && (covered(s.zone, toMinutes(s.time), s.days) || controller.zoneBulbs(s.zone).length === 0)) {
    state.current = null;
    save(state, true);
  }
  return state.current;
}

/** Looks for a new suggestion if one is due. */
export function check(now = Date.now()): RuleSuggestion | null {
  const shown = current();
  if (shown) return shown;
  const state = getState();
  if (now - state.lastNewAt < NEW_EVERY_MS) return null;

  const pattern = detect(activity.list(now - activity.RETENTION_DAYS * DAY_MS), now, {
    covered: (zone, minutes, days) => controller.zoneBulbs(zone).length === 0 || covered(zone, minutes, days),
    dismissed: state.dismissed,
  });
  if (!pattern) return null;

  state.current   = build(pattern);
  state.lastNewAt = now;
  save(state, true);
  return state.current;
}

/** "Not now" hides the pattern for 30 days; "never" for good. */
export function dismiss(id: string, forever: boolean): boolean {
  const state = getState();
  const s = state.current;
  if (!s || s.id !== id) return false;
  state.dismissed.push({
    zone: s.zone, kind: s.kind, days: s.days,
    minutes: toMinutes(s.time),
    until: forever ? null : Date.now() + SNOOZE_MS,
  });
  state.current = null;
  save(state, true);
  return true;
}

/** The rule was made — clear the card. The new rule keeps the pattern from coming back. */
export function accept(id: string): boolean {
  const state = getState();
  if (state.current?.id !== id) return false;
  state.current = null;
  save(state, true);
  return true;
}

export function init(server: AppServer): void {
  io = server;
  clearInterval(interval);
  check();
  interval = setInterval(() => check(), CHECK_EVERY_MS);
  interval.unref?.();
}
