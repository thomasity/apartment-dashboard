import fs from 'fs';
import path from 'path';
import type { ConfigSchema } from '../../types';

// setup.ts points CONFIG_PATH at a temp file. If it's missing, config.ts would fall back
// to the real server/config.json — refuse rather than let a test overwrite it.
function testConfigPath(): string {
  const p = process.env.CONFIG_PATH;
  if (!p) throw new Error('CONFIG_PATH is not set — is test/setup.ts registered in vitest.config.mts?');
  return p;
}

/** Replace the test config file wholesale. */
export function writeConfig(data: Partial<ConfigSchema> = {}): void {
  fs.writeFileSync(testConfigPath(), JSON.stringify(data, null, 2));
}

export function readConfig(): Partial<ConfigSchema> {
  return JSON.parse(fs.readFileSync(testConfigPath(), 'utf8'));
}

/** Delete the lighting activity log that sits next to the test config. */
export function clearActivityLog(): void {
  fs.rmSync(path.join(path.dirname(testConfigPath()), 'lighting-log.jsonl'), { force: true });
}
