import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bulb, id, motionSensor } from '../helpers/fakeMqtt';
import { lightingStack } from '../helpers/lighting';

const MIN = 60_000;
const PHONE = 'aa:bb:cc:dd:ee:ff';
const phone = { ip: '192.168.1.20', mac: PHONE, vendor: null };
const LAMP = id('Lamp');

async function setup(at: Date, extra: object = {}) {
  vi.setSystemTime(at);
  const stack = await lightingStack([bulb('Lamp'), motionSensor('Living Motion')], {
    rooms: { living: { name: 'Living Room', devices: [LAMP] } },
    phones: [{ mac: PHONE, name: 'Pixel' }],
    ...extra,
  });
  stack.presence.create({ sensor: id('Living Motion'), room: 'living' });
  const home = await import('../../services/home');
  const agent = await import('../../services/agent');
  home.init(stack.mgr);
  const events: string[] = [];
  agent.start(stack.mgr, async ({ event }) => { events.push(event); return 'nothing'; });
  const motion = () => {
    stack.client.deliver('zigbee2mqtt/Living Motion', { occupancy: false });
    stack.client.deliver('zigbee2mqtt/Living Motion', { occupancy: true });
  };
  return { ...stack, home, agent, events, motion };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(async () => {
  (await import('../../services/agent')).stop();
  vi.useRealTimers();
});

describe('what wakes the assistant', () => {
  it('getting home: phone, then living-room motion — with what happened while he was out', async () => {
    const { home, controller, events, motion } = await setup(new Date(2026, 5, 22, 17, 0));
    home.update([phone]);
    vi.advanceTimersByTime(16 * MIN);
    home.update([]);                                         // out
    controller.assistantSet(['living'], { power: 'off', reason: 'nobody home' });
    vi.advanceTimersByTime(60 * MIN);
    home.update([phone]);
    await vi.advanceTimersByTimeAsync(MIN);
    motion();
    await vi.advanceTimersByTimeAsync(0);
    expect(events.find((e) => e.startsWith('Thomas just got home'))).toBe(
      'Thomas just got home and is in the living room. While he was out: Living Room: The assistant turned it off — nobody home.',
    );
  });

  it('the first movement of the day, once, and not in the small hours', async () => {
    const { events, motion } = await setup(new Date(2026, 5, 22, 3, 0));
    motion();
    vi.setSystemTime(new Date(2026, 5, 22, 6, 40));
    motion();
    vi.setSystemTime(new Date(2026, 5, 22, 7, 30));
    motion();
    await vi.advanceTimersByTimeAsync(0);
    expect(events).toEqual(['Thomas\'s day just started — his first movement this morning.']);
  });

  it('a habit coming up, five minutes ahead', async () => {
    const habit = { kind: 'music', minutes: 18 * 60 + 5, spread: 5, matched: 9, eligible: 10, text: '6:05 PM Spotify: Evening Mix ±5 min · 9 of 10 weekdays' };
    const { agent, events } = await setup(new Date(2026, 5, 22, 18, 0), {
      patterns: { generatedAt: Date.now(), historyDays: 20, weekdays: [habit], weekends: [], assistant: { requests: 0, topTools: [], repeated: [], failures: [] } },
    });
    agent.check(new Date(2026, 5, 22, 17, 59));
    agent.check(new Date(2026, 5, 22, 18, 0));
    agent.check(new Date(2026, 5, 22, 18, 0));
    await vi.advanceTimersByTimeAsync(0);
    expect(events).toEqual(['In about 5 minutes Thomas usually: 6:05 PM Spotify: Evening Mix ±5 min · 9 of 10 weekdays.']);
  });

  it('lights left on 30 minutes after he left — once per outing', async () => {
    const { home, agent, events } = await setup(new Date(2026, 5, 22, 9, 0));
    home.update([phone]);
    vi.advanceTimersByTime(16 * MIN);
    home.update([]);
    await vi.advanceTimersByTimeAsync(60 * MIN); // the every-minute check
    expect(events).toEqual(['Thomas has been out for 30 minutes and these lights are still on: Living Room.']);
  });

  it('keeps a gap between runs, and a daily cap', async () => {
    const { agent, events } = await setup(new Date(2026, 5, 22, 12, 0));
    expect(await agent.fire('a', 'one')).toBe(true);
    expect(await agent.fire('b', 'two')).toBe(false);             // too soon
    expect(await agent.fire('c', 'urgent', { urgent: true })).toBe(true);
    for (let i = 0; i < 20; i++) await agent.fire(`x${i}`, 'more', { urgent: true });
    expect(events).toHaveLength(12);
  });
});
