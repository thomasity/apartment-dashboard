const config   = require('../config');
const suncalc  = require('suncalc');

const LAT = parseFloat(process.env.LAT);
const LON = parseFloat(process.env.LON);

let _sunCache = { date: null, sunrise: null, sunset: null };

function toHHMM(d) {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function getSunTimes() {
  const today = new Date().toDateString();
  if (_sunCache.date !== today) {
    const times  = suncalc.getTimes(new Date(), LAT, LON);
    _sunCache = { date: today, sunrise: toHHMM(times.sunrise), sunset: toHHMM(times.sunset) };
    console.log(`[rules] sun times: sunrise=${_sunCache.sunrise} sunset=${_sunCache.sunset}`);
  }
  return _sunCache;
}

function resolveTime(ruleTime) {
  if (ruleTime === 'sunrise') return getSunTimes().sunrise;
  if (ruleTime === 'sunset')  return getSunTimes().sunset;
  return ruleTime;
}

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

let _intervalId = null;
let _lastMinute = null;
let _executor   = null;

function getRules() { return config.get('rules') ?? []; }
function saveRules(r) { config.set('rules', r); }

function create(rule) {
  const rules  = getRules();
  const newRule = { id: genId(), enabled: true, ...rule };
  rules.push(newRule);
  saveRules(rules);
  return newRule;
}

function update(id, patch) {
  const rules = getRules();
  const idx   = rules.findIndex((r) => r.id === id);
  if (idx === -1) throw Object.assign(new Error('Rule not found'), { code: 'NOT_FOUND' });
  rules[idx] = { ...rules[idx], ...patch };
  saveRules(rules);
  return rules[idx];
}

function remove(id) {
  saveRules(getRules().filter((r) => r.id !== id));
}

function currentMinute() {
  const now = new Date();
  return {
    minute:   `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`,
    day:      now.getDay(),
    iso:      now.toISOString(),
    tz:       Intl.DateTimeFormat().resolvedOptions().timeZone,
  };
}

function tick() {
  const { minute, day } = currentMinute();
  if (minute === _lastMinute) return;
  _lastMinute = minute;
  for (const rule of getRules()) {
    if (!rule.enabled || resolveTime(rule.time) !== minute) continue;
    if (!rule.days.includes(day)) continue;
    console.log(`[rules] firing "${rule.name}"`);
    try { if (_executor) _executor(rule); } catch (e) { console.warn('[rules] execute error:', e.message); }
  }
}

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

function init(executor) {
  _executor   = executor;
  _lastMinute = null;
  clearInterval(_intervalId);
  _intervalId = setInterval(tick, 10000);
  console.log('[rules] scheduler started');
}

module.exports = { getRules, create, update, remove, init, debugInfo };
