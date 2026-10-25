// Runs before every test file. Two jobs:
//  1. Point config.ts at a throwaway file so tests never touch server/config.json.
//  2. Refuse real network traffic, so a missing mock fails loudly instead of quietly
//     hitting Spotify / your Roku / Open-Meteo.

import fs from 'fs';
import os from 'os';
import path from 'path';
import axios from 'axios';
import { afterAll } from 'vitest';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dashboard-test-'));
process.env.CONFIG_PATH = path.join(dir, 'config.json');
fs.writeFileSync(process.env.CONFIG_PATH, '{}');

afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

function isLocal(url: string): boolean {
  const { hostname } = new URL(url);
  return hostname === 'localhost' || hostname === '127.0.0.1';
}

axios.interceptors.request.use((cfg) => {
  const url = axios.getUri(cfg);
  if (!isLocal(url)) throw new Error(`Unmocked network request in test: ${cfg.method?.toUpperCase()} ${url}`);
  return cfg;
});

const realFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = input instanceof Request ? input.url : String(input);
  if (!isLocal(url)) return Promise.reject(new Error(`Unmocked network request in test: fetch ${url}`));
  return realFetch(input, init);
};
