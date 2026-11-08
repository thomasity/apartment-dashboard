import fs from 'fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearLogs } from '../helpers/config';
import { logPath } from '../../config';

interface Ping { at: number; key: string; on: boolean }

async function load() {
  vi.resetModules();
  return import('../../services/logs');
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 5, 21, 13, 0));
  clearLogs();
});
afterEach(() => vi.useRealTimers());

describe('createLog', () => {
  it('writes each category to its own file at once when nothing is held', async () => {
    const { createLog } = await load();
    const a = createLog<Ping>({ category: 'alpha', retentionDays: 30 });
    const b = createLog<Ping>({ category: 'beta', retentionDays: 30 });
    a.record({ key: 'x', on: true });
    b.record({ key: 'y', on: false });
    expect(fs.readFileSync(logPath('alpha'), 'utf8')).toContain('"key":"x"');
    expect(fs.readFileSync(logPath('beta'), 'utf8')).toContain('"key":"y"');
  });

  it('a follow-up can cancel a held entry, so neither is kept', async () => {
    const { createLog } = await load();
    const log = createLog<Ping>({
      category: 'flicker', retentionDays: 30, holdMs: 60_000,
      keyOf: (e) => e.key, combine: (open, next) => (!open.on && next.on ? null : undefined),
    });
    log.record({ key: 'hall', on: true });
    log.record({ key: 'hall', on: false });
    vi.advanceTimersByTime(30_000);
    log.record({ key: 'hall', on: true }); // back within the hold: the "off" never happened
    vi.advanceTimersByTime(60_000);
    expect(log.list().map((e) => e.on)).toEqual([true]);
  });

  it('flushAll writes every log\'s held entries', async () => {
    const { createLog, flushAll } = await load();
    const log = createLog<Ping>({ category: 'held', retentionDays: 30, holdMs: 60_000 });
    log.record({ key: 'x', on: true });
    expect(fs.existsSync(logPath('held'))).toBe(false);
    flushAll();
    expect(fs.readFileSync(logPath('held'), 'utf8')).toContain('"key":"x"');
  });
});
