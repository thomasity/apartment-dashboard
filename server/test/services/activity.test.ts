import fs from 'fs';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearActivityLog } from '../helpers/config';
import { logPath } from '../../config';

const DAY = 24 * 60 * 60 * 1000;
const logFile = () => logPath('lighting');
const lines = () => fs.readFileSync(logFile(), 'utf8').trim().split('\n').map((l) => JSON.parse(l));

async function load() {
  vi.resetModules();
  return import('../../services/activity');
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 5, 21, 13, 0));
  clearActivityLog();
});
afterEach(() => vi.useRealTimers());

describe('activity log', () => {
  it('merges a burst of the same change into one entry that ends where you let go', async () => {
    const activity = await load();
    for (const brightness of [60, 50, 40, 30]) {
      activity.record({ zone: 'living', source: 'dashboard', action: 'set', look: { brightness, colorTemp: 20 } });
      vi.advanceTimersByTime(300);
    }
    expect(activity.list()).toMatchObject([{ action: 'set', look: { brightness: 30 } }]);

    vi.advanceTimersByTime(10_000); // closes, and is written
    expect(lines()).toMatchObject([{ zone: 'living', action: 'set', look: { brightness: 30 } }]);
  });

  it('keeps different changes, zones and sources apart', async () => {
    const activity = await load();
    const changes = [
      { zone: 'living',  source: 'dashboard', action: 'set' },
      { zone: 'bedroom', source: 'dashboard', action: 'set' },
      { zone: 'living',  source: 'voice',     action: 'set' },
      { zone: 'living',  source: 'voice',     action: 'off' },
    ] as const;
    for (const change of changes) {
      activity.record(change);
      vi.advanceTimersByTime(1000);
    }
    activity.flush();
    expect(lines()).toHaveLength(4);
    expect(activity.list().map((e) => `${e.zone}/${e.source}/${e.action}`)).toEqual([
      'living/dashboard/set', 'bedroom/dashboard/set', 'living/voice/set', 'living/voice/off',
    ]);
  });

  it('survives a restart and forgets entries older than 30 days', async () => {
    const now = Date.now();
    fs.mkdirSync(path.dirname(logFile()), { recursive: true });
    fs.writeFileSync(logFile(), [
      { at: now - 31 * DAY, zone: 'living', source: 'dashboard', action: 'off' },
      { at: now - 2 * DAY,  zone: 'living', source: 'dashboard', action: 'on' },
    ].map((e) => JSON.stringify(e)).join('\n') + '\n{"torn');

    const activity = await load();
    expect(activity.list().map((e) => e.action)).toEqual(['on']);
    expect(lines().map((e) => e.action)).toEqual(['on']);
    expect(activity.list(now - DAY)).toEqual([]);
  });
});
