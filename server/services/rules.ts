import suncalc from 'suncalc';
import * as config from '../config';
import { ServiceError, errorMessage, genId, toHHMM } from '../util';
import type { Rule } from '../types';

const LAT = parseFloat(process.env.LAT ?? '');
const LON = parseFloat(process.env.LON ?? '');

type RuleExecutor = (rule: Rule) => void;

export type NewRule = Omit<Rule, 'id' | 'enabled'> & Partial<Pick<Rule, 'enabled'>>;

interface SunTimes {
  date:    string;
  sunrise: string; // "HH:MM"
  sunset:  string; // "HH:MM"
}

interface CurrentMinute {
  minute: string; // "HH:MM"
  day:    number; // 0 = Sunday … 6 = Saturday
  iso:    string;
  tz:     string;
}

export interface RulesDebugInfo {
  serverIso:  string;
  serverTime: string;
  serverDay:  number;
  timezone:   string;
  sunrise:    string;
  sunset:     string;
  rules: Array<{
    name:          string;
    time:          string;
    resolvedTime:  string;
    days:          number[];
    enabled:       boolean;
    willFireToday: boolean;
  }>;
}

let sunCache: SunTimes | null = null;

function getSunTimes(): SunTimes {
  const today = new Date().toDateString();
  if (sunCache?.date !== today) {
    const times = suncalc.getTimes(new Date(), LAT, LON);
    sunCache = { date: today, sunrise: toHHMM(times.sunrise), sunset: toHHMM(times.sunset) };
    console.log(`[rules] sun times: sunrise=${sunCache.sunrise} sunset=${sunCache.sunset}`);
  }
  return sunCache;
}

/** "HH:MM", or "sunrise" / "sunset" → "HH:MM" */
function resolveTime(ruleTime: string): string {
  if (ruleTime === 'sunrise') return getSunTimes().sunrise;
  if (ruleTime === 'sunset')  return getSunTimes().sunset;
  return ruleTime;
}

let intervalId: NodeJS.Timeout | undefined;
let lastMinute: string | null       = null;
let executor:   RuleExecutor | null = null;

export function getRules(): Rule[] { return config.get('rules') ?? []; }

function saveRules(r: Rule[]): void { config.set('rules', r); }

export function create(rule: NewRule): Rule {
  const rules   = getRules();
  const newRule: Rule = { id: genId(), enabled: true, ...rule };
  rules.push(newRule);
  saveRules(rules);
  return newRule;
}

export function update(id: string, patch: Partial<Rule>): Rule {
  const rules = getRules();
  const idx   = rules.findIndex((r) => r.id === id);
  const existing = rules[idx];
  if (!existing) throw new ServiceError('Rule not found', 'NOT_FOUND');
  const updated = { ...existing, ...patch };
  rules[idx] = updated;
  saveRules(rules);
  return updated;
}

export function remove(id: string): void {
  saveRules(getRules().filter((r) => r.id !== id));
}

function currentMinute(): CurrentMinute {
  const now = new Date();
  return {
    minute: toHHMM(now),
    day:    now.getDay(),
    iso:    now.toISOString(),
    tz:     Intl.DateTimeFormat().resolvedOptions().timeZone,
  };
}

function tick(): void {
  const { minute, day } = currentMinute();
  if (minute === lastMinute) return;
  lastMinute = minute;
  for (const rule of getRules()) {
    if (!rule.enabled || resolveTime(rule.time) !== minute) continue;
    if (!rule.days.includes(day)) continue;
    console.log(`[rules] firing "${rule.name}"`);
    try { executor?.(rule); } catch (e) { console.warn('[rules] execute error:', errorMessage(e)); }
  }
}

export function debugInfo(): RulesDebugInfo {
  const { minute, day, iso, tz } = currentMinute();
  const sun = getSunTimes();
  return {
    serverIso:  iso,
    serverTime: minute,
    serverDay:  day,
    timezone:   tz,
    sunrise:    sun.sunrise,
    sunset:     sun.sunset,
    rules:      getRules().map((r) => ({
      name:          r.name,
      time:          r.time,
      resolvedTime:  resolveTime(r.time),
      days:          r.days,
      enabled:       r.enabled,
      willFireToday: r.enabled && r.days.includes(day),
    })),
  };
}

export function init(exec: RuleExecutor): void {
  executor   = exec;
  lastMinute = null;
  clearInterval(intervalId);
  intervalId = setInterval(tick, 10000);
  console.log('[rules] scheduler started');
}
