import fs from 'fs';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bulb, id } from '../helpers/fakeMqtt';
import { lightingStack } from '../helpers/lighting';
import { readConfig } from '../helpers/config';
import { detect, type DetectOptions } from '../../services/suggestions';
import type { ActivityEntry, LightValues } from '../../types';

const NOW = new Date(2026, 5, 21, 13, 0); // Sunday
const DAY = 24 * 60 * 60 * 1000;
const LAMP = id('Lamp'), CEILING = id('Ceiling');

/** `daysAgo` days before NOW's date, at hh:mm. */
const at = (daysAgo: number, hh: number, mm: number) =>
  new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate() - daysAgo, hh, mm).getTime();

const entry = (daysAgo: number, hh: number, mm: number, extra: Partial<ActivityEntry> = {}): ActivityEntry =>
  ({ at: at(daysAgo, hh, mm), zone: 'living', source: 'dashboard', action: 'off', ...extra });

/** The oldest entry, so the log reaches back far enough. */
const oldest = entry(20, 12, 0, { action: 'on', zone: 'elsewhere' });

const weekdaysAgo = Array.from({ length: 14 }, (_, i) => i + 1).filter((d) => ![0, 6].includes(new Date(at(d, 12, 0)).getDay()));

const opts = (extra: Partial<DetectOptions> = {}): DetectOptions => ({ covered: () => false, dismissed: [], ...extra });
const run = (entries: ActivityEntry[], extra?: Partial<DetectOptions>) =>
  detect([oldest, ...entries].sort((a, b) => a.at - b.at), NOW.getTime(), opts(extra));

describe('detect', () => {
  it('a near-daily habit becomes an every-day pattern at its typical time', () => {
    const days = [1, 2, 3, 4, 5, 6, 8, 9, 10, 12, 13]; // 11 of 14
    const p = run(days.map((d, i) => entry(d, 22, 25 + (i % 3) * 5)));
    expect(p).toMatchObject({ zone: 'living', kind: 'off', days: [0, 1, 2, 3, 4, 5, 6], minutes: 22 * 60 + 30, matched: 11, eligible: 14 });
  });

  it('a weekday habit is a weekday pattern', () => {
    const p = run(weekdaysAgo.slice(0, 9).map((d) => entry(d, 7, 0, { action: 'on' })));
    expect(p).toMatchObject({ kind: 'on', days: [1, 2, 3, 4, 5], daysLabel: 'weekdays', matched: 9, eligible: 10 });
  });

  it('works across midnight', () => {
    const p = run([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((d, i) => entry(d, i % 2 ? 23 : 0, i % 2 ? 55 : 5)));
    expect(p?.minutes).toBe(0);
  });

  it('stays quiet when the bar isn\'t met', () => {
    // Only 4 days
    expect(run([1, 2, 3, 4].map((d) => entry(d, 22, 30)))).toBeNull();
    // 7 of 14 days, and only 5 of 10 weekdays — repeated, but not consistent
    expect(run([1, 2, 3, 6, 7, 8, 9].map((d) => entry(d, 22, 30)))).toBeNull();
    // Times all over the place
    expect(run([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((d) => entry(d, 12 + d, 0)))).toBeNull();
  });

  it('needs 14 days of history', () => {
    const entries = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((d) => entry(d, 22, 30));
    expect(detect(entries, NOW.getTime(), opts())).toBeNull();
  });

  it('only counts whole-room changes you made', () => {
    const days = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
    expect(run(days.map((d) => entry(d, 22, 30, { bulbs: [LAMP] })))).toBeNull();
    expect(run(days.map((d) => entry(d, 22, 30, { source: 'rule' })))).toBeNull();
    expect(run(days.map((d) => entry(d, 22, 30, { source: 'presence' })))).toBeNull();
    expect(run(days.map((d) => entry(d, 22, 30, { source: 'voice' })))).not.toBeNull();
  });

  it('a look has to be about the same each day, and the suggestion uses the typical one', () => {
    const set = (d: number, brightness: number, colorTemp = 10) =>
      entry(d, 21, 0, { action: 'set', look: { brightness, colorTemp } as LightValues });
    const p = run([28, 30, 32, 30, 35, 27, 31, 30, 29, 33].map((b, i) => set(i + 1, b)));
    expect(p).toMatchObject({ kind: 'set', look: { brightness: 30, colorTemp: 10 } });

    expect(run([30, 80, 30, 80, 30, 80, 30, 80, 30, 80].map((b, i) => set(i + 1, b)))).toBeNull();
  });

  it('skips what a rule already does, and what was dismissed', () => {
    const entries = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((d) => entry(d, 22, 30));
    expect(run(entries, { covered: (zone, minutes) => zone === 'living' && minutes === 22 * 60 + 30 })).toBeNull();

    const dismissed = { zone: 'living', kind: 'off' as const, days: [1], minutes: 22 * 60, until: null };
    expect(run(entries, { dismissed: [dismissed] })).toBeNull();
    expect(run(entries, { dismissed: [{ ...dismissed, until: NOW.getTime() - 1 }] })).not.toBeNull(); // snooze over
    expect(run(entries, { dismissed: [{ ...dismissed, minutes: 19 * 60 }] })).not.toBeNull();         // a different time
  });
});

describe('suggestions service', () => {
  async function setup(entries: ActivityEntry[]) {
    const stack = await lightingStack([bulb('Lamp'), bulb('Ceiling')], {
      rooms: { living: { name: 'Living Room', devices: [LAMP, CEILING] } },
    });
    const log = path.join(path.dirname(process.env.CONFIG_PATH!), 'lighting-log.jsonl');
    fs.writeFileSync(log, [oldest, ...entries].map((e) => JSON.stringify(e) + '\n').join(''));
    const suggestions = await import('../../services/suggestions');
    return { ...stack, suggestions };
  }

  const bedtime = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((d) => entry(d, 22, 30));
  const mornings = weekdaysAgo.slice(0, 9).map((d) => entry(d, 7, 0, { action: 'on' }));

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());

  it('offers a ready-made rule as soon as it starts', async () => {
    const { suggestions, io } = await setup(bedtime);
    suggestions.init(io);
    const s = suggestions.current()!;
    expect(s).toMatchObject({
      text: 'You\'ve turned off Living Room around 10:30 PM on 11 of the last 14 days.',
      rule: { name: 'Living Room off', time: '22:30', days: [0, 1, 2, 3, 4, 5, 6], action: { type: 'power', group: 'living', on: false } },
    });
    expect(io.emit).toHaveBeenCalledWith('lighting:suggestion', s);
    expect(suggestions.check()?.id).toBe(s.id); // the same one stays on show
  });

  it('at most one new suggestion a week, even when more patterns qualify', async () => {
    const { suggestions } = await setup([...bedtime, ...mornings]);
    const first = suggestions.check()!;
    suggestions.accept(first.id);
    expect(suggestions.check()).toBeNull(); // the weekday mornings wait their turn
  });

  it('"not now" hides the pattern for 30 days, "never" for good', async () => {
    const { suggestions } = await setup(bedtime);
    const s = suggestions.check()!;
    expect(suggestions.dismiss('wrong', false)).toBe(false);
    expect(suggestions.dismiss(s.id, false)).toBe(true);
    expect(suggestions.current()).toBeNull();
    expect(readConfig().suggestions?.dismissed).toEqual([
      { zone: 'living', kind: 'off', days: [0, 1, 2, 3, 4, 5, 6], minutes: 22 * 60 + 30, until: NOW.getTime() + 30 * DAY },
    ]);
  });

  it('disappears once a rule covers it', async () => {
    const { suggestions, rules } = await setup(bedtime);
    expect(suggestions.check()).not.toBeNull();
    rules.create({ name: 'Bed', time: '22:15', days: [1], action: { type: 'power', group: 'living', on: false } });
    expect(suggestions.current()).toBeNull();
  });
});
