import * as config from '../config';
import { genId } from '../util';
import { dateKey, latestStart, skipKey } from './rules';
import type { PresenceConfigMap, Room, RoomsMap, Rule, Z2MDevice } from '../types';

// Lighting schema 2: bulbs, sensors and rooms are referred to by id everywhere instead of
// by name, so a rename can't orphan a room member, rule, presence trigger or Auto setting.
//
// Turning old names into IEEE addresses needs the bridge's device list, so this runs once
// that list has arrived. It writes a timestamped backup of config.json first.

export const SCHEMA = 2;

type Legacy = Record<string, unknown> & {
  rooms?:             Record<string, string[] | Room>;
  circadianGroups?:   string[];
  bulbDesiredStates?: unknown;
  presence?:          PresenceConfigMap;
  rules?:             Rule[];
};

export function isMigrated(): boolean {
  return config.get('lightingSchema') === SCHEMA;
}

function hasLegacyData(data: Legacy): boolean {
  const oldRooms = Object.values(data.rooms ?? {}).some(Array.isArray);
  return oldRooms
    || (data.circadianGroups?.length ?? 0) > 0
    || Object.keys(data.presence ?? {}).length > 0
    || (data.rules?.length ?? 0) > 0;
}

/**
 * Upgrades config.json to schema 2 if it isn't already. Returns true when it ran. With
 * old data present it waits (returns false) until `devices` holds a real device list.
 */
export function migrateLighting(devices: Z2MDevice[]): boolean {
  const data = config.readAll() as Legacy;
  if (data.lightingSchema === SCHEMA) return false;

  const real = devices.filter((d) => d.type !== 'Coordinator');
  const legacy = hasLegacyData(data);
  if (legacy && real.length === 0) return false;

  const backup = legacy ? config.backup('pre-ids') : null;

  const idByName = new Map(real.map((d) => [d.friendly_name, d.ieee_address]));
  const knownIds = new Set(real.map((d) => d.ieee_address));
  const toId = (nameOrId: string): string | null =>
    idByName.get(nameOrId) ?? (knownIds.has(nameOrId) ? nameOrId : null);

  // Rooms: name → [bulb names]  becomes  id → { name, devices: [addresses] }
  const rooms: RoomsMap = {};
  const roomIdByName = new Map<string, string>();
  for (const [key, value] of Object.entries(data.rooms ?? {})) {
    if (Array.isArray(value)) {
      const id = `room_${genId()}`;
      rooms[id] = { name: key, devices: value.map(toId).filter((d): d is string => d !== null) };
      roomIdByName.set(key, id);
    } else {
      rooms[key] = value;
      roomIdByName.set(value.name, key);
    }
  }

  // Auto was per bulb; it's per zone now. A room is on Auto if any of its bulbs was.
  const autoBulbs = new Set((data.circadianGroups ?? []).map(toId).filter((d): d is string => d !== null));
  const autoZones = new Set<string>(config.get('autoZones') ?? []);
  const inARoom   = new Set<string>();
  for (const [id, room] of Object.entries(rooms)) {
    room.devices.forEach((d) => inARoom.add(d));
    if (room.devices.some((d) => autoBulbs.has(d))) autoZones.add(id);
  }
  autoBulbs.forEach((b) => { if (!inARoom.has(b)) autoZones.add(b); });

  const presence: PresenceConfigMap = {};
  for (const [sensor, entry] of Object.entries(data.presence ?? {})) {
    presence[toId(sensor) ?? sensor] = { ...entry, room: roomIdByName.get(entry.room) ?? entry.room };
  }

  const resolveGroup = (g: string): string => g === 'all' ? g : roomIdByName.get(g) ?? toId(g) ?? g;
  const rules = (data.rules ?? []).map((r) => ({ ...r, action: { ...r.action, group: resolveGroup(r.action.group) } }));

  // Existing rules start counting from their next start, so the upgrade itself fires nothing.
  const ruleLastFired: Record<string, string> = {};
  for (const rule of rules) {
    const start = latestStart(rule);
    if (start) ruleLastFired[rule.id] = skipKey(dateKey(start));
  }

  delete data.circadianGroups;
  delete data.bulbDesiredStates;
  config.writeAll({
    ...data,
    lightingSchema: SCHEMA,
    rooms,
    autoZones: [...autoZones],
    presence,
    rules,
    ruleLastFired: { ...ruleLastFired, ...(data.ruleLastFired as Record<string, string> | undefined) },
  });

  console.log(`[migrate] lighting config upgraded to schema ${SCHEMA}${backup ? ` (backup: ${backup})` : ''}`);
  return true;
}
