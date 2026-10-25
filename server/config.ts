import fs from 'fs';
import path from 'path';
import type { ConfigSchema } from './types';

// CONFIG_PATH lets tests point at a throwaway file instead of the real config.json.
function configPath(): string {
  return process.env.CONFIG_PATH || path.join(__dirname, 'config.json');
}

function read(): Partial<ConfigSchema> {
  try { return JSON.parse(fs.readFileSync(configPath(), 'utf8')); }
  catch { return {}; }
}

// config.json is untracked runtime state (rules, rooms, bulb states, memories…). The
// committed config.example.json supplies defaults for anything it doesn't have yet —
// notably the hand-edited voice list, so that keeps coming from git.
let defaults: Partial<ConfigSchema> | null = null;
function readDefaults(): Partial<ConfigSchema> {
  if (!defaults) {
    try { defaults = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.example.json'), 'utf8')); }
    catch { defaults = {}; }
  }
  return defaults!;
}

export function get<K extends keyof ConfigSchema>(key: K): ConfigSchema[K] | null {
  const value = read()[key] ?? readDefaults()[key];
  // Copy defaults: callers mutate what they get (e.g. bulbDesiredStates), and the cached
  // object must not change underneath the next caller.
  return value === undefined ? null : structuredClone(value);
}

export function set<K extends keyof ConfigSchema>(key: K, value: ConfigSchema[K]): void {
  const data = read();
  data[key] = value;
  fs.writeFileSync(configPath(), JSON.stringify(data, null, 2));
}
