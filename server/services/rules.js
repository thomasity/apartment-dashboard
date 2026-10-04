const config   = require('../config');
const suncalc  = require('suncalc');

const LAT = parseFloat(process.env.LAT);
const LON = parseFloat(process.env.LON);

/**
 * @typedef {'power'|'reconfigure'} RuleActionType
 * @typedef {'none'|'scene'|'auto'} RuleConfigMode
 *
 * @typedef {Object} RuleAction
 * @property {RuleActionType} type
 * @property {string} group
 * @property {boolean} [on] power only
 * @property {RuleConfigMode} [config] 'none' = resume previous; 'scene' = apply brightness+colorTemp; 'auto' = circadian
 * @property {number} [brightness]
 * @property {number} [colorTemp]
 *
 * @typedef {Object} Rule
 * @property {string} id
 * @property {string} name
 * @property {string} time "HH:MM" 24-hour format, or "sunrise" / "sunset"
 * @property {number[]} days 0 = Sunday … 6 = Saturday
 * @property {boolean} enabled
 * @property {RuleAction} action
 *
 * @typedef {(rule: Rule) => void} RuleExecutor
 *
 * @typedef {Object} SunTimes
 * @property {string|null} date
 * @property {string|null} sunrise
 * @property {string|null} sunset
 *
 * @typedef {Object} CurrentMinute
 * @property {string} minute "HH:MM"
 * @property {number} day 0 = Sunday … 6 = Saturday
 * @property {string} iso
 * @property {string} tz
 */

/** @type {SunTimes} */
let _sunCache = { date: null, sunrise: null, sunset: null };

/**
 * @param {Date} d
 * @returns {string}
 */
function toHHMM(d) {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** @returns {SunTimes} */
function getSunTimes() {
  const today = new Date().toDateString();
  if (_sunCache.date !== today) {
    const times  = suncalc.getTimes(new Date(), LAT, LON);
    _sunCache = { date: today, sunrise: toHHMM(times.sunrise), sunset: toHHMM(times.sunset) };
    console.log(`[rules] sun times: sunrise=${_sunCache.sunrise} sunset=${_sunCache.sunset}`);
  }
  return _sunCache;
}

/**
 * @param {string} ruleTime "HH:MM", or "sunrise" / "sunset"
 * @returns {string} "HH:MM"
 */
function resolveTime(ruleTime) {
  // getSunTimes() always (re)computes before returning, so sunrise/sunset are
  // populated by the time we read them here — the typedef's nullability only
  // describes the cache's pre-first-call state.
  if (ruleTime === 'sunrise') return /** @type {string} */ (getSunTimes().sunrise);
  if (ruleTime === 'sunset')  return /** @type {string} */ (getSunTimes().sunset);
  return ruleTime;
}

/** @returns {string} */
function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

/** @type {ReturnType<typeof setInterval>|null} */
let _intervalId = null;
/** @type {string|null} */
let _lastMinute = null;
/** @type {RuleExecutor|null} */
let _executor   = null;

/** @returns {Rule[]} */
function getRules() { return config.get('rules') ?? []; }

/** @param {Rule[]} r @returns {void} */
function saveRules(r) { config.set('rules', r); }

/**
 * @param {Omit<Rule, 'id'|'enabled'> & Partial<Pick<Rule, 'enabled'>>} rule
 * @returns {Rule}
 */
function create(rule) {
  const rules  = getRules();
  const newRule = { id: genId(), enabled: true, ...rule };
  rules.push(newRule);
  saveRules(rules);
  return newRule;
}

/**
 * @param {string} id
 * @param {Partial<Rule>} patch
 * @returns {Rule}
 */
function update(id, patch) {
  const rules = getRules();
  const idx   = rules.findIndex((r) => r.id === id);
  if (idx === -1) throw Object.assign(new Error('Rule not found'), { code: 'NOT_FOUND' });
  rules[idx] = { ...rules[idx], ...patch };
  saveRules(rules);
  return rules[idx];
}

/**
 * @param {string} id
 * @returns {void}
 */
function remove(id) {
  saveRules(getRules().filter((r) => r.id !== id));
}

/** @returns {CurrentMinute} */
function currentMinute() {
  const now = new Date();
  return {
    minute:   `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`,
    day:      now.getDay(),
    iso:      now.toISOString(),
    tz:       Intl.DateTimeFormat().resolvedOptions().timeZone,
  };
}

/** @returns {void} */
function tick() {
  const { minute, day } = currentMinute();
  if (minute === _lastMinute) return;
  _lastMinute = minute;
  for (const rule of getRules()) {
    if (!rule.enabled || resolveTime(rule.time) !== minute) continue;
    if (!rule.days.includes(day)) continue;
    console.log(`[rules] firing "${rule.name}"`);
    try { if (_executor) _executor(rule); } catch (/** @type {any} */ e) { console.warn('[rules] execute error:', e.message); }
  }
}

/**
 * @returns {{
 *   serverIso: string,
 *   serverTime: string,
 *   serverDay: number,
 *   timezone: string,
 *   sunrise: string|null,
 *   sunset: string|null,
 *   rules: Array<{ name: string, time: string, resolvedTime: string, days: number[], enabled: boolean, willFireToday: boolean }>,
 * }}
 */
function debugInfo() {
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
      name:         r.name,
      time:         r.time,
      resolvedTime: resolveTime(r.time),
      days:         r.days,
      enabled:      r.enabled,
      willFireToday: r.enabled && r.days.includes(day),
    })),
  };
}

/**
 * @param {RuleExecutor} executor
 * @returns {void}
 */
function init(executor) {
  _executor   = executor;
  _lastMinute = null;
  clearInterval(_intervalId);
  _intervalId = setInterval(tick, 10000);
  console.log('[rules] scheduler started');
}

module.exports = { getRules, create, update, remove, init, debugInfo };
