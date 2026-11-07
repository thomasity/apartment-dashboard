import fs from 'fs';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bulb, coordinator, id, motionSensor } from '../helpers/fakeMqtt';
import { readConfig, writeConfig } from '../helpers/config';
import { migrateLighting } from '../../services/migrate';

const devices = [coordinator, bulb('Lamp'), bulb('Ceiling'), bulb('Desk'), motionSensor('Hall Motion')];

// The pre-ids config.json: everything by name
const legacy = {
  rooms: { 'Living Room': ['Lamp', 'Ceiling', 'Gone Bulb'], Bedroom: [] },
  circadianGroups: ['Ceiling', 'Desk'],
  bulbDesiredStates: { Lamp: { power: true } },
  presence: { 'Hall Motion': { room: 'Living Room', vacantAfterMinutes: 5, manualOffCooldownMinutes: 60, enabled: true } },
  rules: [
    { id: 'a', name: 'All off', time: '23:00', days: [0], enabled: true, action: { type: 'power', group: 'all', on: false } },
    { id: 'b', name: 'Den', time: '07:00', days: [1], enabled: true, action: { type: 'power', group: 'Living Room', on: true } },
    { id: 'c', name: 'Desk', time: '07:00', days: [1], enabled: true, action: { type: 'power', group: 'Desk', on: true } },
  ],
  active_voice: 'Jarvis',
};

const backups = () => fs.readdirSync(path.dirname(process.env.CONFIG_PATH!)).filter((f) => f.includes('pre-ids'));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 9, 26, 8, 0)); // Monday 8am — rule "b" and "c" already started today
  backups().forEach((f) => fs.rmSync(path.join(path.dirname(process.env.CONFIG_PATH!), f)));
  writeConfig(legacy as never);
});
afterEach(() => vi.useRealTimers());

describe('lighting migration', () => {
  it('waits for the bridge\'s device list before touching legacy data', () => {
    expect(migrateLighting([coordinator])).toBe(false);
    expect(readConfig()).toEqual(legacy);
  });

  it('turns names into addresses and room ids, everywhere', () => {
    expect(migrateLighting(devices)).toBe(true);
    const cfg = readConfig();

    expect(cfg.lightingSchema).toBe(2);
    const [[livingId, living], [bedroomId, bedroom]] = Object.entries(cfg.rooms!) as [[string, unknown], [string, unknown]];
    expect(living).toEqual({ name: 'Living Room', devices: [id('Lamp'), id('Ceiling')] }); // unknown bulb dropped
    expect(bedroom).toEqual({ name: 'Bedroom', devices: [] });

    // A room is on Auto if any of its bulbs was; an unassigned bulb keeps its own setting
    expect(cfg.autoZones?.sort()).toEqual([livingId, id('Desk')].sort());

    expect(cfg.presence).toEqual({
      [id('Hall Motion')]: { room: livingId, vacantAfterMinutes: 5, manualOffCooldownMinutes: 60, enabled: true },
    });
    expect(cfg.rules?.map((r) => r.action.group)).toEqual(['all', livingId, id('Desk')]);
    expect(bedroomId).toMatch(/^room_/);

    expect(cfg).not.toHaveProperty('circadianGroups');
    expect(cfg).not.toHaveProperty('bulbDesiredStates');
    expect(cfg.active_voice).toBe('Jarvis'); // unrelated keys untouched
  });

  it('marks starts that already happened as handled, so upgrading fires nothing', () => {
    migrateLighting(devices);
    expect(readConfig().ruleLastFired).toEqual({ a: 'skip:2026-10-25', b: 'skip:2026-10-26', c: 'skip:2026-10-26' });
  });

  it('backs up config.json first, and runs only once', () => {
    migrateLighting(devices);
    expect(backups()).toHaveLength(1);
    const backup = JSON.parse(fs.readFileSync(path.join(path.dirname(process.env.CONFIG_PATH!), backups()[0]!), 'utf8'));
    expect(backup).toEqual(legacy);

    expect(migrateLighting(devices)).toBe(false);
    expect(backups()).toHaveLength(1);
  });

  it('a fresh install upgrades straight away with no backup', () => {
    writeConfig({});
    expect(migrateLighting([])).toBe(true);
    expect(readConfig()).toMatchObject({ lightingSchema: 2, rooms: {}, autoZones: [] });
    expect(backups()).toHaveLength(0);
  });
});
