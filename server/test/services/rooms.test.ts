import { beforeEach, describe, expect, it } from 'vitest';
import * as rooms from '../../services/rooms';
import { readConfig, writeConfig } from '../helpers/config';

beforeEach(() => writeConfig({
  rooms: {
    living:  { name: 'Living Room', devices: ['0xlamp', '0xceiling'] },
    bedroom: { name: 'Bedroom',     devices: [] },
  },
}));

describe('rooms', () => {
  it('looks up devices and the room a device belongs to', () => {
    expect(rooms.getDevices('living')).toEqual(['0xlamp', '0xceiling']);
    expect(rooms.getDevices('garage')).toEqual([]);
    expect(rooms.getRoomForDevice('0xceiling')).toBe('living');
    expect(rooms.getRoomForDevice('0xnope')).toBeNull();
  });

  it('finds a room by id or by name, ignoring case', () => {
    expect(rooms.findRoom('living')).toBe('living');
    expect(rooms.findRoom('living room')).toBe('living');
    expect(rooms.findRoom('Garage')).toBeNull();
  });

  it('create returns a new id; names stay unique regardless of case', () => {
    const id = rooms.create('  Kitchen ');
    expect(readConfig().rooms?.[id]).toEqual({ name: 'Kitchen', devices: [] });
    expect(() => rooms.create('kitchen')).toThrow(expect.objectContaining({ code: 'EXISTS' }));
    expect(() => rooms.create('')).toThrow(expect.objectContaining({ code: 'INVALID' }));
  });

  it('rename keeps the id (so rules and presence keep pointing at it)', () => {
    rooms.rename('bedroom', 'Guest Room');
    expect(readConfig().rooms?.bedroom?.name).toBe('Guest Room');
    expect(() => rooms.rename('ghost', 'X')).toThrow(expect.objectContaining({ code: 'NOT_FOUND' }));
    expect(() => rooms.rename('bedroom', 'living room')).toThrow(expect.objectContaining({ code: 'EXISTS' }));
  });

  it('assignDevice moves a device between rooms, and null unassigns it', () => {
    rooms.assignDevice('0xlamp', 'bedroom');
    expect(rooms.getDevices('living')).toEqual(['0xceiling']);
    expect(rooms.getDevices('bedroom')).toEqual(['0xlamp']);

    rooms.assignDevice('0xlamp', null);
    expect(rooms.getRoomForDevice('0xlamp')).toBeNull();
    expect(() => rooms.assignDevice('0xlamp', 'ghost')).toThrow(expect.objectContaining({ code: 'NOT_FOUND' }));
  });

  it('remove deletes the room', () => {
    rooms.remove('living');
    expect(Object.keys(rooms.get())).toEqual(['bedroom']);
  });

  it('ignores the pre-migration name → [names] shape instead of crashing', () => {
    writeConfig({ rooms: { 'Living Room': ['Lamp'] } as never });
    expect(rooms.get()).toEqual({});
  });
});

describe('zones', () => {
  it('is every room plus each unassigned known bulb, limited to known bulbs', () => {
    expect(rooms.zones(['0xlamp', '0xdesk'])).toEqual({
      living:  ['0xlamp'],
      bedroom: [],
      '0xdesk': ['0xdesk'],
    });
    expect(rooms.zoneOf('0xlamp')).toBe('living');
    expect(rooms.zoneOf('0xdesk')).toBe('0xdesk');
  });
});
