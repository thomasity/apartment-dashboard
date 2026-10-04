const config = require('../config');

const DEFAULT_VACANT_MINUTES     = 5;
const DEFAULT_MANUAL_OFF_MINUTES = 120;

/**
 * @typedef {Object} PresenceConfigEntry
 * @property {string} room
 * @property {number} vacantAfterMinutes
 * @property {number} manualOffCooldownMinutes
 * @property {boolean} enabled
 *
 * @typedef {Object.<string, PresenceConfigEntry>} PresenceConfigMap keyed by sensor name
 *
 * @typedef {Object} PresenceEntry
 * @property {string} sensor
 * @property {string} room
 * @property {number} vacantAfterMinutes
 * @property {number} manualOffCooldownMinutes
 * @property {boolean} enabled
 * @property {boolean|null} occupancy
 * @property {number|null} manualOffUntil
 * @property {boolean} vacancyTimerActive
 *
 * @typedef {Object} CreateParams
 * @property {string} sensor
 * @property {string} room
 * @property {number} [vacantAfterMinutes]
 * @property {number} [manualOffCooldownMinutes]
 * @property {boolean} [enabled]
 *
 * @typedef {Object} OccupancyEvent
 * @property {string} name sensor name
 * @property {boolean} occupancy
 *
 * @typedef {Object} MqttManagerLike
 * @property {(group: string, on: boolean) => void} setPower
 * @property {() => Object.<string, { occupancy: boolean|null }>} [getSensorsState]
 * @property {(event: 'occupancyChange', listener: (e: OccupancyEvent) => void) => void} on
 *
 * @typedef {Object} RoomsServiceLike
 * @property {(room: string) => string[]} getDevices
 */

/** @type {MqttManagerLike|null} */
let _mqttMgr  = null;
/** @type {RoomsServiceLike|null} */
let _roomsSvc = null;

/** @type {Object.<string, ReturnType<typeof setTimeout>>} room → timeout handle, pending "turn off after vacant" action */
const _vacancyTimers  = {};
/** @type {Object.<string, number>} room → timestamp ms, suppresses auto-on until this passes */
const _manualOffUntil = {};

/** @returns {PresenceConfigMap} */
function getConfig() { return config.get('presence') ?? {}; }

/** @param {PresenceConfigMap} c @returns {void} */
function saveConfig(c) { config.set('presence', c); }

/**
 * Registers (or re-registers) a sensor → room mapping. Call again with the same
 * sensor name to fully replace its config.
 * @param {CreateParams} params
 * @returns {PresenceEntry}
 */
function create({ sensor, room, vacantAfterMinutes, manualOffCooldownMinutes, enabled = true }) {
  if (!sensor || !room) throw Object.assign(new Error('sensor and room required'), { code: 'INVALID' });
  const cfg = getConfig();
  cfg[sensor] = {
    room,
    vacantAfterMinutes:       vacantAfterMinutes       ?? DEFAULT_VACANT_MINUTES,
    manualOffCooldownMinutes: manualOffCooldownMinutes ?? DEFAULT_MANUAL_OFF_MINUTES,
    enabled,
  };
  saveConfig(cfg);
  return { sensor, ...cfg[sensor], occupancy: null, manualOffUntil: null, vacancyTimerActive: false };
}

/**
 * @param {string} sensor
 * @param {Partial<PresenceConfigEntry>} patch
 * @returns {PresenceConfigEntry & { sensor: string }}
 */
function update(sensor, patch) {
  const cfg = getConfig();
  if (!cfg[sensor]) throw Object.assign(new Error('Presence sensor not configured'), { code: 'NOT_FOUND' });
  cfg[sensor] = { ...cfg[sensor], ...patch };
  saveConfig(cfg);
  return { sensor, ...cfg[sensor] };
}

/**
 * @param {string} sensor
 * @returns {void}
 */
function remove(sensor) {
  const cfg  = getConfig();
  const room = cfg[sensor]?.room;
  delete cfg[sensor];
  saveConfig(cfg);
  if (room) {
    clearTimeout(_vacancyTimers[room]);
    delete _vacancyTimers[room];
  }
}

/** @returns {PresenceEntry[]} */
function getState() {
  const cfg          = getConfig();
  const sensorsState = _mqttMgr?.getSensorsState?.() ?? {};
  return Object.entries(cfg).map(([sensor, c]) => ({
    sensor,
    ...c,
    occupancy:          sensorsState[sensor]?.occupancy ?? null,
    manualOffUntil:      _manualOffUntil[c.room] ?? null,
    vacancyTimerActive: !!_vacancyTimers[c.room],
  }));
}

/**
 * Called from the lighting routes whenever a room's power is set by the user (dashboard,
 * voice, etc.) — as opposed to presence.js's own automatic setPower calls below, which
 * must NOT feed back into this. Turning off starts the "don't auto-on" cooldown for the
 * room's configured sensor(s); turning back on clears it early.
 * @param {string} room
 * @param {boolean} on
 * @returns {void}
 */
function recordManualPower(room, on) {
  if (on) {
    delete _manualOffUntil[room];
    return;
  }
  const entry = Object.values(getConfig()).find((c) => c.room === room);
  if (!entry) return; // no presence sensor configured for this room — nothing to suppress
  _manualOffUntil[room] = Date.now() + Math.max(1, entry.manualOffCooldownMinutes) * 60000;
}

/**
 * @param {OccupancyEvent} event
 * @returns {void}
 */
function handleOccupancy({ name, occupancy }) {
  const cfg = getConfig()[name];
  if (!cfg || cfg.enabled === false) return;
  const { room, vacantAfterMinutes } = cfg;

  clearTimeout(_vacancyTimers[room]);
  delete _vacancyTimers[room];

  if (occupancy) {
    const suppressUntil = _manualOffUntil[room];
    if (suppressUntil && Date.now() < suppressUntil) {
      console.log(`[presence] ${room}: occupancy detected but manual-off cooldown active, skipping auto-on`);
      return;
    }
    _roomsSvc.getDevices(room).forEach((g) => _mqttMgr.setPower(g, true));
  } else {
    const ms = Math.max(1, vacantAfterMinutes) * 60000;
    _vacancyTimers[room] = setTimeout(() => {
      delete _vacancyTimers[room];
      _roomsSvc.getDevices(room).forEach((g) => _mqttMgr.setPower(g, false));
      console.log(`[presence] ${room}: vacant, lights off`);
    }, ms);
  }
}

/**
 * @param {MqttManagerLike} mqttMgr
 * @param {RoomsServiceLike} roomsSvc
 * @returns {void}
 */
function init(mqttMgr, roomsSvc) {
  _mqttMgr  = mqttMgr;
  _roomsSvc = roomsSvc;
  _mqttMgr.on('occupancyChange', handleOccupancy);
}

module.exports = { init, create, update, remove, getState, recordManualPower };
