const config = require('../config');

function get() { return config.get('rooms') ?? {}; }
function save(rooms) { config.set('rooms', rooms); }

function getDevices(roomName) { return get()[roomName] ?? []; }

function create(name) {
  if (!name) throw Object.assign(new Error('name required'), { code: 'INVALID' });
  const rooms = get();
  if (rooms[name]) throw Object.assign(new Error('Room already exists'), { code: 'EXISTS' });
  rooms[name] = [];
  save(rooms);
}

function rename(oldName, newName) {
  if (!newName) throw Object.assign(new Error('newName required'), { code: 'INVALID' });
  const rooms = get();
  if (!rooms[oldName]) throw Object.assign(new Error('Room not found'), { code: 'NOT_FOUND' });
  if (rooms[newName]) throw Object.assign(new Error('Name taken'), { code: 'EXISTS' });
  rooms[newName] = rooms[oldName];
  delete rooms[oldName];
  save(rooms);
}

function remove(name) {
  const rooms = get();
  delete rooms[name];
  save(rooms);
}

// Assign device to a room (or pass null to unassign from all rooms)
function assignDevice(deviceName, roomName) {
  const rooms = get();
  for (const r of Object.keys(rooms)) rooms[r] = rooms[r].filter((d) => d !== deviceName);
  if (roomName) {
    if (!rooms[roomName]) rooms[roomName] = [];
    rooms[roomName].push(deviceName);
  }
  save(rooms);
}

module.exports = { get, getDevices, create, rename, remove, assignDevice };
