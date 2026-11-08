import fs from 'fs';
import * as config from '../../config';
import type { ConfigSchema } from '../../types';

// setup.ts points DATA_DIR at a temp folder. If it's missing, config.ts would fall back
// to the real server/data/ — refuse rather than let a test overwrite it.
function requireTestDataDir(): void {
  if (!process.env.DATA_DIR) throw new Error('DATA_DIR is not set — is test/setup.ts registered in vitest.config.mts?');
}

/** Replace all stored settings and state wholesale (each key lands in its own file). */
export function writeConfig(data: Partial<ConfigSchema> = {}): void {
  requireTestDataDir();
  config.writeAll(data);
}

/** Everything stored, merged back into one object. */
export function readConfig(): Partial<ConfigSchema> {
  requireTestDataDir();
  return config.readAll() as Partial<ConfigSchema>;
}

/** Delete the lighting activity log. */
export function clearActivityLog(): void {
  requireTestDataDir();
  fs.rmSync(config.logPath('lighting'), { force: true });
}
