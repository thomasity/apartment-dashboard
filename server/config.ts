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

export function get<K extends keyof ConfigSchema>(key: K): ConfigSchema[K] | null {
  return read()[key] ?? null;
}

export function set<K extends keyof ConfigSchema>(key: K, value: ConfigSchema[K]): void {
  const data = read();
  data[key] = value;
  fs.writeFileSync(configPath(), JSON.stringify(data, null, 2));
}
