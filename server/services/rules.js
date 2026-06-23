const config = require('../config');

// Rule shape:
// { id, name, time: "HH:MM", days: [0..6], enabled: bool,
//   action: { type: 'power'|'scene'|'circadian', group: 'all'|roomName,
//             on?: bool, brightness?: num, colorTemp?: num, enabled?: bool } }

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
    if (!rule.enabled || rule.time !== minute) continue;
    if (!rule.days.includes(day)) continue;
    console.log(`[rules] firing "${rule.name}" (${minute} day=${day})`);
    try { if (_executor) _executor(rule); } catch (e) { console.warn('[rules] execute error:', e.message); }
  }
}

function debugInfo() {
  const { minute, day, iso, tz } = currentMinute();
  return {
    serverIso:  iso,
    serverTime: minute,
    serverDay:  day,
    timezone:   tz,
    rules:      getRules().map((r) => ({
      name:    r.name,
      time:    r.time,
      days:    r.days,
      enabled: r.enabled,
      willFireToday: r.enabled && r.days.includes(day),
    })),
  };
}

function init(executor) {
  _executor   = executor;
  _lastMinute = null;
  clearInterval(_intervalId);
  _intervalId = setInterval(tick, 10000); // checks every 10s, fires at most once per minute
  if (_intervalId.unref) _intervalId.unref();
}

module.exports = { getRules, create, update, remove, init, debugInfo };
