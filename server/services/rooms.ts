import * as config from '../config';
import { ServiceError, genId } from '../util';
import type { Room, RoomsMap } from '../types';

// Until migrate.ts has run, config may still hold the old name → [names] shape; that is
// ignored here (and the lighting routes refuse changes until then, so nothing overwrites it).
export function get(): RoomsMap {
  const rooms = config.get('rooms') ?? {};
  return Object.fromEntries(
    Object.entries(rooms).filter(([, r]) => r && !Array.isArray(r) && Array.isArray(r.devices)),
  );
}

function save(rooms: RoomsMap): void { config.set('rooms', rooms); }

export function getRoom(id: string): Room | null { return get()[id] ?? null; }

export function getDevices(roomId: string): string[] { return get()[roomId]?.devices ?? []; }

export function getRoomForDevice(deviceId: string): string | null {
  const rooms = get();
  return Object.keys(rooms).find((r) => rooms[r]?.devices.includes(deviceId)) ?? null;
}

/** A room id from an id or a (case-insensitive) name — voice and rules may use either. */
export function findRoom(idOrName: string): string | null {
  const rooms = get();
  if (rooms[idOrName]) return idOrName;
  const lower = idOrName.trim().toLowerCase();
  return Object.keys(rooms).find((r) => rooms[r]?.name.toLowerCase() === lower) ?? null;
}

function nameTaken(rooms: RoomsMap, name: string, except?: string): boolean {
  const lower = name.toLowerCase();
  return Object.entries(rooms).some(([id, r]) => id !== except && r.name.toLowerCase() === lower);
}

/** Creates a room and returns its id. */
export function create(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) throw new ServiceError('name required', 'INVALID');
  const rooms = get();
  if (nameTaken(rooms, trimmed)) throw new ServiceError('Room already exists', 'EXISTS');
  const id = `room_${genId()}`;
  rooms[id] = { name: trimmed, devices: [] };
  save(rooms);
  return id;
}

export function rename(id: string, newName: string): void {
  const trimmed = newName.trim();
  if (!trimmed) throw new ServiceError('name required', 'INVALID');
  const rooms = get();
  const room  = rooms[id];
  if (!room) throw new ServiceError('Room not found', 'NOT_FOUND');
  if (nameTaken(rooms, trimmed, id)) throw new ServiceError('Name taken', 'EXISTS');
  room.name = trimmed;
  save(rooms);
}

export function remove(id: string): void {
  const rooms = get();
  delete rooms[id];
  save(rooms);
}

/** Assign a bulb to a room (or pass null to take it out of every room). */
export function assignDevice(deviceId: string, roomId: string | null): void {
  const rooms = get();
  if (roomId && !rooms[roomId]) throw new ServiceError('Room not found', 'NOT_FOUND');
  for (const room of Object.values(rooms)) room.devices = room.devices.filter((d) => d !== deviceId);
  if (roomId) rooms[roomId]!.devices.push(deviceId);
  save(rooms);
}

/**
 * Zones are what the lighting controller decides for: every room, plus each known bulb
 * that isn't in a room (as a zone of one, id = its address). Members are limited to
 * `knownBulbs` so a removed bulb never keeps a room "on".
 */
export function zones(knownBulbs: string[]): Record<string, string[]> {
  const known = new Set(knownBulbs);
  const result: Record<string, string[]> = {};
  const inARoom = new Set<string>();
  for (const [id, room] of Object.entries(get())) {
    result[id] = room.devices.filter((d) => known.has(d));
    room.devices.forEach((d) => inARoom.add(d));
  }
  for (const bulb of knownBulbs) if (!inARoom.has(bulb)) result[bulb] = [bulb];
  return result;
}

export function zoneOf(bulb: string): string {
  return getRoomForDevice(bulb) ?? bulb;
}
