import suncalc from 'suncalc';
import * as config from '../config';
import { ServiceError, errorMessage, genId, toHHMM } from '../util';
import { LAT, LON } from '../location';
import { createLog } from './logs';
import type { Rule, RuleChange, RuleChangeSource } from '../types';

// A rule starts at `time` on its `days`. With an `end` it's a window that stays in effect
// until then (overnight if the end is earlier than the start); without one it's an instant.
//
// Firing is tracked per start (ruleLastFired), not per clock minute, so:
//  - a window whose start was missed (server down) still fires as long as it hasn't ended,
//    and one that already fired is still known to be in effect after a restart;
//  - an instant that was missed fires late if it's within GRACE_MS, else it's skipped;
//  - nothing fires twice for the same start (same-minute restarts, the repeated hour when
//    clocks go back).

type RuleExecutor = (rule: Rule) => void;

export type NewRule = Omit<Rule, 'id' | 'enabled'> & Partial<Pick<Rule, 'enabled'>>;

/** A windowed rule whose start has fired and whose end hasn't come yet. */
export interface ActiveWindow {
  rule:  Rule;
  start: Date;
  end:   Date;
}

export interface RulesDebugInfo {
  serverIso:  string;
  serverTime: string;
  serverDay:  number;
  timezone:   string;
  sunrise:    string;
  sunset:     string;
  rules: Array<{
    name:       string;
    time:       string;
    end:        string | null;
    enabled:    boolean;
    lastStart:  string | null;
    lastFired:  string | null;
    active:     boolean;
  }>;
}

const GRACE_MS = 30 * 60 * 1000;
/** The most rules the assistant may build up to — you can always add more yourself */
export const MAX_RULES = 15;
const TICK_MS  = 10_000;

let intervalId:      NodeJS.Timeout | undefined;
let executor:        RuleExecutor | null = null;
let onWindowsChange: (() => void) | null = null;
let lastWindowsKey = '';

export function getRules(): Rule[] { return config.get('rules') ?? []; }

function saveRules(r: Rule[]): void { config.set('rules', r); }

function getLastFired(): Record<string, string> { return config.get('ruleLastFired') ?? {}; }

function saveLastFired(f: Record<string, string>): void { config.set('ruleLastFired', f); }

// ruleLastFired holds, per rule, the start it last handled: "YYYY-MM-DD" when it fired,
// "skip:YYYY-MM-DD" when it was deliberately passed over (rule created or edited after
// that start). Either way that start won't fire; only a fired window is in effect.
export const skipKey = (key: string): string => `skip:${key}`;

/** Local calendar date, YYYY-MM-DD — one key per start, so a rule fires once per day. */
export function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function isTimeSpec(t: unknown): t is string {
  return typeof t === 'string' && (t === 'sunrise' || t === 'sunset' || /^([01]\d|2[0-3]):[0-5]\d$/.test(t));
}

/** `spec` ("HH:MM" / "sunrise" / "sunset") on the calendar day of `day`. */
export function atTime(spec: string, day: Date): Date | null {
  if (spec === 'sunrise' || spec === 'sunset') {
    const noon = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 12);
    const t = suncalc.getTimes(noon, LAT, LON)[spec];
    return Number.isNaN(t.getTime()) ? null : t;
  }
  const [h, m] = spec.split(':').map(Number);
  if (h === undefined || m === undefined || Number.isNaN(h) || Number.isNaN(m)) return null;
  const d = new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m);
  // A time inside the spring-forward gap (02:30 when clocks skip to 03:00) is rolled
  // forward by the gap; pin it to the top of the hour it lands in, i.e. 03:00.
  if (d.getHours() !== h) d.setMinutes(0);
  return d;
}

function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, 12);
}

/** The most recent start of `rule` at or before `now` (today's or yesterday's). */
export function latestStart(rule: Rule, now = new Date()): Date | null {
  for (const offset of [0, -1]) {
    const day = addDays(now, offset);
    if (!rule.days.includes(day.getDay())) continue;
    const start = atTime(rule.time, day);
    if (start && start <= now) return start;
  }
  return null;
}

/** When the window that began at `start` ends, or null for an instant rule. */
export function endFor(rule: Rule, start: Date): Date | null {
  if (!rule.end) return null;
  const sameDay = atTime(rule.end, start);
  if (sameDay && sameDay > start) return sameDay;
  return atTime(rule.end, addDays(start, 1));
}

export function activeWindows(now = new Date()): ActiveWindow[] {
  const fired = getLastFired();
  const result: ActiveWindow[] = [];
  for (const rule of getRules()) {
    if (!rule.enabled || !rule.end) continue;
    const start = latestStart(rule, now);
    if (!start || fired[rule.id] !== dateKey(start)) continue;
    const end = endFor(rule, start);
    if (end && now < end) result.push({ rule, start, end });
  }
  return result;
}

function validate(rule: Partial<Rule>, partial: boolean): void {
  if (!partial || rule.name !== undefined) {
    if (typeof rule.name !== 'string' || !rule.name.trim()) throw new ServiceError('name required', 'INVALID');
  }
  if (!partial || rule.time !== undefined) {
    if (!isTimeSpec(rule.time)) throw new ServiceError('time must be HH:MM, "sunrise" or "sunset"', 'INVALID');
  }
  if (rule.end !== undefined && rule.end !== null && !isTimeSpec(rule.end)) {
    throw new ServiceError('end must be HH:MM, "sunrise" or "sunset"', 'INVALID');
  }
  if (!partial || rule.days !== undefined) {
    if (!Array.isArray(rule.days) || rule.days.length === 0) throw new ServiceError('days required', 'INVALID');
  }
  if (!partial || rule.action !== undefined) {
    if (!rule.action || !['power', 'reconfigure'].includes(rule.action.type) || !rule.action.group) {
      throw new ServiceError('action needs a type and a group', 'INVALID');
    }
  }
}

// A new or edited rule takes effect from its next start, not retroactively — creating
// "Bedtime 23:00–07:00" at 1am shouldn't switch everything off on the spot.
function seedLastFired(rule: Rule): void {
  const start = latestStart(rule);
  const fired = getLastFired();
  if (start) fired[rule.id] = skipKey(dateKey(start));
  else delete fired[rule.id];
  saveLastFired(fired);
}

// ── Change history ──────────────────────────────────────────────────────────
// Every create / edit / delete is logged with the rule before and after, so any change —
// yours or the assistant's — can be undone, and deleted rules stay restorable for 30 days.

export const changeLog = createLog<RuleChange>({ category: 'rules', retentionDays: 30 });

interface ChangeMeta { by?: RuleChangeSource; reason?: string; undoes?: string }

function logChange(change: Omit<RuleChange, 'at' | 'id' | 'by'>, meta: ChangeMeta): void {
  changeLog.record({ id: genId(), by: meta.by ?? 'dashboard', ...change,
    ...(meta.reason && { reason: meta.reason }), ...(meta.undoes && { undoes: meta.undoes }) });
}

function insert(rule: Rule, meta: ChangeMeta): Rule {
  const rules = getRules();
  // The assistant tidies before it adds; you're never blocked
  if (meta.by && meta.by !== 'dashboard' && rules.length >= MAX_RULES) {
    throw new ServiceError(`There are already ${rules.length} rules (the limit is ${MAX_RULES}) — merge, edit or delete one first`, 'FULL');
  }
  rules.push(rule);
  saveRules(rules);
  seedLastFired(rule);
  notifyIfWindowsChanged();
  logChange({ ruleId: rule.id, change: 'create', after: rule }, meta);
  return rule;
}

export function create(rule: NewRule, meta: ChangeMeta = {}): Rule {
  validate(rule, false);
  const newRule: Rule = { ...rule, id: genId(), enabled: rule.enabled ?? true, createdBy: meta.by ?? 'dashboard' };
  if (!newRule.end) delete newRule.end;
  return insert(newRule, meta);
}

export function update(id: string, patch: Partial<Rule>, meta: ChangeMeta = {}): Rule {
  validate(patch, true);
  const rules = getRules();
  const idx   = rules.findIndex((r) => r.id === id);
  const existing = rules[idx];
  if (!existing) throw new ServiceError('Rule not found', 'NOT_FOUND');
  const updated: Rule = { ...existing, ...patch, id, ...(existing.createdBy && { createdBy: existing.createdBy }) };
  // The client sends null to clear these (undefined doesn't survive JSON)
  if (!updated.end) delete updated.end;
  if (!updated.presence) delete updated.presence;
  rules[idx] = updated;
  saveRules(rules);
  const timingChanged = ['time', 'end', 'days', 'enabled'].some((k) => k in patch);
  if (timingChanged) seedLastFired(updated);
  notifyIfWindowsChanged();
  logChange({ ruleId: id, change: 'update', before: existing, after: updated }, meta);
  return updated;
}

export function remove(id: string, meta: ChangeMeta = {}): void {
  const existing = getRules().find((r) => r.id === id);
  saveRules(getRules().filter((r) => r.id !== id));
  const fired = getLastFired();
  delete fired[id];
  saveLastFired(fired);
  notifyIfWindowsChanged();
  if (existing) logChange({ ruleId: id, change: 'delete', before: existing }, meta);
}

/** Recent changes, newest first. */
export function changes(since = 0): RuleChange[] {
  return changeLog.list(since).reverse();
}

/** Rules deleted in the last 30 days that haven't been brought back, newest first. */
export function removedRules(): Array<{ change: RuleChange; rule: Rule }> {
  const live = new Set(getRules().map((r) => r.id));
  const latest = new Map<string, RuleChange>(); // ruleId → its most recent delete
  for (const c of changes()) {
    if (c.change === 'delete' && c.before && !live.has(c.ruleId) && !latest.has(c.ruleId)) latest.set(c.ruleId, c);
  }
  return [...latest.values()].map((c) => ({ change: c, rule: c.before! }));
}

/** Reverses one change: a delete is restored, an edit put back, a create removed. */
export function undo(changeId: string, meta: ChangeMeta = {}): Rule | null {
  const c = changeLog.list().find((x) => x.id === changeId);
  if (!c) throw new ServiceError('No such change (changes are kept 30 days)', 'NOT_FOUND');
  const live = getRules().find((r) => r.id === c.ruleId);
  const m = { ...meta, undoes: c.id };
  switch (c.change) {
    case 'delete':
      if (live) throw new ServiceError('That rule is already back', 'EXISTS');
      return insert(c.before!, m);
    case 'update': {
      if (!live) throw new ServiceError('That rule has since been deleted', 'NOT_FOUND');
      const { id: _id, ...before } = c.before!;
      return update(c.ruleId, { ...before, end: before.end ?? null, presence: before.presence ?? null } as Partial<Rule>, m);
    }
    case 'create':
      if (!live) throw new ServiceError('That rule is already gone', 'NOT_FOUND');
      remove(c.ruleId, m);
      return null;
  }
}

function notifyIfWindowsChanged(): void {
  const key = activeWindows().map((w) => `${w.rule.id}@${w.start.getTime()}`).sort().join(',');
  if (key === lastWindowsKey) return;
  lastWindowsKey = key;
  onWindowsChange?.();
}

function tick(): void {
  const now   = new Date();
  const fired = getLastFired();
  for (const rule of getRules()) {
    if (!rule.enabled) continue;
    const start = latestStart(rule, now);
    if (!start) continue;
    const key = dateKey(start);
    if (fired[rule.id] === key || fired[rule.id] === skipKey(key)) continue;

    const end = endFor(rule, start);
    const due = end ? now < end : now.getTime() - start.getTime() <= GRACE_MS;
    if (!due) continue;

    fired[rule.id] = key;
    saveLastFired(fired);
    const late = now.getTime() - start.getTime() > 60_000;
    console.log(`[rules] firing "${rule.name}"${late ? ` (${Math.round((now.getTime() - start.getTime()) / 60000)} min late)` : ''}`);
    try { executor?.(rule); } catch (e) { console.warn('[rules] execute error:', errorMessage(e)); }
  }
  // A window ending (or starting) changes which rule decides a zone's look
  notifyIfWindowsChanged();
}

export function debugInfo(): RulesDebugInfo {
  const now   = new Date();
  const fired = getLastFired();
  const sun   = suncalc.getTimes(now, LAT, LON);
  const active = new Set(activeWindows(now).map((w) => w.rule.id));
  return {
    serverIso:  now.toISOString(),
    serverTime: toHHMM(now),
    serverDay:  now.getDay(),
    timezone:   Intl.DateTimeFormat().resolvedOptions().timeZone,
    sunrise:    toHHMM(sun.sunrise),
    sunset:     toHHMM(sun.sunset),
    rules:      getRules().map((r) => {
      const start = latestStart(r, now);
      return {
        name:      r.name,
        time:      r.time,
        end:       r.end ?? null,
        enabled:   r.enabled,
        lastStart: start?.toISOString() ?? null,
        lastFired: fired[r.id] ?? null,
        active:    active.has(r.id),
      };
    }),
  };
}

/**
 * Starts the scheduler. It ticks right away, so a start missed while the server was down
 * is caught up on boot. `windowsChanged` is called whenever the set of active windows changes.
 */
export function init(exec: RuleExecutor, windowsChanged?: () => void): void {
  executor        = exec;
  onWindowsChange = windowsChanged ?? null;
  lastWindowsKey  = '';
  clearInterval(intervalId);
  intervalId = setInterval(tick, TICK_MS);
  tick();
  console.log('[rules] scheduler started');
}
