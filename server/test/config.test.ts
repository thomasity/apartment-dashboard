import { beforeEach, describe, expect, it } from 'vitest';
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
    config.get('bulbDesiredStates')!.Lamp = { power: true };
    expect(config.get('bulbDesiredStates')).toEqual({});
  });

  it('set() writes only to config.json, never the example', () => {
    config.set('active_voice', 'Gary');
    expect(readConfig()).toEqual({ active_voice: 'Gary' });
    expect(example.active_voice).not.toBe('Gary');
  });
});
