import fs from 'fs';
import path from 'path';
import { errorMessage } from './util';
import { SERVER_DIR } from './paths';
import type { ConfigSchema } from './types';

// Runtime data lives in server/data/, split by what it is and what it's about:
//
//   settings/  what you chose — rooms, rules, voices, memories…  (back these up)
//   state/     the server's own bookkeeping — sessions, last-fired dates…
//   logs/      history, one JSON-lines file per category
//   backups/   copies taken before migrations
//
// Callers don't need to know any of that: get('rules') / set('rules', …) find the right
// file through STORE_OF. DATA_DIR lets tests and mock mode use a throwaway folder.

export type StoreFile = 'settings/lighting' | 'settings/assistant' | 'settings/tv' | 'state/lighting';

/** Which file each key lives in. Every key must be listed — TypeScript enforces it. */
const STORE_OF: { [K in keyof ConfigSchema]: StoreFile } = {
  lightingSchema: 'settings/lighting',
  rooms:          'settings/lighting',
  autoZones:      'settings/lighting',
  rules:          'settings/lighting',
  presence:       'settings/lighting',
  zones:          'state/lighting',
  ruleLastFired:  'state/lighting',
  suggestions:    'state/lighting',
  active_voice:   'settings/assistant',
  voices:         'settings/assistant',
  memories:       'settings/assistant',
  routines:       'settings/assistant',
  rokuIp:         'settings/tv',
  rokuName:       'settings/tv',
  rokuMac:        'settings/tv',
};

// Keys from before lighting ids (schema 2). Only the lighting id migration reads them,
// and it deletes them — but they have to survive the storage split to get there.
const LEGACY_STORE_OF: Record<string, StoreFile> = {
  circadianGroups:   'settings/lighting',
  bulbDesiredStates: 'settings/lighting',
};

export const STORES = [...new Set(Object.values(STORE_OF))];

export function dataDir(): string {
  return process.env.DATA_DIR || path.join(SERVER_DIR, 'data');
}

export function storePath(store: StoreFile): string {
  return path.join(dataDir(), `${store}.json`);
}

/** A category's history log, e.g. logPath('lighting') → data/logs/lighting.jsonl */
export function logPath(category: string): string {
  return path.join(dataDir(), 'logs', `${category}.jsonl`);
}

export function storeOf(key: string): StoreFile | null {
  return (STORE_OF as Record<string, StoreFile>)[key] ?? LEGACY_STORE_OF[key] ?? null;
}

// A missing file is a fresh install. Anything else (bad JSON, permissions) throws, so set()
// can't mistake a damaged file for an empty one and overwrite everything in it.
function read(store: StoreFile): Record<string, unknown> {
  let raw: string;
  try { raw = fs.readFileSync(storePath(store), 'utf8'); }
  catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw err;
  }
  return JSON.parse(raw);
}

// Write a sibling file then rename over the original: a crash mid-write leaves the old
// file intact instead of a truncated one.
function write(store: StoreFile, data: Record<string, unknown>): void {
  const file = storePath(store);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(data, null, 2));
  fs.renameSync(`${file}.tmp`, file);
}

// The committed config.example.json supplies defaults for anything the data files don't
// have yet — notably the hand-edited voice list, so that keeps coming from git.
let defaults: Partial<ConfigSchema> | null = null;
function readDefaults(): Partial<ConfigSchema> {
  if (!defaults) {
    try { defaults = JSON.parse(fs.readFileSync(path.join(SERVER_DIR, 'config.example.json'), 'utf8')); }
    catch { defaults = {}; }
  }
  return defaults!;
}

export function get<K extends keyof ConfigSchema>(key: K): ConfigSchema[K] | null {
  const store = STORE_OF[key];
  let data: Record<string, unknown>;
  try { data = read(store); }
  catch (err) {
    console.error(`[config] ${storePath(store)} is unreadable — using defaults:`, errorMessage(err));
    data = {};
  }
  const value = (data[key] as ConfigSchema[K] | undefined) ?? readDefaults()[key];
  // Copy defaults: callers mutate what they get, and the cached object must not change
  // underneath the next caller.
  return value === undefined ? null : structuredClone(value);
}

export function set<K extends keyof ConfigSchema>(key: K, value: ConfigSchema[K]): void {
  const store = STORE_OF[key];
  let data: Record<string, unknown>;
  try { data = read(store); }
  catch (err) {
    // Writing now would replace every other key in that file with nothing. Leave it for a human.
    console.error(`[config] refusing to save "${key}" — ${storePath(store)} is unreadable:`, errorMessage(err));
    return;
  }
  data[key] = value;
  write(store, data);
}

/** Every stored key across all files, for migrations that rewrite several at once. */
export function readAll(): Record<string, unknown> {
  return Object.assign({}, ...STORES.map(read));
}

/**
 * Replaces all stored data: each key goes to its file, and a file with no keys is left
 * empty. Keys that belong to no file are returned (and not written), so a caller can
 * report them.
 */
export function writeAll(data: Record<string, unknown>): string[] {
  const byStore = new Map<StoreFile, Record<string, unknown>>(STORES.map((s) => [s, {}]));
  const unknown: string[] = [];
  for (const [key, value] of Object.entries(data)) {
    const store = storeOf(key);
    if (store) byStore.get(store)![key] = value;
    else unknown.push(key);
  }
  for (const [store, values] of byStore) write(store, values);
  return unknown;
}

/** Copies the settings and state files into data/backups/<label>-<time>/; returns that folder. */
export function backup(label: string): string | null {
  const existing = STORES.filter((s) => fs.existsSync(storePath(s)));
  if (existing.length === 0) return null;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dest  = path.join(dataDir(), 'backups', `${label}-${stamp}`);
  for (const store of existing) {
    const to = path.join(dest, `${store}.json`);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(storePath(store), to);
  }
  return dest;
}
