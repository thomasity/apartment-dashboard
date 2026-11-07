import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bulb, id, motionSensor } from '../helpers/fakeMqtt';
import { readConfig } from '../helpers/config';
import { lightingStack } from '../helpers/lighting';
import type { ConfigSchema, Rule } from '../../types';

const MIN = 60 * 1000;
const NOON = new Date(2026, 5, 21, 13, 0);
const LAMP = id('Lamp'), CEILING = id('Ceiling'), HALL_MOTION = id('Hall Motion');

async function setup(config: Partial<ConfigSchema> = {}) {
  const stack = await lightingStack(
    [bulb('Lamp'), bulb('Ceiling'), bulb('Bedside'), motionSensor('Hall Motion')],
    {
      rooms: {
        hall:    { name: 'Hall',    devices: [LAMP, CEILING] },
        bedroom: { name: 'Bedroom', devices: [id('Bedside')] },
      },
      ...config,
    },
  );
  stack.presence.create({ sensor: HALL_MOTION, room: 'hall', vacantAfterMinutes: 5, manualOffCooldownMinutes: 30 });
  const motion = (occupancy: boolean) => stack.client.deliver('zigbee2mqtt/Hall Motion', { occupancy });
  const darken = () => { stack.controller.manualPower([LAMP, CEILING], false); stack.client.reset(); };
  return { ...stack, motion, darken };
}

/** A window covering 13:00 that's already fired, with the given presence setting. */
function windowRule(presence: Rule['presence']): Partial<ConfigSchema> {
  return {
    rules: [{
      id: 'night', name: 'Night', time: '12:00', end: '14:00', days: [0], enabled: true,
      action: { type: 'power', group: 'all', on: false }, presence,
    }],
    ruleLastFired: { night: '2026-06-21' },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOON);
});
afterEach(() => vi.useRealTimers());

describe('presence automation', () => {
  it('turns a dark room on when motion is detected', async () => {
    const { client, motion, darken } = await setup();
    darken();
    motion(true);
    expect(client.lastSet('Lamp')).toMatchObject({ state: 'ON' });
    expect(client.lastSet('Ceiling')).toMatchObject({ state: 'ON' });
    expect(client.setsFor('Bedside')).toEqual([]); // other rooms untouched
  });

  it('turns the room off after it has been vacant long enough', async () => {
    const { presence, client, motion } = await setup();
    motion(false);
    expect(presence.getState()[0]?.vacancyTimerActive).toBe(true);

    vi.advanceTimersByTime(5 * MIN - 1);
    expect(client.setsFor('Lamp')).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(client.lastSet('Lamp')).toEqual({ state: 'OFF' });
    expect(presence.getState()[0]?.vacancyTimerActive).toBe(false);
  });

  it('motion during the vacancy countdown cancels it', async () => {
    const { client, motion } = await setup();
    motion(false);
    vi.advanceTimersByTime(4 * MIN);
    motion(true);
    client.reset();

    vi.advanceTimersByTime(10 * MIN);
    expect(client.setsFor('Lamp')).toEqual([]);
  });

  it('respects a manual "off" for the cooldown period', async () => {
    const { presence, client, motion, darken } = await setup();
    darken();
    presence.recordManualPower('hall', false);

    motion(true);
    expect(client.published).toEqual([]);

    vi.advanceTimersByTime(30 * MIN);
    motion(false);
    motion(true);
    expect(client.lastSet('Lamp')).toMatchObject({ state: 'ON' });
  });

  it('a manual "on" clears the cooldown early', async () => {
    const { presence, client, motion, darken } = await setup();
    darken();
    presence.recordManualPower('hall', false);
    presence.recordManualPower('hall', true);
    motion(true);
    expect(client.lastSet('Lamp')).toMatchObject({ state: 'ON' });
  });

  it('ignores repeated occupied reports', async () => {
    const { controller, client, motion, darken } = await setup();
    darken();
    motion(true);
    controller.manualPower([LAMP, CEILING], false); // switched off by hand while still in the room
    client.reset();

    motion(true);
    expect(client.published).toEqual([]);
  });

  it('leaves a room alone when any of its lights are already on', async () => {
    const { controller, client, motion } = await setup();
    controller.manualPower([CEILING], false);
    client.reset();
    motion(true);
    expect(client.published).toEqual([]);
  });

  it('repeated vacant reports do not restart the countdown', async () => {
    const { client, motion } = await setup();
    motion(false);
    vi.advanceTimersByTime(4 * MIN);
    motion(false);
    vi.advanceTimersByTime(1 * MIN);
    expect(client.lastSet('Lamp')).toEqual({ state: 'OFF' });
  });

  it('a disabled sensor does nothing', async () => {
    const { presence, client, motion } = await setup();
    presence.update(HALL_MOTION, { enabled: false });
    motion(true);
    motion(false);
    vi.advanceTimersByTime(60 * MIN);
    expect(client.published).toEqual([]);
  });

  it('removing a sensor cancels its pending vacancy timer', async () => {
    const { presence, client, motion } = await setup();
    motion(false);
    presence.remove(HALL_MOTION);
    vi.advanceTimersByTime(60 * MIN);
    expect(client.published).toEqual([]);
  });
});

describe('presence inside a rule window', () => {
  it('"ignore" means neither on nor off', async () => {
    const { client, motion, darken } = await setup(windowRule({ mode: 'ignore' }));
    darken();
    motion(true);
    motion(false);
    vi.advanceTimersByTime(60 * MIN);
    expect(client.published).toEqual([]);
  });

  it('"custom" comes on with the rule\'s night-light look and goes off on its own delay', async () => {
    const { controller, client, motion, darken } = await setup(
      windowRule({ mode: 'custom', brightness: 10, colorTemp: 0, vacantAfterMinutes: 2 }),
    );
    darken();
    motion(true);
    expect(client.lastSet('Lamp')).toEqual({ state: 'ON', brightness: 25, color_temp: 454 });
    expect(controller.getZonesState().hall?.control).toBe('presence');

    motion(false);
    vi.advanceTimersByTime(2 * MIN);
    expect(client.lastSet('Lamp')).toEqual({ state: 'OFF' });
    expect(readConfig().zones).toEqual({}); // the night-light look ends with the room going dark
  });

  it('"normal" behaves as if there were no rule', async () => {
    const { client, motion, darken } = await setup(windowRule({ mode: 'normal' }));
    darken();
    motion(true);
    expect(client.lastSet('Lamp')).toMatchObject({ state: 'ON' });
  });

  it('a manual change beats the custom look until the room goes off', async () => {
    const { controller, client, motion, darken } = await setup(windowRule({ mode: 'custom', brightness: 10, colorTemp: 0 }));
    darken();
    motion(true);
    controller.manualSet([LAMP], { brightness: 100 });
    expect(controller.getZonesState().hall?.control).toBe('manual');
    expect(client.lastSet('Lamp')).toEqual({ state: 'ON', brightness: 254 });
  });
});

describe('presence config', () => {
  it('create() fills in defaults and persists', async () => {
    const { presence } = await setup();
    const entry = presence.create({ sensor: '0xbed', room: 'bedroom' });
    expect(entry).toMatchObject({ vacantAfterMinutes: 5, manualOffCooldownMinutes: 120, enabled: true });
    expect(readConfig().presence?.['0xbed']).toMatchObject({ room: 'bedroom' });
  });

  it('validates input', async () => {
    const { presence } = await setup();
    expect(() => presence.create({ sensor: '', room: 'hall' })).toThrow(expect.objectContaining({ code: 'INVALID' }));
    expect(() => presence.update('0xghost', {})).toThrow(expect.objectContaining({ code: 'NOT_FOUND' }));
  });

  it('getState() includes live occupancy from the sensor', async () => {
    const { presence, motion } = await setup();
    motion(true);
    expect(presence.getState()).toEqual([expect.objectContaining({ sensor: HALL_MOTION, occupancy: true })]);
  });
});
