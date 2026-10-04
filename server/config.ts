import fs from 'fs';
import path from 'path';
import type { ConfigSchema } from './types';

const CONFIG_PATH = path.join(__dirname, 'config.json');

function read(): Partial<ConfigSchema> {
  try { return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); }
  catch { return {}; }
}

export function get<K extends keyof ConfigSchema>(key: K): ConfigSchema[K] | null {
  return read()[key] ?? null;
}

export function set<K extends keyof ConfigSchema>(key: K, value: ConfigSchema[K]): void {
  const data = read();
  data[key] = value;
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(data, null, 2));
}
