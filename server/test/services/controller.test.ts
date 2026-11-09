import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bulb, id } from '../helpers/fakeMqtt';
import { readConfig } from '../helpers/config';
import { lightingStack } from '../helpers/lighting';
import type { ConfigSchema, Rule } from '../../types';

// Summer solstice, 1pm in St. Louis: Auto is at its brightest (100% / 80)
const NOON = new Date(2026, 5, 21, 13, 0);
const AUTO_NOON = { brightness: 100, colorTemp: 80 };
const AUTO_ON   = { state: 'ON', brightness: 254, color_temp: 213 };

const LAMP = id('Lamp'), CEILING = id('Ceiling'), DESK = id('Desk');

const base: Partial<ConfigSchema> = {
  rooms: { living: { name: 'Living Room', devices: [LAMP, CEILING] } },
  autoZones: ['living'],
};

const setup = (config: Partial<ConfigSchema> = {}) =>
  lightingStack([bulb('Lamp'), bulb('Ceiling'), bulb('Desk')], { ...base, ...config });

function rule(extra: Partial<Rule>): Rule {
  return {
    id: 'r1', name: 'Rule', time: '12:00', days: [0, 1, 2, 3, 4, 5, 6], enabled: true,
    action: { type: 'reconfigure', group: 'living', config: 'scene', brightness: 40, colorTemp: 10 }, ...extra,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOON);
});
afterEach(() => vi.useRealTimers());

describe('Auto', () => {
  it('drives zones on Auto and leaves the rest alone', async () => {
    const { mgr } = await setup();
    expect(mgr.groups[LAMP]).toMatchObject(AUTO_NOON);
    expect(mgr.groups[CEILING]).toMatchObject(AUTO_NOON);
    expect(mgr.groups[DESK]).toMatchObject({ brightness: 70, colorTemp: 30 });
  });

  it('turning Auto on applies it right away; a single unassigned bulb is its own zone', async () => {
    const { controller, client } = await setup();
    controller.setAuto([DESK], true);
    expect(client.lastSet('Desk')).toEqual(AUTO_ON);
    expect(readConfig().autoZones).toEqual(['living', DESK]);
  });

  it('does not re-send a look a bulb already has', async () => {
    const { controller, client } = await setup();
    controller.reconcile();
    expect(client.published).toEqual([]);
  });
});

describe('manual sessions', () => {
  it('a manual change freezes the whole room, so Auto stops touching it', async () => {
    const { controller, mgr, client } = await setup();
    controller.manualSet([LAMP], { brightness: 30 });
    expect(client.lastSet('Lamp')).toEqual({ state: 'ON', brightness: 76 });
    expect(controller.getZonesState().living).toMatchObject({ control: 'manual', auto: true });

    client.reset();
    vi.setSystemTime(new Date(2026, 5, 21, 20, 0)); // evening: Auto would now dim and warm
    controller.reconcile();
    expect(client.published).toEqual([]);
    expect(mgr.groups[CEILING]).toMatchObject(AUTO_NOON); // frozen where it was
  });

  it('ends when the room goes off; switching back on returns to Auto', async () => {
    const { controller, client } = await setup();
    controller.manualSet([LAMP], { brightness: 30 });

    controller.manualPower([LAMP], false);
    expect(controller.getZonesState().living?.control).toBe('manual'); // Ceiling still on

    controller.manualPower([CEILING], false);
    expect(controller.getZonesState().living?.control).toBe('auto');
    expect(readConfig().zones).toEqual({});

    client.reset();
    controller.manualPower([LAMP], true);
    expect(client.lastSet('Lamp')).toEqual(AUTO_ON);
  });

  it('ends however the room went dark — e.g. a wall dimmer the bulbs report', async () => {
    const { controller, client } = await setup();
    controller.manualSet([LAMP], { brightness: 30 });
    client.deliver('zigbee2mqtt/Lamp', { state: 'OFF' });
    client.deliver('zigbee2mqtt/Ceiling', { state: 'OFF' });
    expect(controller.getZonesState().living?.control).toBe('auto');
  });

  it('survives a restart', async () => {
    const first = await setup();
    first.controller.manualSet([LAMP], { brightness: 30 });
    const zones = readConfig().zones;

    const { controller } = await setup({ zones });
    expect(controller.getZonesState().living?.control).toBe('manual');
    expect(controller.resolveLook('living', LAMP)).toEqual({ brightness: 30, colorTemp: 80 });
  });

  it('"resume" and turning Auto on both hand the room back', async () => {
    const { controller, client } = await setup();
    controller.manualSet([LAMP], { brightness: 30 });
    client.reset();
    controller.endManual('living');
    expect(client.lastSet('Lamp')).toEqual({ state: 'ON', brightness: 254, color_temp: 213 });

    controller.manualSet([LAMP], { brightness: 30 });
    controller.setAuto(['living'], true);
    expect(controller.getZonesState().living?.control).toBe('auto');
  });

  it('adjusting a dark bulb does nothing', async () => {
    const { controller, client } = await setup();
    controller.manualPower([LAMP, CEILING], false);
    client.reset();
    controller.manualSet([LAMP], { brightness: 30 });
    expect(client.published).toEqual([]);
    expect(controller.getZonesState().living?.control).toBe('auto');
  });
});

describe('wall switch', () => {
  it('a bulb coming back from no power switches on with its zone\'s look', async () => {
    const { client } = await setup();
    client.deliver('zigbee2mqtt/Lamp/availability', 'online');
    client.deliver('zigbee2mqtt/Lamp/availability', 'offline');
    client.reset();
    client.deliver('zigbee2mqtt/Lamp/availability', 'online');
    expect(client.lastSet('Lamp')).toEqual(AUTO_ON);
  });

  it('the first availability report after connecting is not treated as a power-up', async () => {
    const { client } = await setup();
    client.deliver('zigbee2mqtt/Lamp/availability', 'online');
    expect(client.setsFor('Lamp')).toEqual([]);
  });

  it('power loss across the whole room ends its manual session', async () => {
    const { controller, client } = await setup();
    client.deliver('zigbee2mqtt/Lamp/availability', 'online');
    client.deliver('zigbee2mqtt/Ceiling/availability', 'online');
    controller.manualSet([LAMP], { brightness: 30 });
    client.deliver('zigbee2mqtt/Lamp/availability', 'offline');
    client.deliver('zigbee2mqtt/Ceiling/availability', 'offline');
    expect(controller.getZonesState().living?.control).toBe('auto');
  });
});

describe('rules', () => {
  it('a window\'s look applies while it is in effect, then the room goes back to Auto', async () => {
    const { controller, client, mgr } = await setup({
      rules: [rule({ end: '14:00' })], ruleLastFired: { r1: '2026-06-21' },
    });
    expect(mgr.groups[LAMP]).toMatchObject({ brightness: 40, colorTemp: 10 });
    expect(controller.getZonesState().living).toMatchObject({
      control: 'rule', ruleName: 'Rule', until: new Date(2026, 5, 21, 14, 0).toISOString(),
    });

    vi.setSystemTime(new Date(2026, 5, 21, 14, 1));
    controller.reconcile();
    expect(client.lastSet('Lamp')).toEqual(AUTO_ON);
  });

  it('the most recently started window decides when two overlap', async () => {
    const { controller } = await setup({
      rules: [
        rule({ id: 'early', time: '11:00', end: '15:00', presence: { mode: 'ignore' } }),
        rule({ id: 'late',  time: '12:30', end: '14:00', presence: { mode: 'custom', brightness: 5 } }),
      ],
      ruleLastFired: { early: '2026-06-21', late: '2026-06-21' },
    });
    expect(controller.presencePolicy('living')).toEqual({ mode: 'custom', brightness: 5 });
    expect(controller.presencePolicy(DESK)).toBeNull();
  });

  it('a rule start skips a room in a manual session…', async () => {
    const { controller, mgr } = await setup();
    controller.manualSet([LAMP], { brightness: 30 });
    controller.ruleStart(rule({ action: { type: 'power', group: 'all', on: false } }));
    expect(mgr.poweredOff.has(LAMP)).toBe(false);
    expect(mgr.poweredOff.has(DESK)).toBe(true);
  });

  it('…unless it has "Override manual", which also ends the session', async () => {
    const { controller, mgr } = await setup();
    controller.manualSet([LAMP], { brightness: 30 });
    controller.ruleStart(rule({ overrideManual: true, action: { type: 'reconfigure', group: 'living', config: 'scene', brightness: 40, colorTemp: 10 } }));
    expect(mgr.groups[LAMP]).toMatchObject({ brightness: 40, colorTemp: 10 });
    expect(controller.getZonesState().living?.control).not.toBe('manual');
  });

  it('an instant scene switches a dark room on with the scene in one step and takes it off Auto', async () => {
    const { controller, client } = await setup();
    controller.manualPower([LAMP, CEILING], false);
    client.reset();
    controller.ruleStart(rule({ action: { type: 'power', group: 'living', on: true, config: 'scene', brightness: 100, colorTemp: 0 } }));
    expect(client.setsFor('Lamp')).toEqual([{ state: 'ON', brightness: 254, color_temp: 454 }]);
    expect(readConfig().autoZones).toEqual([]);
  });
});

describe('targets', () => {
  it('resolve "all", rooms and bulbs by id or name (ignoring case)', async () => {
    const { controller } = await setup();
    expect(controller.resolveTargets('all').sort()).toEqual([CEILING, DESK, LAMP].sort());
    expect(controller.resolveTargets('living room')).toEqual([LAMP, CEILING]);
    expect(controller.resolveTargets('desk')).toEqual([DESK]);
    expect(controller.resolveTargets('Garage')).toEqual([]);
    expect(controller.zonesForTarget('Lamp')).toEqual(['living']);
    expect(controller.zonesForTarget('all').sort()).toEqual([DESK, 'living'].sort());
  });

  it('an empty room gives way to a bulb with the same name', async () => {
    const { controller } = await setup({
      rooms: { ...base.rooms, empty: { name: 'Desk', devices: [] } },
    });
    expect(controller.resolveTargets('desk')).toEqual([DESK]);
    expect(controller.zonesForTarget('Desk')).toEqual([DESK]);
    expect(controller.zonesForTarget('empty')).toEqual(['empty']); // still reachable by id
  });
});

describe('the assistant\'s looks', () => {
  const RAINY = { brightness: 40, colorTemp: 10 };

  it('apply until they run out, then the room goes back to what it was', async () => {
    const { controller, mgr } = await setup();
    expect(controller.assistantSet(['living'], { look: RAINY, minutes: 60, reason: 'it started raining' })).toEqual([{ zone: 'living', ok: true }]);
    expect(mgr.groups[LAMP]).toMatchObject(RAINY);
    expect(controller.getZonesState().living).toMatchObject({ control: 'assistant', reason: 'it started raining' });

    vi.advanceTimersByTime(61 * 60 * 1000);
    expect(controller.getZonesState().living!.control).toBe('auto');
    expect(mgr.groups[LAMP]).toMatchObject({ brightness: expect.any(Number) });
    expect(mgr.groups[LAMP]).not.toMatchObject(RAINY);
  });

  it('never freezes the room: a rule starting later wins over it', async () => {
    const later = rule({ time: '13:30', end: '15:00' });
    const { controller, rules, mgr } = await setup({ rules: [later] });
    rules.init(controller.ruleStart, () => controller.reconcile());
    controller.assistantSet(['living'], { look: { brightness: 55, colorTemp: 20 }, reason: 'rain' });
    expect(mgr.groups[LAMP]).toMatchObject({ brightness: 55, colorTemp: 20 });
    vi.advanceTimersByTime(31 * 60 * 1000); // 13:31 — the rule's window starts
    expect(mgr.groups[LAMP]).toMatchObject({ brightness: 40, colorTemp: 10 }); // the rule's scene
    expect(controller.getZonesState().living!.control).toBe('rule');
  });

  it('your change within 10 minutes is a "no": logged, and it leaves the room alone for the day', async () => {
    const { controller } = await setup();
    const { feedbackLog } = await import('../../services/feedback');
    controller.assistantSet(['living'], { look: RAINY, reason: 'it started raining' });
    vi.advanceTimersByTime(3 * 60 * 1000);
    controller.manualSet([LAMP], { brightness: 90 });

    expect(feedbackLog.list()).toMatchObject([{ kind: 'undone', what: 'it started raining', zone: 'living' }]);
    controller.manualPower([LAMP, CEILING], false); // session over
    expect(controller.assistantSet(['living'], { look: RAINY, reason: 'still raining' }))
      .toEqual([{ zone: 'living', ok: false, error: 'Thomas undid a change there today' }]);
  });

  it('leaves rooms you\'re adjusting alone, and logs what it does with its reason', async () => {
    const { controller } = await setup();
    controller.manualSet([DESK], { brightness: 20 });
    expect(controller.assistantSet([DESK], { look: RAINY, reason: 'x' })[0]).toMatchObject({ ok: false, error: 'Thomas is adjusting it by hand' });

    controller.assistantSet(['living'], { power: 'off', reason: 'nobody home for 2 hours' });
    const { explain } = await import('../../services/explain');
    expect(explain('living').history.at(-1)!.text).toBe('The assistant turned it off — nobody home for 2 hours');
  });
});
