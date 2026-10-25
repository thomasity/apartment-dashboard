import { beforeEach, describe, expect, it } from 'vitest';
import * as rooms from '../../services/rooms';
import { writeConfig } from '../helpers/config';

beforeEach(() => writeConfig({ rooms: { 'Living Room': ['Lamp', 'Ceiling'], Bedroom: [] } }));

describe('rooms', () => {
  it('looks up devices and the room a device belongs to', () => {
    expect(rooms.getDevices('Living Room')).toEqual(['Lamp', 'Ceiling']);
    expect(rooms.getDevices('Garage')).toEqual([]);
    expect(rooms.getRoomForDevice('Ceiling')).toBe('Living Room');
    expect(rooms.getRoomForDevice('Nope')).toBeNull();
  });

  it('create rejects blanks and duplicates', () => {
    rooms.create('Kitchen');
    expect(rooms.get().Kitchen).toEqual([]);
    expect(() => rooms.create('')).toThrow(expect.objectContaining({ code: 'INVALID' }));
    expect(() => rooms.create('Kitchen')).toThrow(expect.objectContaining({ code: 'EXISTS' }));
  });

  it('rename keeps devices and guards against collisions', () => {
    rooms.rename('Living Room', 'Lounge');
    expect(rooms.get()).toEqual({ Lounge: ['Lamp', 'Ceiling'], Bedroom: [] });
    expect(() => rooms.rename('Ghost', 'X')).toThrow(expect.objectContaining({ code: 'NOT_FOUND' }));
    expect(() => rooms.rename('Lounge', 'Bedroom')).toThrow(expect.objectContaining({ code: 'EXISTS' }));
  });

  it('assignDevice moves a device so it is only ever in one room', () => {
    rooms.assignDevice('Lamp', 'Bedroom');
    expect(rooms.get()).toEqual({ 'Living Room': ['Ceiling'], Bedroom: ['Lamp'] });

    rooms.assignDevice('Lamp', null);
    expect(rooms.getRoomForDevice('Lamp')).toBeNull();
  });
});
