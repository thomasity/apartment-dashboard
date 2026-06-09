const suncalc = require('suncalc');

const LAT = parseFloat(process.env.LAT || '40.7128');
const LON = parseFloat(process.env.LON || '-74.0060');
const INTERVAL_MS = 15 * 60 * 1000;

let _enabledGroups = new Set();
let _intervalId    = null;
let _mqttMgr       = null;
let _io            = null;
let _lastApplied   = null;
let _current       = { brightness: 50, colorTemp: 50 };

function computeValues(date = new Date()) {
  const { altitude } = suncalc.getPosition(date, LAT, LON);
  if (altitude <= 0) return { brightness: 20, colorTemp: 5 };
  const t = Math.min(1, altitude / (Math.PI / 4));
  return {
    brightness: Math.round(35 + 65 * t),
    colorTemp:  Math.round(10 + 70 * t),
  };
}

function apply() {
  if (!_mqttMgr || _enabledGroups.size === 0) return;
  _current     = computeValues();
  _lastApplied = Date.now();
  _enabledGroups.forEach((g) => _mqttMgr.setGroup(g, _current));
  if (_io) _io.emit('lighting:circadian', getState());
}

function getState() {
  return {
    enabledGroups: [..._enabledGroups],
    brightness:    _current.brightness,
    colorTemp:     _current.colorTemp,
    nextChange:    _enabledGroups.size > 0 && _lastApplied
      ? new Date(_lastApplied + INTERVAL_MS).toISOString()
      : null,
  };
}

function getTimeline() {
  const today = new Date();
  return Array.from({ length: 24 }, (_, h) => {
    const d = new Date(today);
    d.setHours(h, 0, 0, 0);
    return { hour: h, ...computeValues(d) };
  });
}

module.exports = {
  init(mqttMgr, io) {
    _mqttMgr = mqttMgr;
    _io      = io;
  },

  enable(group) {
    if (group === 'all') {
      Object.keys(_mqttMgr?.groups ?? {}).forEach((g) => _enabledGroups.add(g));
    } else {
      _enabledGroups.add(group);
    }
    apply();
    if (!_intervalId && _enabledGroups.size > 0) {
      _intervalId = setInterval(apply, INTERVAL_MS);
    }
  },

  disable(group) {
    if (group === 'all') {
      _enabledGroups.clear();
    } else {
      _enabledGroups.delete(group);
    }
    if (_enabledGroups.size === 0) {
      clearInterval(_intervalId);
      _intervalId = null;
    }
    if (_io) _io.emit('lighting:circadian', getState());
  },

  getState,
  getTimeline,
};
