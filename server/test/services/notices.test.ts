import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bulb, id, motionSensor } from '../helpers/fakeMqtt';
import { lightingStack } from '../helpers/lighting';
import type { AppServer } from '../../types';

const MIN = 60_000;
const PHONE = 'aa:bb:cc:dd:ee:ff';
const phone = { ip: '192.168.1.20', mac: PHONE, vendor: null };
const LAMP = id('Lamp'), BEDSIDE = id('Bedside');

/** A fake socket.io server that records what goes to every dashboard and to one. */
function fakeIo() {
  const toAll: Array<[string, unknown]> = [];
  const toOne: Array<[string, string, unknown]> = [];
  let onConnect: ((socket: object) => void) | null = null;
  const io = {
    emit: (e: string, p: unknown) => toAll.push([e, p]),
    to: (socketId: string) => ({ emit: (e: string, p: unknown) => toOne.push([socketId, e, p]) }),
    on: (_e: string, fn: (socket: object) => void) => { onConnect = fn; },
  } as unknown as AppServer;
  /** A dashboard that's been touched — it becomes the one that speaks */
  const touchDashboard = (socketId: string) => {
    const handlers: Record<string, () => void> = {};
    onConnect!({ id: socketId, on: (e: string, fn: () => void) => { handlers[e] = fn; } });
    handlers['assistant:active']!();
  };
  const notes = () => toAll.filter(([e]) => e === 'assistant:notice').map(([, n]) => (n as { text: string }).text);
  const spoken = () => toOne.map(([to, , p]) => `${to}: ${(p as { text: string }).text}`);
  return { io, touchDashboard, notes, spoken };
}

async function setup(at = new Date(2026, 5, 22, 18, 0)) {
  vi.setSystemTime(at);
  const stack = await lightingStack([bulb('Lamp'), bulb('Bedside'), motionSensor('Living Motion'), motionSensor('Bed Motion')], {
    rooms: { living: { name: 'Living Room', devices: [LAMP] }, bedroom: { name: 'Bedroom', devices: [BEDSIDE] } },
    phones: [{ mac: PHONE, name: 'Pixel' }],
  });
  stack.presence.create({ sensor: id('Living Motion'), room: 'living' });
  stack.presence.create({ sensor: id('Bed Motion'), room: 'bedroom' });
  const home = await import('../../services/home');
  const notices = await import('../../services/notices');
  const fake = fakeIo();
  home.init(stack.mgr);
  notices.init(fake.io);
  fake.touchDashboard('tablet');
  const motion = (sensor: string) => {
    stack.client.deliver(`zigbee2mqtt/${sensor}`, { occupancy: false });
    stack.client.deliver(`zigbee2mqtt/${sensor}`, { occupancy: true });
  };
  return { ...stack, home, notices, ...fake, motion };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => vi.useRealTimers());

describe('arriving', () => {
  it('phone on the Wi-Fi is "arriving"; living-room motion after it is "inside" — not motion elsewhere', async () => {
    const { home, motion } = await setup();
    const events: string[] = [];
    home.homeEvents.on('arriving', () => events.push('arriving'));
    home.homeEvents.on('inside', () => events.push('inside'));

    home.update([phone]);                // first verdict: where things stand
    vi.advanceTimersByTime(16 * MIN);
    home.update([]);                     // left
    vi.advanceTimersByTime(60 * MIN);
    home.update([phone]);                // back on the Wi-Fi, still outside
    motion('Bed Motion');                // not the speaker room
    vi.advanceTimersByTime(2 * MIN);
    motion('Living Motion');
    expect(events).toEqual(['arriving', 'inside']);
  });

  it('no living-room motion within 20 minutes: no "inside"', async () => {
    const { home, motion } = await setup();
    const inside = vi.fn();
    home.homeEvents.on('inside', inside);
    home.update([phone]);
    vi.advanceTimersByTime(16 * MIN);
    home.update([]);
    home.update([phone]);
    vi.advanceTimersByTime(21 * MIN);
    motion('Living Motion');
    expect(inside).not.toHaveBeenCalled();
  });
});

describe('remarks', () => {
  it('wait while Thomas is out and are said once he\'s in the living room — by the dashboard touched last', async () => {
    const { home, notices, notes, spoken, motion, touchDashboard } = await setup();
    home.update([phone]);
    vi.advanceTimersByTime(16 * MIN);
    home.update([]); // out
    notices.notify({ text: 'Turned off the living room — nobody was home.' });
    expect(notes()).toEqual([]);

    motion('Living Motion'); // someone else, phone still away: keep waiting
    expect(notes()).toEqual([]);

    touchDashboard('laptop');
    home.update([phone]);
    motion('Living Motion');
    expect(notes()).toEqual(['Turned off the living room — nobody was home.']);
    expect(spoken()).toEqual(['laptop: Turned off the living room — nobody was home.']);
  });

  it('are shown but not spoken during quiet hours, or past the daily limit', async () => {
    const late = await setup(new Date(2026, 5, 22, 23, 30));
    late.motion('Living Motion');
    late.notices.notify({ text: 'Late one' });
    expect(late.notes()).toEqual(['Late one']);
    expect(late.spoken()).toEqual([]);

    const day = await setup();
    day.motion('Living Motion');
    for (let i = 1; i <= 6; i++) day.notices.notify({ text: `Remark ${i}` });
    expect(day.notes()).toHaveLength(6);
    expect(day.spoken()).toHaveLength(5);
  });

  it('Undo on a note reverses the assistant\'s look and counts as a "no"', async () => {
    const { controller, notices, motion } = await setup();
    motion('Living Motion');
    controller.assistantSet(['living'], { look: { brightness: 30, colorTemp: 0 }, reason: 'rainy evening' });
    const note = notices.notify({ text: 'Dimmed the living room — rainy evening.', undo: { kind: 'look', zone: 'living' } });
    expect(notices.active().map((n) => n.id)).toEqual([note.id]);

    expect(notices.undo(note.id)).toBe(true);
    expect(controller.getZonesState().living!.control).not.toBe('assistant');
    expect(notices.active()).toEqual([]);
    const { feedbackLog } = await import('../../services/feedback');
    expect(feedbackLog.list()).toMatchObject([{ kind: 'undone', what: 'rainy evening' }]);
  });
});
