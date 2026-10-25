import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { connectedManager } from '../helpers/fakeMqtt';
import { readConfig, writeConfig } from '../helpers/config';
import type { AppServer } from '../../types';

// Summer solstice in St. Louis (LAT/LON pinned in vitest.config.mts)
const NOON     = new Date(2026, 5, 21, 13, 0);
const MIDNIGHT = new Date(2026, 5, 21, 0, 0);
const MORNING  = new Date(2026, 5, 21, 7, 30);

async function setup(overridden: (g: string) => boolean = () => false) {
  vi.resetModules();
  const circadian = await import('../../services/circadian');
  const { mgr, client } = connectedManager();
  const io = { emit: vi.fn() } as unknown as AppServer;
  circadian.init(mgr, io, overridden);
  return { circadian, mgr, client, io };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOON);
  writeConfig();
});
afterEach(() => vi.useRealTimers());

describe('circadian curve', () => {
  it('is dim and warm at night, bright and cool at midday', async () => {
    const { circadian } = await setup();
    const timeline = circadian.getTimeline();

    expect(timeline).toHaveLength(24);
    expect(timeline[0]).toEqual({ hour: 0, brightness: 20, colorTemp: 5 });
    expect(timeline[13]).toEqual({ hour: 13, brightness: 100, colorTemp: 80 });

    const morning = timeline[7]!;
    expect(morning.brightness).toBeGreaterThan(20);
    expect(morning.brightness).toBeLessThan(100);
  });

  it('stays within the 0–100 range all day', async () => {
    const { circadian } = await setup();
    for (const p of circadian.getTimeline()) {
      expect(p.brightness).toBeGreaterThanOrEqual(0);
      expect(p.brightness).toBeLessThanOrEqual(100);
      expect(p.colorTemp).toBeGreaterThanOrEqual(0);
      expect(p.colorTemp).toBeLessThanOrEqual(100);
    }
  });
});

describe('enable / disable', () => {
  it('applies current values immediately and persists the group', async () => {
    const { circadian, client } = await setup();
    circadian.enable('Lamp');

    expect(client.lastSet('Lamp')).toEqual({ state: 'ON', brightness: 254, color_temp: 213 });
    expect(readConfig().circadianGroups).toEqual(['Lamp']);
    expect(circadian.getState()).toMatchObject({ enabledGroups: ['Lamp'], brightness: 100, colorTemp: 80 });
  });

  it('"all" enables every known bulb', async () => {
    const { circadian } = await setup();
    circadian.enable('all');
    expect(circadian.getState().enabledGroups.sort()).toEqual(['Ceiling', 'Lamp']);
  });

  it('re-applies every 15 minutes as the sun moves', async () => {
    vi.setSystemTime(MORNING);
    const { circadian, client } = await setup();
    circadian.enable('Lamp');
    const first = client.lastSet('Lamp');

    vi.advanceTimersByTime(15 * 60 * 1000);
    expect(client.setsFor('Lamp')).toHaveLength(2);
    expect(client.lastSet('Lamp')).not.toEqual(first); // brighter as the sun rises
  });

  it('leaves overridden groups alone', async () => {
    const { circadian, client } = await setup((g) => g === 'Lamp');
    circadian.enable('all');
    expect(client.setsFor('Lamp')).toEqual([]);
    expect(client.setsFor('Ceiling')).toHaveLength(1);
  });

  it('stops updating once disabled', async () => {
    const { circadian, client } = await setup();
    circadian.enable('Lamp');
    circadian.disable('Lamp');
    client.reset();

    vi.advanceTimersByTime(60 * 60 * 1000);
    expect(client.published).toEqual([]);
    expect(readConfig().circadianGroups).toEqual([]);
    expect(circadian.getState().nextChange).toBeNull();
  });

  it('reports when the next change will happen', async () => {
    const { circadian } = await setup();
    circadian.enable('Lamp');
    expect(circadian.getState().nextChange).toBe(new Date(NOON.getTime() + 15 * 60 * 1000).toISOString());
  });
});

describe('startup and override expiry', () => {
  it('restores persisted groups on init and applies them right away', async () => {
    writeConfig({ circadianGroups: ['Ceiling'] });
    vi.setSystemTime(MIDNIGHT);
    const { circadian, client } = await setup();

    expect(circadian.getState().enabledGroups).toEqual(['Ceiling']);
    expect(client.lastSet('Ceiling')).toEqual({ state: 'ON', brightness: 51, color_temp: 439 });
  });

  it('applyToGroup re-applies only groups that are on circadian', async () => {
    const { circadian, client } = await setup();
    circadian.enable('Lamp');
    client.reset();

    circadian.applyToGroup('Lamp');
    circadian.applyToGroup('Ceiling');
    expect(client.setsFor('Lamp')).toHaveLength(1);
    expect(client.setsFor('Ceiling')).toEqual([]);
  });
});
