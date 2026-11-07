import fs from 'fs';
import path from 'path';
import { errorMessage } from './util';
import type { ConfigSchema } from './types';

// CONFIG_PATH lets tests point at a throwaway file instead of the real config.json.
function configPath(): string {
  return process.env.CONFIG_PATH || path.join(__dirname, 'config.json');
}

// A missing file is a fresh install. Anything else (bad JSON, permissions) throws, so set()
// can't mistake a damaged file for an empty one and overwrite everything in it.
function read(): Partial<ConfigSchema> {
  let raw: string;
  try { raw = fs.readFileSync(configPath(), 'utf8'); }
  catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw err;
  }
  return JSON.parse(raw);
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
  let data: Partial<ConfigSchema>;
  try { data = read(); }
  catch (err) {
    console.error(`[config] ${configPath()} is unreadable — using defaults:`, errorMessage(err));
    data = {};
  }
  const value = data[key] ?? readDefaults()[key];
  // Copy defaults: callers mutate what they get (e.g. bulbDesiredStates), and the cached
  // object must not change underneath the next caller.
  return value === undefined ? null : structuredClone(value);
}

export function set<K extends keyof ConfigSchema>(key: K, value: ConfigSchema[K]): void {
  let data: Partial<ConfigSchema>;
  try { data = read(); }
  catch (err) {
    // Writing now would replace every other key with nothing. Leave the file for a human.
    console.error(`[config] refusing to save "${key}" — ${configPath()} is unreadable:`, errorMessage(err));
    return;
  }
  data[key] = value;
  writeAll(data);
}

/** The whole stored file, for migrations that rewrite several keys at once. */
export function readAll(): Record<string, unknown> {
  return read() as Record<string, unknown>;
}

// Write a sibling file then rename over the original: a crash mid-write leaves the old
// config intact instead of a truncated one.
export function writeAll(data: Record<string, unknown>): void {
  const tmp = `${configPath()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, configPath());
}

/** A file that lives next to config.json (other runtime data, e.g. the lighting log). */
export function siblingPath(file: string): string {
  return path.join(path.dirname(configPath()), file);
}

/** Copies config.json next to itself with a timestamp; returns the backup's path. */
export function backup(label: string): string | null {
  if (!fs.existsSync(configPath())) return null;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dest  = configPath().replace(/\.json$/, '') + `.${label}-${stamp}.json`;
  fs.copyFileSync(configPath(), dest);
  return dest;
}
