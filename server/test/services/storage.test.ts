import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as config from '../../config';
import { readConfig } from '../helpers/config';
import { migrateStorage } from '../../services/migrate';

// The one-time move from server/config.json (+ lighting-log.jsonl beside it) into data/.
// `legacy` stands in for the server folder.

let legacy: string;
const file = (name: string) => path.join(legacy, name);
const backups = () => fs.readdirSync(path.join(process.env.DATA_DIR!, 'backups'));

const old = {
  lightingSchema: 2,
  rooms: { room_a: { name: 'Living Room', devices: ['0x1'] } },
  zones: {},
  memories: { coffee: 'black' },
  rokuIp: '192.168.1.50',
};

beforeEach(() => {
  legacy = fs.mkdtempSync(path.join(os.tmpdir(), 'dashboard-legacy-'));
  for (const store of config.STORES) fs.rmSync(config.storePath(store), { force: true });
  fs.rmSync(path.join(process.env.DATA_DIR!, 'backups'), { recursive: true, force: true });
  fs.rmSync(config.logPath('lighting'), { force: true });
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => fs.rmSync(legacy, { recursive: true, force: true }));

describe('storage split', () => {
  it('moves every key into its category file and keeps the original in backups', () => {
    fs.writeFileSync(file('config.json'), JSON.stringify(old));
    fs.writeFileSync(file('config.pre-ids-2026.json'), '{}');
    fs.writeFileSync(file('config.example.json'), '{}');

    expect(migrateStorage(legacy)).toBe(true);
    expect(readConfig()).toEqual(old);
    expect(config.get('memories')).toEqual({ coffee: 'black' });

    // config.json and older backups moved out of the server folder; the example stays
    expect(fs.readdirSync(legacy)).toEqual(['config.example.json']);
    const [backup] = backups();
    expect(fs.readdirSync(path.join(process.env.DATA_DIR!, 'backups', backup!)).sort()).toEqual(['config.json', 'config.pre-ids-2026.json']);
  });

  it('carries pre-id lighting keys through for the id migration, and names keys it drops', () => {
    const log = vi.spyOn(console, 'log');
    fs.writeFileSync(file('config.json'), JSON.stringify({ rooms: { Den: ['Lamp'] }, circadianGroups: ['Lamp'], plants: [] }));
    migrateStorage(legacy);
    expect(readConfig()).toEqual({ rooms: { Den: ['Lamp'] }, circadianGroups: ['Lamp'] });
    expect(log.mock.calls.at(-1)![0]).toMatch(/not carried over \(unknown keys\): plants$/);
  });

  it('moves the lighting log into data/logs', () => {
    fs.writeFileSync(file('config.json'), '{}');
    fs.writeFileSync(file('lighting-log.jsonl'), '{"at":1}\n');
    migrateStorage(legacy);
    expect(fs.readFileSync(config.logPath('lighting'), 'utf8')).toBe('{"at":1}\n');
  });

  it('does nothing without a config.json, or once data/ is in use', () => {
    expect(migrateStorage(legacy)).toBe(false);

    config.set('rooms', {});
    fs.writeFileSync(file('config.json'), JSON.stringify(old));
    expect(migrateStorage(legacy)).toBe(false);
    expect(fs.existsSync(file('config.json'))).toBe(true); // left for a human
    expect(config.get('memories')).toBeNull();
  });

  it('refuses to start rather than lose a config.json it can\'t read', () => {
    fs.writeFileSync(file('config.json'), '{"rooms": {');
    expect(() => migrateStorage(legacy)).toThrow(/can't read/);
    expect(fs.existsSync(file('config.json'))).toBe(true);
  });
});
