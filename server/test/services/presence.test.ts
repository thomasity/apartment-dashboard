import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bulb, connectedManager, motionSensor } from '../helpers/fakeMqtt';
import { readConfig, writeConfig } from '../helpers/config';

const MIN = 60 * 1000;

async function setup() {
  vi.resetModules();
  const presence = await import('../../services/presence');
  const rooms    = await import('../../services/rooms');
  const { mgr, client } = connectedManager([bulb('Lamp'), bulb('Ceiling'), bulb('Bedside'), motionSensor('Hall Motion')]);
  presence.init(mgr, rooms);
  presence.create({ sensor: 'Hall Motion', room: 'Hall', vacantAfterMinutes: 5, manualOffCooldownMinutes: 30 });
  const motion = (occupancy: boolean) => client.deliver('zigbee2mqtt/Hall Motion', { occupancy });
  return { presence, mgr, client, motion };
}

beforeEach(() => {
  vi.useFakeTimers();
  writeConfig({ rooms: { Hall: ['Lamp', 'Ceiling'], Bedroom: ['Bedside'] } });
});
afterEach(() => vi.useRealTimers());

describe('presence automation', () => {
  it('turns the room on when motion is detected', async () => {
    const { mgr, client, motion } = await setup();
    mgr.setPower('all', false);
    client.reset();

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
    const { presence, client, motion } = await setup();
    presence.recordManualPower('Hall', false);
    client.reset();

    motion(true);
    expect(client.published).toEqual([]);

    vi.advanceTimersByTime(30 * MIN);
    motion(true);
    expect(client.lastSet('Lamp')).toMatchObject({ state: 'ON' });
  });

  it('a manual "on" clears the cooldown early', async () => {
    const { presence, client, motion } = await setup();
    presence.recordManualPower('Hall', false);
    presence.recordManualPower('Hall', true);
    client.reset();
    motion(true);
    expect(client.lastSet('Lamp')).toMatchObject({ state: 'ON' });
  });

  it('a disabled sensor does nothing', async () => {
    const { presence, client, motion } = await setup();
    presence.update('Hall Motion', { enabled: false });
    motion(true);
    motion(false);
    vi.advanceTimersByTime(60 * MIN);
    expect(client.published).toEqual([]);
  });

  it('removing a sensor cancels its pending vacancy timer', async () => {
    const { presence, client, motion } = await setup();
    motion(false);
    presence.remove('Hall Motion');
    vi.advanceTimersByTime(60 * MIN);
    expect(client.published).toEqual([]);
  });
});

describe('presence config', () => {
  it('create() fills in defaults and persists', async () => {
    const { presence } = await setup();
    const entry = presence.create({ sensor: 'Bed Motion', room: 'Bedroom' });
    expect(entry).toMatchObject({ vacantAfterMinutes: 5, manualOffCooldownMinutes: 120, enabled: true });
    expect(readConfig().presence?.['Bed Motion']).toMatchObject({ room: 'Bedroom' });
  });

  it('validates input', async () => {
    const { presence } = await setup();
    expect(() => presence.create({ sensor: '', room: 'Hall' })).toThrow(expect.objectContaining({ code: 'INVALID' }));
    expect(() => presence.update('Ghost', {})).toThrow(expect.objectContaining({ code: 'NOT_FOUND' }));
  });

  it('getState() includes live occupancy from the sensor', async () => {
    const { presence, motion } = await setup();
    motion(true);
    expect(presence.getState()).toEqual([expect.objectContaining({ sensor: 'Hall Motion', occupancy: true })]);
  });
});
