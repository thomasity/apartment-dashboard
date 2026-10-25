import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { writeConfig } from '../helpers/config';
import type { Rule } from '../../types';

// A Monday, just before 7am local time (TZ pinned in vitest.config.mts)
const MONDAY_0659 = new Date(2026, 9, 26, 6, 59, 55);
const WEEKDAYS = [1, 2, 3, 4, 5];

async function setup() {
  vi.resetModules();
  const rules = await import('../../services/rules');
  const fired = vi.fn<(rule: Rule) => void>();
  rules.init(fired);
  return { rules, fired };
}

const wakeUp = { name: 'Wake up', time: '07:00', days: WEEKDAYS, action: { type: 'power' as const, group: 'all', on: true } };

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(MONDAY_0659);
  writeConfig();
});
afterEach(() => vi.useRealTimers());

describe('rule scheduler', () => {
  it('sanity: the fixture date is a Monday', () => {
    expect(MONDAY_0659.getDay()).toBe(1);
  });

  it('fires a rule once when its minute arrives', async () => {
    const { rules, fired } = await setup();
    rules.create(wakeUp);

    vi.advanceTimersByTime(10_000); // tick lands at 07:00:05
    expect(fired).toHaveBeenCalledTimes(1);
    expect(fired.mock.calls[0]?.[0]).toMatchObject({ name: 'Wake up' });

    vi.advanceTimersByTime(50_000); // more ticks within 07:00
    expect(fired).toHaveBeenCalledTimes(1);
  });

  it('skips days not in the rule', async () => {
    const { rules, fired } = await setup();
    rules.create({ ...wakeUp, days: [0, 6] });
    vi.advanceTimersByTime(10_000);
    expect(fired).not.toHaveBeenCalled();
  });

  it('skips disabled rules', async () => {
    const { rules, fired } = await setup();
    const rule = rules.create(wakeUp);
    rules.update(rule.id, { enabled: false });
    vi.advanceTimersByTime(10_000);
    expect(fired).not.toHaveBeenCalled();
  });

  it('fires again the next day', async () => {
    const { rules, fired } = await setup();
    rules.create(wakeUp);
    vi.advanceTimersByTime(10_000);
    // Jump to Tuesday; the 06:59 tick resets the "already fired this minute" guard
    // just as the ~8,600 skipped ticks would have.
    vi.setSystemTime(new Date(2026, 9, 27, 6, 59, 45));
    vi.advanceTimersByTime(20_000);
    expect(fired).toHaveBeenCalledTimes(2);
  });

  it('resolves "sunset" to today\'s sunset time', async () => {
    const { rules, fired } = await setup();
    rules.create({ ...wakeUp, name: 'Dusk', time: 'sunset' });

    const { sunset } = rules.debugInfo();
    expect(sunset).toMatch(/^1[78]:\d\d$/); // late-October St. Louis sunset is ~6pm

    const [h, m] = sunset.split(':').map(Number);
    vi.setSystemTime(new Date(2026, 9, 26, h!, m!, 0));
    vi.advanceTimersByTime(10_000);
    expect(fired).toHaveBeenCalledTimes(1);
  });

  it('a throwing executor does not stop the scheduler', async () => {
    const { rules, fired } = await setup();
    fired.mockImplementationOnce(() => { throw new Error('boom'); });
    rules.create(wakeUp);
    rules.create({ ...wakeUp, name: 'Second' });
    vi.advanceTimersByTime(10_000);
    expect(fired).toHaveBeenCalledTimes(2);
  });
});

describe('rule CRUD', () => {
  it('create / update / remove round-trip through config', async () => {
    const { rules } = await setup();
    const rule = rules.create(wakeUp);
    expect(rule).toMatchObject({ enabled: true, name: 'Wake up' });
    expect(rule.id).toBeTruthy();

    rules.update(rule.id, { time: '07:30' });
    expect(rules.getRules()[0]?.time).toBe('07:30');

    rules.remove(rule.id);
    expect(rules.getRules()).toEqual([]);
  });

  it('update on a missing rule throws NOT_FOUND', async () => {
    const { rules } = await setup();
    expect(() => rules.update('nope', {})).toThrow(expect.objectContaining({ code: 'NOT_FOUND' }));
  });

  it('debugInfo explains what will fire today', async () => {
    const { rules } = await setup();
    rules.create(wakeUp);
    rules.create({ ...wakeUp, name: 'Weekend', days: [0, 6] });
    const info = rules.debugInfo();
    expect(info).toMatchObject({ serverTime: '06:59', serverDay: 1, timezone: 'America/Chicago' });
    expect(info.rules.map((r) => r.willFireToday)).toEqual([true, false]);
  });
});
