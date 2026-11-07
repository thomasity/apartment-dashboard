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

  it('set() writes only to config.json, never the example', () => {
    config.set('active_voice', 'Gary');
    expect(readConfig()).toEqual({ active_voice: 'Gary' });
    expect(example.active_voice).not.toBe('Gary');
  });
});

describe('config safety', () => {
  const path = () => process.env.CONFIG_PATH!;

  it('never overwrites a file it could not parse', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    fs.writeFileSync(path(), '{"rooms": {"Den": ["La');
    config.set('active_voice', 'Gary');
    expect(fs.readFileSync(path(), 'utf8')).toBe('{"rooms": {"Den": ["La');
  });

  it('falls back to defaults when the file is unreadable', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    fs.writeFileSync(path(), 'not json');
    expect(config.get('active_voice')).toBe(example.active_voice);
  });

  it('writes through a temp file, leaving nothing behind', () => {
    config.set('active_voice', 'Gary');
    expect(readConfig()).toEqual({ active_voice: 'Gary' });
    expect(fs.existsSync(`${path()}.tmp`)).toBe(false);
  });
});
