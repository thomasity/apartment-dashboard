// Mock mode for local development: `npm run dev:mock` (or MOCK=true in .env).
// Import this right after ./env — it redirects config.ts to a throwaway file seeded with
// mock rooms/rules/presence, so nothing you do in mock mode touches server/config.json.

import fs from 'fs';
import os from 'os';
import path from 'path';
import { seedConfig } from './mockData';

// PROD=false is the older spelling of the same switch.
export const MOCK = process.env.MOCK === 'true' || process.env.PROD === 'false';

if (MOCK && !process.env.CONFIG_PATH) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dashboard-mock-'));
  process.env.CONFIG_PATH = path.join(dir, 'config.json');
  fs.writeFileSync(process.env.CONFIG_PATH, JSON.stringify(seedConfig, null, 2));
  console.log(`[mock] MOCK=true — fake devices and services; config at ${process.env.CONFIG_PATH}`);
}
