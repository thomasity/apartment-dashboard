const config = require('../config');

const DEFAULT_VACANT_MINUTES     = 5;
const DEFAULT_MANUAL_OFF_MINUTES = 120;

let _mqttMgr  = null;
let _roomsSvc = null;

const _vacancyTimers  = {}; // room → timeout handle, pending "turn off after vacant" action
const _manualOffUntil = {}; // room → timestamp ms, suppresses auto-on until this passes

function getConfig() { return config.get('presence') ?? {}; }
function saveConfig(c) { config.set('presence', c); }

// Registers (or re-registers) a sensor → room mapping. Call again with the same
// sensor name to fully replace its config.
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
  return { sensor, ...cfg[sensor] };
}

function update(sensor, patch) {
  const cfg = getConfig();
  if (!cfg[sensor]) throw Object.assign(new Error('Presence sensor not configured'), { code: 'NOT_FOUND' });
  cfg[sensor] = { ...cfg[sensor], ...patch };
  saveConfig(cfg);
  return { sensor, ...cfg[sensor] };
}

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

// Called from the lighting routes whenever a room's power is set by the user (dashboard,
// voice, etc.) — as opposed to presence.js's own automatic setPower calls below, which
// must NOT feed back into this. Turning off starts the "don't auto-on" cooldown for the
// room's configured sensor(s); turning back on clears it early.
function recordManualPower(room, on) {
  if (on) {
    delete _manualOffUntil[room];
    return;
  }
  const entry = Object.values(getConfig()).find((c) => c.room === room);
  if (!entry) return; // no presence sensor configured for this room — nothing to suppress
  _manualOffUntil[room] = Date.now() + Math.max(1, entry.manualOffCooldownMinutes) * 60000;
}

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

function init(mqttMgr, roomsSvc) {
  _mqttMgr  = mqttMgr;
  _roomsSvc = roomsSvc;
  _mqttMgr.on('occupancyChange', handleOccupancy);
}

module.exports = { init, create, update, remove, getState, recordManualPower };
