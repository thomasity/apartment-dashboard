import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { mockAxios } from '../helpers/http';
import { mountRouter } from '../helpers/router';
import { readConfig, writeConfig } from '../helpers/config';

// Capture UDP sends instead of broadcasting Wake-on-LAN / SSDP on the real network.
const udp = vi.hoisted(() => ({
  sent:      [] as Array<{ buf: Buffer; port: number; addr: string }>,
  onMessage: null as ((buf: Buffer) => void) | null, // lets a test play the part of a device replying
}));
vi.mock('dgram', () => {
  const createSocket = () => ({
    once() {}, setBroadcast() {}, close() {},
    on(event: string, cb: (buf: Buffer) => void) { if (event === 'message') udp.onMessage = cb; },
    bind(_port: number, cb: () => void) { cb(); },
    send(buf: Buffer, ...rest: unknown[]) {
      // send(buf, offset, length, port, addr, cb) or send(buf, port, addr)
      const [port, addr, cb] = rest.length >= 5 ? [rest[2], rest[3], rest[4]] : [rest[0], rest[1], rest[2]];
      udp.sent.push({ buf, port: port as number, addr: addr as string });
      (cb as (() => void) | undefined)?.();
    },
  });
  return { default: { createSocket }, createSocket };
});

const ROKU = 'http://192.168.1.50:8060';

const DEVICE_INFO = `<?xml version="1.0" encoding="UTF-8" ?>
<device-info>
  <friendly-device-name>Living Room Roku</friendly-device-name>
  <model-name>Roku Streaming Stick 4K</model-name>
  <wifi-mac>d8:31:34:aa:bb:cc</wifi-mac>
</device-info>`;

let app: Express;

beforeEach(async () => {
  udp.sent = [];
  writeConfig({ rokuIp: '192.168.1.50', rokuName: 'Living Room Roku' });
  app = await mountRouter('/api/tv', () => import('../../routes/tv'));
});

describe('GET /api/tv/status', () => {
  it('parses the active app and player state from Roku XML', async () => {
    mockAxios({
      [`GET ${ROKU}/query/active-app`]:   () => '<active-app><app id="12" type="appl" version="5.0">Netflix</app></active-app>',
      [`GET ${ROKU}/query/media-player`]: () =>
        '<player error="false" state="play"><position>00:01:05</position><duration>01:30:00</duration></player>',
    });
    const { body } = await request(app).get('/api/tv/status').expect(200);
    expect(body).toEqual({ appId: '12', appName: 'Netflix', playerState: 'play', position: 65, duration: 5400 });
  });

  it('still answers if only one of the two queries works', async () => {
    mockAxios({
      [`GET ${ROKU}/query/active-app`]: () => '<active-app><app id="562859">Home</app></active-app>',
    });
    const { body } = await request(app).get('/api/tv/status').expect(200);
    expect(body).toMatchObject({ appName: 'Home', playerState: 'none', position: 0 });
  });

  it('400s when no Roku is configured', async () => {
    writeConfig();
    const { body } = await request(app).get('/api/tv/status').expect(400);
    expect(body.error).toMatch(/ROKU_IP/);
  });
});

describe('apps and launching', () => {
  it('lists installed apps', async () => {
    mockAxios({
      [`GET ${ROKU}/query/apps`]: () =>
        '<apps><app id="12" type="appl">Netflix</app><app id="2285" type="appl"> YouTube </app></apps>',
    });
    const { body } = await request(app).get('/api/tv/apps').expect(200);
    expect(body).toEqual([{ id: '12', name: 'Netflix' }, { id: '2285', name: 'YouTube' }]);
  });

  it('503s when the TV is unreachable', async () => {
    mockAxios({});
    await request(app).get('/api/tv/apps').expect(503);
    await request(app).post('/api/tv/launch/12').expect(503);
  });

  it('launches an app', async () => {
    const calls = mockAxios({ [`POST ${ROKU}/launch/`]: () => '' });
    await request(app).post('/api/tv/launch/12').expect(200);
    expect(calls.map((c) => c.url)).toEqual([`${ROKU}/launch/12`]);
  });
});

describe('keypresses and typing', () => {
  it('forwards named keys', async () => {
    const calls = mockAxios({ [`POST ${ROKU}/keypress/`]: () => '' });
    await request(app).post('/api/tv/keypress/VolumeUp').expect(200);
    expect(calls[0]?.url).toBe(`${ROKU}/keypress/VolumeUp`);
  });

  it('re-encodes literal characters so Roku receives them intact', async () => {
    const calls = mockAxios({ [`POST ${ROKU}/keypress/`]: () => '' });
    await request(app).post('/api/tv/keypress/Lit_%20').expect(200);
    await request(app).post('/api/tv/keypress/Lit_%26').expect(200);
    expect(calls.map((c) => c.url)).toEqual([`${ROKU}/keypress/Lit_%20`, `${ROKU}/keypress/Lit_%26`]);
  });

  it('types text one character at a time', async () => {
    const calls = mockAxios({ [`POST ${ROKU}/keypress/`]: () => '' });
    await request(app).post('/api/tv/type').send({ text: 'a b' }).expect(200);
    expect(calls.map((c) => c.url.slice(ROKU.length))).toEqual(['/keypress/Lit_a', '/keypress/Lit_%20', '/keypress/Lit_b']);
  });

  it('search requires a keyword and passes it as a query param', async () => {
    const calls = mockAxios({ [`POST ${ROKU}/search/browse`]: () => '' });
    await request(app).post('/api/tv/search').send({ keyword: '  ' }).expect(400);
    await request(app).post('/api/tv/search').send({ keyword: 'The Bear' }).expect(200);
    expect(calls[0]?.url).toBe(`${ROKU}/search/browse?keyword=The+Bear`);
  });
});

describe('device selection and power', () => {
  it('select stores the device and caches its MAC for Wake-on-LAN', async () => {
    mockAxios({ 'GET http://192.168.1.77:8060/query/device-info': () => DEVICE_INFO });
    await request(app).post('/api/tv/select').send({ ip: '192.168.1.77', name: 'Bedroom' }).expect(200);
    expect(readConfig()).toMatchObject({ rokuIp: '192.168.1.77', rokuName: 'Bedroom', rokuMac: 'd8:31:34:aa:bb:cc' });

    const { body } = await request(app).get('/api/tv/device').expect(200);
    expect(body).toEqual({ ip: '192.168.1.77', name: 'Bedroom' });
  });

  it('select requires an ip', async () => {
    await request(app).post('/api/tv/select').send({}).expect(400);
  });

  it('power-on sends a valid magic packet, then PowerOn', async () => {
    writeConfig({ rokuIp: '192.168.1.50', rokuMac: 'd8:31:34:aa:bb:cc' });
    const calls = mockAxios({ [`POST ${ROKU}/keypress/PowerOn`]: () => '' });

    const { body } = await request(app).post('/api/tv/power-on').expect(200);
    expect(body).toEqual({ ok: true, waking: false });
    expect(calls.map((c) => c.url)).toEqual([`${ROKU}/keypress/PowerOn`]);

    // Global broadcast + the TV's own /24 subnet, both on the WoL port
    expect(udp.sent.map((s) => [s.addr, s.port])).toEqual([['255.255.255.255', 9], ['192.168.1.255', 9]]);
    const pkt = udp.sent[0]!.buf;
    expect(pkt).toHaveLength(102);
    expect(pkt.subarray(0, 6)).toEqual(Buffer.alloc(6, 0xff));
    const mac = Buffer.from('d83134aabbcc', 'hex');
    for (let i = 0; i < 16; i++) expect(pkt.subarray(6 + i * 6, 12 + i * 6)).toEqual(mac);
  });

  it('power-on reports "waking" when the TV is too asleep for ECP', async () => {
    writeConfig({ rokuIp: '192.168.1.50', rokuMac: 'd8:31:34:aa:bb:cc' });
    mockAxios({});
    const { body } = await request(app).post('/api/tv/power-on').expect(200);
    expect(body).toEqual({ ok: true, waking: true });
  });
});

describe('GET /api/tv/discover', () => {
  it('collects SSDP replies and looks up each device name', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    try {
      mockAxios({ 'GET http://192.168.1.77:8060/query/device-info': () => DEVICE_INFO });

      const pending = request(app).get('/api/tv/discover').then((r) => r);
      await vi.waitFor(() => expect(udp.sent).toHaveLength(1));
      expect(udp.sent[0]!.buf.toString()).toContain('ST: roku:ecp');

      udp.onMessage!(Buffer.from('HTTP/1.1 200 OK\r\nLOCATION: http://192.168.1.77:8060/\r\n'));
      udp.onMessage!(Buffer.from('HTTP/1.1 200 OK\r\nLOCATION: http://192.168.1.77:8060/\r\n')); // dupes collapse
      await vi.advanceTimersByTimeAsync(3000);

      const res = await pending;
      expect(res.body).toEqual([{ ip: '192.168.1.77', name: 'Living Room Roku', model: 'Roku Streaming Stick 4K' }]);
    } finally {
      vi.useRealTimers();
    }
  });
});
