import fs from 'fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as config from '../config';
import example from '../config.example.json';
import { readConfig, writeConfig } from './helpers/config';

beforeEach(() => writeConfig());

describe('config defaults', () => {
  it('falls back to config.example.json for keys config.json lacks', () => {
    expect(config.get('voices')).toEqual(example.voices);
    expect(config.get('active_voice')).toBe(example.active_voice);
  });

  it('prefers config.json when it has the key', () => {
    writeConfig({ active_voice: 'Bella' });
    expect(config.get('active_voice')).toBe('Bella');
  });

  it('returns null for keys neither file has', () => {
    expect(config.get('rokuIp')).toBeNull();
  });

  it('mutating a returned default does not change the next read', () => {
    config.get('rooms')!.den = { name: 'Den', devices: [] };
    expect(config.get('rooms')).toEqual({});
  });

  it('set() writes only to the data files, never the example', () => {
    config.set('active_voice', 'Gary');
    expect(readConfig()).toEqual({ active_voice: 'Gary' });
    expect(example.active_voice).not.toBe('Gary');
  });
});

describe('files by category', () => {
  it('each key lives in its category\'s file', () => {
    writeConfig({ rooms: {}, zones: {}, memories: { a: 'b' }, rokuIp: '1.2.3.4' });
    const file = (store: config.StoreFile) => JSON.parse(fs.readFileSync(config.storePath(store), 'utf8'));
    expect(file('settings/lighting')).toEqual({ rooms: {} });
    expect(file('state/lighting')).toEqual({ zones: {} });
    expect(file('settings/assistant')).toEqual({ memories: { a: 'b' } });
    expect(file('settings/tv')).toEqual({ rokuIp: '1.2.3.4' });
  });

  it('writeAll reports keys that belong to no file instead of writing them', () => {
    expect(config.writeAll({ rooms: {}, mystery: 1 })).toEqual(['mystery']);
    expect(readConfig()).toEqual({ rooms: {} });
  });

  it('backup copies every data file into its own folder', () => {
    writeConfig({ rooms: {}, memories: {} });
    const dir = config.backup('test')!;
    expect(fs.readFileSync(`${dir}/settings/lighting.json`, 'utf8')).toBe(fs.readFileSync(config.storePath('settings/lighting'), 'utf8'));
    expect(fs.existsSync(`${dir}/settings/assistant.json`)).toBe(true);
  });
});

describe('config safety', () => {
  // active_voice lives in settings/assistant
  const file = () => config.storePath('settings/assistant');

  it('never overwrites a file it could not parse', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    fs.writeFileSync(file(), '{"memories": {"a": "b');
    config.set('active_voice', 'Gary');
    expect(fs.readFileSync(file(), 'utf8')).toBe('{"memories": {"a": "b');
  });

  it('a damaged file only affects its own keys', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    fs.writeFileSync(file(), 'not json');
    expect(config.get('active_voice')).toBe(example.active_voice);
    config.set('rooms', {});
    expect(config.get('rooms')).toEqual({});
  });

  it('writes through a temp file, leaving nothing behind', () => {
    config.set('active_voice', 'Gary');
    expect(readConfig()).toEqual({ active_voice: 'Gary' });
    expect(fs.existsSync(`${file()}.tmp`)).toBe(false);
  });
});
