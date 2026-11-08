import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { clearLogs, writeConfig } from '../helpers/config';
import { startApp } from '../helpers/app';

const MIN = 60_000;
const PHONE = 'aa:bb:cc:dd:ee:ff';
const phone = { ip: '192.168.1.20', mac: PHONE, vendor: 'Samsung' };
const laptop = { ip: '192.168.1.30', mac: '11:22:33:44:55:66', vendor: null };

async function load() {
  vi.resetModules();
  return import('../../services/home');
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 5, 22, 7, 0));
  clearLogs();
  writeConfig({ phones: [{ mac: PHONE, name: 'Pixel' }] });
  vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => vi.useRealTimers());

describe('arp-scan output', () => {
  it('reads ip, address and vendor, skipping anything else', async () => {
    const { parseArpScan } = await load();
    expect(parseArpScan('192.168.1.20\tAA:BB:CC:DD:EE:FF\tSamsung Electronics\n192.168.1.1\t00:11:22:33:44:55\t\njunk\n'
      + '192.168.1.40\t2a:bb:cc:dd:ee:01\t(Unknown: locally administered)\n')).toEqual([
      { ip: '192.168.1.20', mac: 'aa:bb:cc:dd:ee:ff', vendor: 'Samsung Electronics' },
      { ip: '192.168.1.1', mac: '00:11:22:33:44:55', vendor: null },
      { ip: '192.168.1.40', mac: '2a:bb:cc:dd:ee:01', vendor: null },
    ]);
  });
});

describe('home / away', () => {
  it('a quiet phone isn\'t "gone" until 15 minutes without a sighting; coming back counts at once', async () => {
    const home = await load();
    home.update([phone]);
    expect(home.isHome()).toBe(true);

    vi.advanceTimersByTime(10 * MIN);
    home.update([laptop]); // phone asleep, missed a few scans
    expect(home.isHome()).toBe(true);

    vi.advanceTimersByTime(6 * MIN);
    home.update([]);
    expect(home.isHome()).toBe(false);

    vi.advanceTimersByTime(60 * MIN);
    home.update([phone]);
    expect(home.isHome()).toBe(true);

    const left = new Date(2026, 5, 22, 7, 0).getTime();
    expect(home.homeLog.list().map(({ home: h, lastSeen }) => ({ home: h, lastSeen }))).toEqual([
      { home: false, lastSeen: left },   // left when last seen, not when noticed
      { home: true, lastSeen: undefined },
    ]);
  });

  it('right after startup a phone that hasn\'t answered yet is unknown, not away', async () => {
    const home = await load();
    home.update([]);
    expect(home.isHome()).toBeNull();
    vi.advanceTimersByTime(15 * MIN);
    home.update([]);
    expect(home.isHome()).toBe(false);
    expect(home.homeLog.list()).toEqual([]); // the first verdict is the starting point
  });

  it('with no phone set up, home is unknown', async () => {
    writeConfig({});
    const home = await load();
    home.update([phone]);
    expect(home.isHome()).toBeNull();
  });
});

describe('/api/home', () => {
  it('lists what the scan sees, and adds and removes phones', async () => {
    writeConfig({ lightingSchema: 2 });
    const ctx = await startApp();
    try {
      const home = await import('../../services/home');
      home.update([phone, laptop]);
      const api = () => request(ctx.app);

      expect((await api().get('/api/home/devices').expect(200)).body.map((d: { mac: string }) => d.mac)).toEqual([PHONE, laptop.mac]);
      await api().post('/api/home/phones').send({ mac: 'not-a-mac' }).expect(400);
      const { body } = await api().post('/api/home/phones').send({ mac: PHONE.toUpperCase(), name: 'Pixel' }).expect(200);
      expect(body.phones).toEqual([{ mac: PHONE, name: 'Pixel', home: null, lastSeen: expect.any(Number) }]);

      await api().delete(`/api/home/phones/${PHONE}`).expect(200);
      await api().delete(`/api/home/phones/${PHONE}`).expect(404);
    } finally {
      await ctx.close();
    }
  });
});
