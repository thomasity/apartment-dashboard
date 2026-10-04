import * as config from '../config';
import { ServiceError } from '../util';
import type { RoomsMap } from '../types';

export function get(): RoomsMap { return config.get('rooms') ?? {}; }

function save(rooms: RoomsMap): void { config.set('rooms', rooms); }

export function getDevices(roomName: string): string[] { return get()[roomName] ?? []; }

export function getRoomForDevice(deviceName: string): string | null {
  const rooms = get();
  return Object.keys(rooms).find((r) => rooms[r]?.includes(deviceName)) ?? null;
}

export function create(name: string): void {
  if (!name) throw new ServiceError('name required', 'INVALID');
  const rooms = get();
  if (rooms[name]) throw new ServiceError('Room already exists', 'EXISTS');
  rooms[name] = [];
  save(rooms);
}

export function rename(oldName: string, newName: string): void {
  if (!newName) throw new ServiceError('newName required', 'INVALID');
  const rooms = get();
  const devices = rooms[oldName];
  if (!devices) throw new ServiceError('Room not found', 'NOT_FOUND');
  if (rooms[newName]) throw new ServiceError('Name taken', 'EXISTS');
  rooms[newName] = devices;
  delete rooms[oldName];
  save(rooms);
}

export function remove(name: string): void {
  const rooms = get();
  delete rooms[name];
  save(rooms);
}

/** Assign device to a room (or pass null to unassign from all rooms). */
export function assignDevice(deviceName: string, roomName: string | null): void {
  const rooms = get();
  for (const [r, devices] of Object.entries(rooms)) rooms[r] = devices.filter((d) => d !== deviceName);
  if (roomName) {
    (rooms[roomName] ??= []).push(deviceName);
  }
  save(rooms);
}
