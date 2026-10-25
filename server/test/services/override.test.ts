import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const HOUR = 60 * 60 * 1000;

async function load() {
  vi.resetModules();
  return (await import('../../services/override')).default;
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('override service', () => {
  it('marks a group overridden for two hours, then resumes it', async () => {
    const overrides = await load();
    const resumed = vi.fn();
    overrides.on('resume', resumed);

    overrides.set('Lamp');
    expect(overrides.isOverridden('Lamp')).toBe(true);
    expect(overrides.getState().Lamp).toBe(Date.now() + 2 * HOUR);

    vi.advanceTimersByTime(2 * HOUR - 1);
    expect(resumed).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(resumed).toHaveBeenCalledWith('Lamp');
    expect(overrides.isOverridden('Lamp')).toBe(false);
  });

  it('restarts the clock when set again', async () => {
    const overrides = await load();
    const resumed = vi.fn();
    overrides.on('resume', resumed);

    overrides.set('Lamp');
    vi.advanceTimersByTime(HOUR);
    overrides.set('Lamp');
    vi.advanceTimersByTime(HOUR + 1);
    expect(resumed).not.toHaveBeenCalled();
    vi.advanceTimersByTime(HOUR);
    expect(resumed).toHaveBeenCalledTimes(1);
  });

  it('clear() cancels without firing resume', async () => {
    const overrides = await load();
    const resumed = vi.fn();
    const changed = vi.fn();
    overrides.on('resume', resumed);
    overrides.on('change', changed);

    overrides.set('Lamp', 1000);
    overrides.clear('Lamp');
    vi.advanceTimersByTime(5000);

    expect(resumed).not.toHaveBeenCalled();
    expect(changed).toHaveBeenLastCalledWith({});
  });

  it('clearing a group that is not overridden is a silent no-op', async () => {
    const overrides = await load();
    const changed = vi.fn();
    overrides.on('change', changed);
    overrides.clear('Nope');
    expect(changed).not.toHaveBeenCalled();
  });
});
