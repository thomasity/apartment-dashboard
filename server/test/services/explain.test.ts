import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bulb, id, motionSensor } from '../helpers/fakeMqtt';
import { lightingStack } from '../helpers/lighting';
import type { ConfigSchema, Rule } from '../../types';

const NOON = new Date(2026, 5, 21, 13, 0); // a Sunday
const LAMP = id('Lamp'), CEILING = id('Ceiling'), HALL_MOTION = id('Hall Motion');

const night = (extra: Partial<Rule> = {}): Rule => ({
  id: 'night', name: 'Night', time: '12:00', end: '14:00', days: [0], enabled: true,
  action: { type: 'power', group: 'living', on: false }, ...extra,
});

async function setup(config: Partial<ConfigSchema> = {}) {
  const stack = await lightingStack([bulb('Lamp'), bulb('Ceiling'), motionSensor('Hall Motion')], {
    rooms: { living: { name: 'Living Room', devices: [LAMP, CEILING] } },
    autoZones: ['living'],
    ...config,
  });
  const { explain } = await import('../../services/explain');
  return { ...stack, explain: (zone = 'living') => explain(zone) };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOON);
});
afterEach(() => vi.useRealTimers());

describe('explain', () => {
  it('Auto', async () => {
    const { explain } = await setup();
    expect(explain()).toMatchObject({
      name: 'Living Room', on: true, control: 'auto', blocked: [],
      reasons: ['On Auto — 100% cool right now, shifting through the day.'],
    });
  });

  it('a manual session, and the rule it is holding back', async () => {
    const { controller, explain } = await setup({ rules: [night({ action: { type: 'reconfigure', group: 'living', config: 'scene', brightness: 20, colorTemp: 0 } })] });
    controller.manualSet([LAMP, CEILING], { brightness: 40 }, 'voice');
    const e = explain();
    expect(e.reasons).toEqual(['You adjusted it by voice at 1:00 PM; it stays that way until it\'s turned off.']);
    expect(e.history.map((h) => h.text)).toEqual(['You (voice) set it to 40% cool']);

    controller.ruleStart(night({ action: { type: 'reconfigure', group: 'living', config: 'scene', brightness: 20, colorTemp: 0 } }));
    expect(explain().history.at(-1)!.text).toBe('"Night" left it alone — it was being adjusted by hand');
  });

  it('why motion isn\'t switching it on: the cooldown after a manual off', async () => {
    const { controller, presence, client, explain } = await setup();
    presence.create({ sensor: HALL_MOTION, room: 'living', manualOffCooldownMinutes: 30 });
    controller.manualPower([LAMP, CEILING], false);
    presence.recordManualPower('living', false);
    client.deliver('zigbee2mqtt/Hall Motion', { occupancy: true });
    client.deliver('zigbee2mqtt/Hall Motion', { occupancy: false });
    client.deliver('zigbee2mqtt/Hall Motion', { occupancy: true });

    const e = explain();
    expect(e.on).toBe(false);
    expect(e.reasons[0]).toBe('Off since 1:00 PM — you turned it off.');
    expect(e.blocked).toEqual(['Motion won\'t turn it on until 1:30 PM — it was switched off by hand at 1:00 PM.']);
    // Logged once per cooldown, not on every movement
    expect(e.history.filter((h) => h.text.startsWith('Motion didn\'t'))).toHaveLength(1);
  });

  it('a rule window that ignores motion', async () => {
    const { presence, explain } = await setup({ rules: [night({ presence: { mode: 'ignore' } })], ruleLastFired: { night: '2026-06-21' } });
    presence.create({ sensor: HALL_MOTION, room: 'living' });
    expect(explain().blocked).toEqual(['"Night" ignores motion until 2:00 PM.']);
    expect(explain().reasons).toContain('"Night" is in effect until 2:00 PM.');
  });

  it('wall switch power loss and bulbs that can\'t be reached', async () => {
    const { client, explain } = await setup();
    client.deliver('zigbee2mqtt/Lamp/availability', 'online');
    client.deliver('zigbee2mqtt/Ceiling/availability', 'online');
    client.deliver('zigbee2mqtt/Lamp/availability', 'offline');
    client.deliver('zigbee2mqtt/Ceiling/availability', 'offline');

    const e = explain();
    expect(e.blocked).toEqual(['Lamp, Ceiling can\'t be reached — switched off at the wall?']);
    // Both bulbs on one switch are one event
    expect(e.history.map((h) => h.text)).toEqual(['Lost power — switched off at the wall?']);
  });

  it('a rule turning lights on and off is credited to the rule', async () => {
    const { controller, explain } = await setup();
    controller.ruleStart(night({ end: undefined }));
    expect(explain().reasons[0]).toBe('Off since 1:00 PM — "Night" turned it off.');
  });
});
