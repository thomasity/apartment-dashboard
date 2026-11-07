import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readConfig, writeConfig } from '../helpers/config';
import type { Rule } from '../../types';

// TZ is pinned to America/Chicago in vitest.config.mts
const MONDAY_0659 = new Date(2026, 9, 26, 6, 59, 55);
const WEEKDAYS = [1, 2, 3, 4, 5];
const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];
const MIN = 60_000;

async function setup() {
  vi.resetModules();
  const rules = await import('../../services/rules');
  const fired = vi.fn<(rule: Rule) => void>();
  const windowsChanged = vi.fn();
  rules.init(fired, windowsChanged);
  return { rules, fired, windowsChanged };
}

/** A rule already in config.json, as if created before the server (re)started. */
function stored(rule: Partial<Rule>): Rule {
  return {
    id: 'r1', name: 'Test', time: '07:00', days: WEEKDAYS, enabled: true,
    action: { type: 'power', group: 'all', on: true }, ...rule,
  };
}

const wakeUp = { name: 'Wake up', time: '07:00', days: WEEKDAYS, action: { type: 'power' as const, group: 'all', on: true } };

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(MONDAY_0659);
  writeConfig();
});
afterEach(() => vi.useRealTimers());

describe('instant rules', () => {
  it('sanity: the fixture date is a Monday', () => {
    expect(MONDAY_0659.getDay()).toBe(1);
  });

  it('fire once when their time arrives', async () => {
    const { rules, fired } = await setup();
    rules.create(wakeUp);

    vi.advanceTimersByTime(10_000); // tick lands at 07:00:05
    expect(fired).toHaveBeenCalledTimes(1);
    expect(fired.mock.calls[0]?.[0]).toMatchObject({ name: 'Wake up' });

    vi.advanceTimersByTime(10 * MIN);
    expect(fired).toHaveBeenCalledTimes(1);
  });

  it('skip days not in the rule, and disabled rules', async () => {
    const { rules, fired } = await setup();
    rules.create({ ...wakeUp, days: [0] });
    rules.create({ ...wakeUp, enabled: false });
    vi.advanceTimersByTime(10 * MIN);
    expect(fired).not.toHaveBeenCalled();
  });

  it('fire again the next day', async () => {
    const { rules, fired } = await setup();
    rules.create(wakeUp);
    vi.advanceTimersByTime(24 * 60 * MIN + 10_000);
    expect(fired).toHaveBeenCalledTimes(2);
  }, 20_000); // a day of 10s ticks — slow when the whole suite runs in parallel

  it('resolve "sunset" to that day\'s sunset', async () => {
    const { rules, fired } = await setup();
    const rule = rules.create({ ...wakeUp, time: 'sunset' });
    const sunset = rules.latestStart(rule, new Date(2026, 9, 26, 23, 0))!;
    expect(sunset.getHours()).toBeGreaterThanOrEqual(17);
    expect(sunset.getHours()).toBeLessThanOrEqual(19);

    vi.setSystemTime(new Date(sunset.getTime() - 5_000));
    vi.advanceTimersByTime(10_000);
    expect(fired).toHaveBeenCalledTimes(1);
  });

  it('a missed start fires late within 30 minutes (server was down at 07:00)', async () => {
    writeConfig({ rules: [stored({})] });
    vi.setSystemTime(new Date(2026, 9, 26, 7, 25));
    const { fired } = await setup();
    expect(fired).toHaveBeenCalledTimes(1);
  });

  it('a start missed by more than 30 minutes is skipped', async () => {
    writeConfig({ rules: [stored({})] });
    vi.setSystemTime(new Date(2026, 9, 26, 7, 31));
    const { fired } = await setup();
    vi.advanceTimersByTime(MIN);
    expect(fired).not.toHaveBeenCalled();
  });

  it('a restart in the same minute does not fire it twice', async () => {
    writeConfig({ rules: [stored({})] });
    vi.setSystemTime(new Date(2026, 9, 26, 7, 0, 5));
    expect((await setup()).fired).toHaveBeenCalledTimes(1);
    expect(readConfig().ruleLastFired).toEqual({ r1: '2026-10-26' });

    vi.setSystemTime(new Date(2026, 9, 26, 7, 0, 40));
    expect((await setup()).fired).not.toHaveBeenCalled();
  });

  it('a new rule only counts from its next start, not retroactively', async () => {
    vi.setSystemTime(new Date(2026, 9, 26, 7, 10));
    const { rules, fired } = await setup();
    rules.create(wakeUp);
    vi.advanceTimersByTime(MIN);
    expect(fired).not.toHaveBeenCalled();
  });

  it('a throwing executor does not stop the scheduler', async () => {
    const { rules, fired } = await setup();
    fired.mockImplementation(() => { throw new Error('boom'); });
    rules.create(wakeUp);
    rules.create({ ...wakeUp, name: 'Second' });
    vi.advanceTimersByTime(10_000);
    expect(fired).toHaveBeenCalledTimes(2);
  });
});

describe('windowed rules', () => {
  const bedtime = (extra: Partial<Rule> = {}) => stored({ name: 'Bedtime', time: '23:00', end: '07:00', days: EVERY_DAY, ...extra });

  it('span midnight when the end is earlier than the start', async () => {
    const { rules } = await setup();
    const start = new Date(2026, 9, 26, 23, 0);
    expect(rules.endFor(bedtime(), start)).toEqual(new Date(2026, 9, 27, 7, 0));
  });

  it('are in effect from their start until their end, and say so when that changes', async () => {
    writeConfig({ rules: [bedtime()], ruleLastFired: { r1: '2026-10-25' } });
    vi.setSystemTime(new Date(2026, 9, 26, 22, 59, 55));
    const { rules, fired, windowsChanged } = await setup();
    expect(rules.activeWindows()).toEqual([]);

    vi.advanceTimersByTime(10_000);
    expect(fired).toHaveBeenCalledTimes(1);
    expect(rules.activeWindows().map((w) => w.rule.name)).toEqual(['Bedtime']);
    expect(windowsChanged).toHaveBeenCalledTimes(1);

    vi.setSystemTime(new Date(2026, 9, 27, 6, 59, 55));
    vi.advanceTimersByTime(10_000);
    expect(rules.activeWindows()).toEqual([]);
    expect(windowsChanged).toHaveBeenCalledTimes(2);
  });

  it('a start missed while the server was down still fires as long as the window is open', async () => {
    writeConfig({ rules: [bedtime()] });
    vi.setSystemTime(new Date(2026, 9, 27, 3, 0));
    const { rules, fired } = await setup();
    expect(fired).toHaveBeenCalledTimes(1);
    expect(rules.activeWindows()).toHaveLength(1);
  });

  it('after a restart mid-window it is still in effect, without firing again', async () => {
    writeConfig({ rules: [bedtime()], ruleLastFired: { r1: '2026-10-26' } });
    vi.setSystemTime(new Date(2026, 9, 27, 3, 0));
    const { rules, fired } = await setup();
    expect(fired).not.toHaveBeenCalled();
    expect(rules.activeWindows()).toHaveLength(1);
  });

  it('creating one mid-window waits for its next start', async () => {
    vi.setSystemTime(new Date(2026, 9, 27, 1, 0));
    const { rules, fired } = await setup();
    rules.create({ ...bedtime(), name: 'Bedtime' });
    vi.advanceTimersByTime(MIN);
    expect(fired).not.toHaveBeenCalled();
    expect(rules.activeWindows()).toEqual([]);
  });
});

describe('daylight saving', () => {
  it('spring forward: a time inside the skipped hour fires at 3:00', async () => {
    // 2026-03-08: clocks jump from 2:00 to 3:00
    writeConfig({ rules: [stored({ time: '02:30', days: [0] })], ruleLastFired: { r1: '2026-03-01' } });
    vi.setSystemTime(new Date(2026, 2, 8, 1, 59, 55));
    const { fired } = await setup();
    expect(fired).not.toHaveBeenCalled();

    vi.advanceTimersByTime(10_000); // 01:59:55 CST + 10s = 03:00:05 CDT
    expect(new Date().getHours()).toBe(3);
    expect(fired).toHaveBeenCalledTimes(1);
  });

  it('fall back: a time inside the repeated hour fires on the first pass only', async () => {
    // 2026-11-01: 1:00–1:59 happens twice
    writeConfig({ rules: [stored({ time: '01:30', days: [0] })], ruleLastFired: { r1: '2026-10-25' } });
    vi.setSystemTime(new Date(2026, 10, 1, 1, 29, 55));
    const { fired } = await setup();

    vi.advanceTimersByTime(10_000);
    expect(fired).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(90 * MIN); // through the second 1:30
    expect(fired).toHaveBeenCalledTimes(1);
  });
});

describe('rule CRUD', () => {
  it('create / update / remove round-trip through config', async () => {
    const { rules } = await setup();
    const rule = rules.create({ ...wakeUp, end: '09:00', presence: { mode: 'ignore' }, overrideManual: true });
    expect(readConfig().rules).toEqual([rule]);

    rules.update(rule.id, { enabled: false, end: undefined });
    expect(readConfig().rules?.[0]).toMatchObject({ enabled: false });
    expect(readConfig().rules?.[0]?.end).toBeUndefined();

    rules.remove(rule.id);
    expect(readConfig().rules).toEqual([]);
    expect(readConfig().ruleLastFired).toEqual({});
  });

  it('validates input', async () => {
    const { rules } = await setup();
    expect(() => rules.create({ ...wakeUp, name: ' ' })).toThrow(expect.objectContaining({ code: 'INVALID' }));
    expect(() => rules.create({ ...wakeUp, time: '7am' })).toThrow(expect.objectContaining({ code: 'INVALID' }));
    expect(() => rules.create({ ...wakeUp, end: '25:00' })).toThrow(expect.objectContaining({ code: 'INVALID' }));
    expect(() => rules.create({ ...wakeUp, days: [] })).toThrow(expect.objectContaining({ code: 'INVALID' }));
    expect(() => rules.update('missing', { enabled: false })).toThrow(expect.objectContaining({ code: 'NOT_FOUND' }));
  });

  it('debugInfo explains each rule\'s last start and whether it is in effect', async () => {
    const { rules } = await setup();
    rules.create(wakeUp);
    vi.advanceTimersByTime(10_000);
    const info = rules.debugInfo();
    expect(info.serverDay).toBe(1);
    expect(info.timezone).toBe('America/Chicago');
    expect(info.rules[0]).toMatchObject({ name: 'Wake up', end: null, lastFired: '2026-10-26', active: false });
  });
});
