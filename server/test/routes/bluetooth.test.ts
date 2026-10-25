import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { mountRouter } from '../helpers/router';

// Fake bluetoothctl / pactl / wpctl. `outputs` maps "cmd arg arg" → stdout.
const sh = vi.hoisted(() => ({ calls: [] as string[], outputs: {} as Record<string, string> }));
vi.mock('child_process', () => {
  const execFile = (cmd: string, args: string[], optsOrCb: unknown, maybeCb?: unknown) => {
    const cb = (typeof optsOrCb === 'function' ? optsOrCb : maybeCb) as (e: Error | null, out: string, err: string) => void;
    const line = [cmd, ...args].join(' ');
    sh.calls.push(line);
    cb(null, sh.outputs[line] ?? '', '');
  };
  return { default: { execFile, spawn: vi.fn() }, execFile, spawn: vi.fn() };
});

const SPEAKER = 'AA:BB:CC:DD:EE:01';
const HEADSET = 'AA:BB:CC:DD:EE:02';

let app: Express;

beforeEach(async () => {
  sh.calls = [];
  sh.outputs = {
    'bluetoothctl devices':           `Device ${SPEAKER} JBL Flip 5\nDevice ${HEADSET} WH-1000XM4\nDevice 11:22:33:44:55:66 Neighbor TV\n`,
    'bluetoothctl devices Paired':    `Device ${SPEAKER} JBL Flip 5\nDevice ${HEADSET} WH-1000XM4\n`,
    'bluetoothctl devices Connected': `Device ${HEADSET} WH-1000XM4\n`,
    'pactl list sinks short':
      '45\talsa_output.platform-bcm2835_audio.analog-stereo\tPipeWire\ts16le 2ch 48000Hz\tSUSPENDED\n' +
      '67\tbluez_output.AA_BB_CC_DD_EE_01.1\tPipeWire\ts16le 2ch 48000Hz\tRUNNING\n',
  };
  app = await mountRouter('/api/bluetooth', () => import('../../routes/bluetooth'));
});

describe('bluetooth', () => {
  it('lists only paired devices, with connection status', async () => {
    const { body } = await request(app).get('/api/bluetooth/devices').expect(200);
    expect(body).toEqual([
      { mac: SPEAKER, name: 'JBL Flip 5', connected: false },
      { mac: HEADSET, name: 'WH-1000XM4', connected: true },
    ]);
  });

  it('connect routes audio to the device\'s PipeWire sink', async () => {
    await request(app).post('/api/bluetooth/connect').send({ mac: SPEAKER }).expect(200);
    expect(sh.calls).toEqual([`bluetoothctl connect ${SPEAKER}`, 'pactl list sinks short', 'wpctl set-default 67']);
  });

  it('disconnect falls back to the Pi\'s built-in audio', async () => {
    await request(app).post('/api/bluetooth/disconnect').send({ mac: SPEAKER }).expect(200);
    expect(sh.calls).toEqual([`bluetoothctl disconnect ${SPEAKER}`, 'pactl list sinks short', 'wpctl set-default 45']);
  });

  it('forget removes the pairing', async () => {
    await request(app).delete(`/api/bluetooth/device/${SPEAKER}`).expect(200);
    expect(sh.calls).toEqual([`bluetoothctl remove ${SPEAKER}`]);
  });

  it('requires a mac', async () => {
    await request(app).post('/api/bluetooth/connect').send({}).expect(400);
    await request(app).post('/api/bluetooth/disconnect').send({}).expect(400);
    await request(app).post('/api/bluetooth/pair').send({}).expect(400);
    expect(sh.calls).toEqual([]);
  });
});
