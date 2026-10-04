const suncalc = require('suncalc');
const config  = require('../config');

const LAT = parseFloat(process.env.LAT || '40.7128');
const LON = parseFloat(process.env.LON || '-74.0060');
const INTERVAL_MS = 15 * 60 * 1000;

/**
 * @typedef {Object} LightingValues
 * @property {number} brightness
 * @property {number} colorTemp
 *
 * @typedef {Object} CircadianPoint
 * @property {number} hour
 * @property {number} brightness
 * @property {number} colorTemp
 *
 * @typedef {Object} CircadianState
 * @property {string[]} enabledGroups
 * @property {number} brightness
 * @property {number} colorTemp
 * @property {string|null} nextChange
 *
 * @typedef {(group: string) => boolean} IsOverriddenFn
 *
 * @typedef {Object} MqttManagerLike
 * @property {Object.<string, unknown>} groups
 * @property {(group: string, values: Partial<LightingValues>) => void} setGroup
 *
 * @typedef {Object} SocketIOLike
 * @property {(event: string, payload: unknown) => void} emit
 */

/** @type {Set<string>} */
let _enabledGroups  = new Set();
/** @type {ReturnType<typeof setInterval>|null} */
let _intervalId     = null;
/** @type {MqttManagerLike|null} */
let _mqttMgr        = null;
/** @type {SocketIOLike|null} */
let _io             = null;
/** @type {number|null} */
let _lastApplied    = null;
/** @type {LightingValues} */
let _current        = { brightness: 50, colorTemp: 50 };
/** @type {IsOverriddenFn} */
let _isOverridden   = () => false;

/** @returns {void} */
function saveEnabledGroups() {
  config.set('circadianGroups', [..._enabledGroups]);
}

/**
 * @param {Date} [date]
 * @returns {LightingValues}
 */
function computeValues(date = new Date()) {
  const { altitude } = suncalc.getPosition(date, LAT, LON);
  if (altitude <= 0) return { brightness: 20, colorTemp: 5 };
  const t = Math.min(1, altitude / (Math.PI / 4));
  return {
    brightness: Math.round(35 + 65 * t),
    colorTemp:  Math.round(10 + 70 * t),
  };
}

/** @returns {void} */
function apply() {
  if (!_mqttMgr || _enabledGroups.size === 0) return;
  _current     = computeValues();
  _lastApplied = Date.now();
  _enabledGroups.forEach((g) => { if (!_isOverridden(g)) _mqttMgr.setGroup(g, _current); });
  if (_io) _io.emit('lighting:circadian', getState());
}

/** @returns {CircadianState} */
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

/** @returns {CircadianPoint[]} */
function getTimeline() {
  const today = new Date();
  return Array.from({ length: 24 }, (_, h) => {
    const d = new Date(today);
    d.setHours(h, 0, 0, 0);
    return { hour: h, ...computeValues(d) };
  });
}

module.exports = {
  /**
   * @param {MqttManagerLike} mqttMgr
   * @param {SocketIOLike} io
   * @param {IsOverriddenFn} [isOverridden]
   * @returns {void}
   */
  init(mqttMgr, io, isOverridden) {
    _mqttMgr      = mqttMgr;
    _io           = io;
    _isOverridden = isOverridden ?? (() => false);

    // Restore persisted auto groups
    const saved = /** @type {string[]} */ (config.get('circadianGroups') ?? []);
    saved.forEach((g) => _enabledGroups.add(g));
    if (_enabledGroups.size > 0) {
      apply();
      _intervalId = setInterval(apply, INTERVAL_MS);
    }
  },

  /**
   * @param {string} group
   * @returns {void}
   */
  enable(group) {
    if (group === 'all') {
      Object.keys(_mqttMgr?.groups ?? {}).forEach((g) => _enabledGroups.add(g));
    } else {
      _enabledGroups.add(group);
    }
    saveEnabledGroups();
    apply();
    if (!_intervalId && _enabledGroups.size > 0) {
      _intervalId = setInterval(apply, INTERVAL_MS);
    }
  },

  /**
   * @param {string} group
   * @returns {void}
   */
  disable(group) {
    if (group === 'all') {
      _enabledGroups.clear();
    } else {
      _enabledGroups.delete(group);
    }
    saveEnabledGroups();
    if (_enabledGroups.size === 0) {
      clearInterval(_intervalId);
      _intervalId = null;
    }
    if (_io) _io.emit('lighting:circadian', getState());
  },

  /**
   * Re-apply current circadian values to one group immediately (used when override expires)
   * @param {string} group
   * @returns {void}
   */
  applyToGroup(group) {
    if (!_mqttMgr || !_enabledGroups.has(group)) return;
    _mqttMgr.setGroup(group, computeValues());
  },

  getState,
  getTimeline,
};
