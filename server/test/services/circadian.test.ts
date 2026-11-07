import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Summer solstice in St. Louis (LAT/LON pinned in vitest.config.mts)
const NOON     = new Date(2026, 5, 21, 13, 0);
const MIDNIGHT = new Date(2026, 5, 21, 0, 0);

async function load() {
  vi.resetModules();
  return import('../../services/circadian');
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOON);
});
afterEach(() => vi.useRealTimers());

describe('circadian curve', () => {
  it('is dim and warm at night, bright and cool at midday', async () => {
    const circadian = await load();
    const timeline = circadian.getTimeline();

    expect(timeline).toHaveLength(24);
    expect(timeline[0]).toEqual({ hour: 0, brightness: 20, colorTemp: 5 });
    expect(timeline[13]).toEqual({ hour: 13, brightness: 100, colorTemp: 80 });

    const morning = timeline[7]!;
    expect(morning.brightness).toBeGreaterThan(20);
    expect(morning.brightness).toBeLessThan(100);
  });

  it('stays within the 0–100 range all day', async () => {
    const circadian = await load();
    for (const p of circadian.getTimeline()) {
      expect(p.brightness).toBeGreaterThanOrEqual(0);
      expect(p.brightness).toBeLessThanOrEqual(100);
      expect(p.colorTemp).toBeGreaterThanOrEqual(0);
      expect(p.colorTemp).toBeLessThanOrEqual(100);
    }
  });
});

describe('ticking', () => {
  it('computes right away, then every 15 minutes, reporting when the next change is', async () => {
    vi.setSystemTime(MIDNIGHT);
    const circadian = await load();
    const onTick = vi.fn();
    circadian.start(onTick);

    expect(onTick).toHaveBeenCalledWith({ brightness: 20, colorTemp: 5 });
    expect(circadian.getState().nextChange).toBe(new Date(MIDNIGHT.getTime() + 15 * 60 * 1000).toISOString());

    vi.advanceTimersByTime(15 * 60 * 1000);
    expect(onTick).toHaveBeenCalledTimes(2);
    circadian.stop();
    vi.advanceTimersByTime(60 * 60 * 1000);
    expect(onTick).toHaveBeenCalledTimes(2);
  });

  it('currentValues follows the last tick', async () => {
    const circadian = await load();
    circadian.start(() => {});
    expect(circadian.currentValues()).toEqual({ brightness: 100, colorTemp: 80 });
    circadian.stop();
  });
});
