// The voice route end to end: Claude is scripted, but every tool call goes through the real
// HTTP routes (lighting → fake MQTT, TV → mocked Roku, Spotify → mocked Web API).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { startApp } from '../helpers/app';
import { mockAxios } from '../helpers/http';
import { readConfig, writeConfig } from '../helpers/config';

const claude = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock('@anthropic-ai/sdk', () => ({
  default: class { messages = { create: claude.create }; },
}));

let seq = 0;
const tool = (name: string, input: object = {}) => ({ type: 'tool_use', id: `tu_${++seq}`, name, input });
const text = (t: string) => ({ type: 'text', text: t });
const turn = (...content: object[]) => ({
  content,
  stop_reason: content.some((c) => (c as { type: string }).type === 'tool_use') ? 'tool_use' : 'end_turn',
});

/** Queue Claude's responses, one per API call. */
function script(...turns: ReturnType<typeof turn>[]) {
  turns.forEach((t) => claude.create.mockResolvedValueOnce(t));
}

interface SentMessages { messages: Array<{ role: string; content: unknown }> }
const sent = () => claude.create.mock.calls.at(-1)![0] as SentMessages;
/** The tool_result blocks we sent back to Claude after its last tool call. */
const toolResults = () => {
  const msgs = sent().messages;
  return (msgs.at(-1)!.content as Array<{ content: string }>).map((r) => JSON.parse(r.content));
};

const ROKU = 'http://192.168.1.50:8060';
const SPOTIFY = 'https://api.spotify.com/v1';

let ctx: Awaited<ReturnType<typeof startApp>>;

beforeEach(async () => {
  claude.create.mockReset();
  writeConfig({
    rooms: { 'Living Room': ['Lamp', 'Ceiling'] },
    rokuIp: '192.168.1.50',
    active_voice: 'Gary',
    voices: { Gary: { id: 'voice-gary', description: 'Deadpan.' }, Bella: { id: 'voice-bella', description: 'Cheerful.' } },
  });
  ctx = await startApp();
  await ctx.listen();
});
afterEach(() => ctx.close());

const chat = (message: string, extra: object = {}) =>
  request(ctx.app).post('/api/voice/chat').send({ message, ...extra });

describe('POST /api/voice/chat', () => {
  it('"turn off the lights" switches every bulb off over MQTT', async () => {
    mockAxios({});
    script(turn(tool('control_lights', { group: 'all', power: false })), turn(text('')));

    const { body } = await chat('turn off the lights').expect(200);
    expect(body).toEqual({ reply: '', keepListening: true });
    expect(ctx.client.lastSet('Lamp')).toEqual({ state: 'OFF' });
    expect(ctx.client.lastSet('Ceiling')).toEqual({ state: 'OFF' });
    expect(toolResults()).toEqual([{ ok: true }]);
  });

  it('dimming a room by name sets brightness and colour', async () => {
    mockAxios({});
    script(turn(tool('control_lights', { group: 'Lamp', brightness: 20, colorTemp: 0 })), turn(text('Cozy.')));
    const { body } = await chat('make the lamp cozy').expect(200);
    expect(body.reply).toBe('Cozy.');
    expect(ctx.client.lastSet('Lamp')).toEqual({ state: 'ON', brightness: 51, color_temp: 454 });
  });

  it('prefixes the message with a context line', async () => {
    writeConfig({
      ...readConfig(),
      routines: { always: { days: [0, 1, 2, 3, 4, 5, 6], start: '00:00', end: '23:59', description: 'testing things' } },
    });
    mockAxios({ 'GET https://api.open-meteo.com/v1/forecast': () => ({ current: { temperature_2m: 71.6, weather_code: 0 } }) });
    script(turn(text('Hi.')));

    await chat('hello', { room: 'Bedroom' }).expect(200);
    const first = sent().messages[0]!.content as string;
    expect(first).toMatch(/^\[Context: .*Room: Bedroom · Routine: testing things · Voice: Gary — Deadpan\. · 72°F, clear\]\n\nhello$/);
  });

  it('includes conversation history', async () => {
    mockAxios({});
    script(turn(text('Sure.')));
    await chat('and now?', { history: [{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'hey' }] });
    expect(sent().messages.slice(0, 2)).toEqual([{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'hey' }]);
  });

  it('end_conversation closes the mic without being dispatched as a tool', async () => {
    mockAxios({});
    script(turn(text('Bye.'), tool('end_conversation')), turn(text('Bye.')));
    const { body } = await chat('thanks, bye').expect(200);
    expect(body).toEqual({ reply: 'Bye.', keepListening: false });
    expect(toolResults()).toEqual([{}]);
  });

  it('launches a TV app by fuzzy name', async () => {
    const calls = mockAxios({
      [`GET ${ROKU}/query/apps`]: () => '<apps><app id="12">Netflix</app><app id="2285">YouTube</app></apps>',
      [`POST ${ROKU}/launch/`]: () => '',
    });
    script(turn(tool('launch_tv_app', { app_name: 'netflix' })), turn(text('Netflix is up.')));

    await chat('put on netflix').expect(200);
    expect(calls.map((c) => c.url)).toContain(`${ROKU}/launch/12`);
    expect(toolResults()).toEqual([{ ok: true, launched: 'Netflix' }]);
  });

  it('plays one of your playlists by name', async () => {
    const calls = mockAxios({
      'POST https://accounts.spotify.com/api/token': () => ({ access_token: 't', expires_in: 3600 }),
      [`GET ${SPOTIFY}/me/playlists`]: () => ({
        items: [{ id: 'p1', uri: 'spotify:playlist:p1', name: 'Chill Vibes', owner: { id: 'me' }, collaborative: false }],
        next: null,
      }),
      [`GET ${SPOTIFY}/me/player/devices`]: () => ({ devices: [] }),
      [`GET ${SPOTIFY}/me`]: () => ({ id: 'me' }),
      [`PUT ${SPOTIFY}/me/player/play`]: () => ({ status: 204 }),
    });
    script(turn(tool('play_spotify', { type: 'my_playlist', query: 'chill' })), turn(text('Threw on Chill Vibes.')));

    await chat('play something chill').expect(200);
    expect(calls.find((c) => c.method === 'PUT')?.data).toEqual({ context_uri: 'spotify:playlist:p1' });
  });

  it('remember / forget persist to config', async () => {
    mockAxios({});
    script(turn(tool('remember', { label: 'movie mode', value: 'lights 10%' })), turn(text('')));
    await chat('remember movie mode is lights at 10%');
    expect(readConfig().memories).toEqual({ 'movie mode': 'lights 10%' });

    script(turn(tool('forget', { label: 'movie mode' })), turn(text('')));
    await chat('forget movie mode');
    expect(readConfig().memories).toEqual({});
  });

  it('set_voice matches case-insensitively and rejects unknown voices', async () => {
    mockAxios({});
    script(turn(tool('set_voice', { name: 'bella' }), tool('set_voice', { name: 'Nobody' })), turn(text('')));
    await chat('switch voice');
    expect(readConfig().active_voice).toBe('Bella');
    expect(toolResults()[1].error).toMatch(/not found/);
  });

  it('timers can be set and cancelled', async () => {
    mockAxios({});
    script(turn(tool('set_timer', { description: 'lights off', delay_minutes: 30 })), turn(text('')));
    await chat('lights off in 30 minutes');
    expect(toolResults()[0]).toMatchObject({ ok: true, description: 'lights off' });

    script(turn(tool('cancel_timers')), turn(text('')));
    await chat('cancel that');
    expect(toolResults()).toEqual([{ ok: true, cancelled: ['lights off'] }]);
  });

  it('an unknown tool is reported back to Claude rather than crashing', async () => {
    mockAxios({});
    script(turn(tool('make_coffee')), turn(text('No can do.')));
    const { body } = await chat('make coffee').expect(200);
    expect(body.reply).toBe('No can do.');
    expect(toolResults()).toEqual([{ error: 'Unknown tool' }]);
  });

  it('400s on an empty message and 500s if Claude fails', async () => {
    await chat('   ').expect(400);
    mockAxios({});
    claude.create.mockRejectedValueOnce(new Error('overloaded'));
    await chat('hello').expect(500);
  });
});

describe('POST /api/voice/speak', () => {
  it('uses the active voice and caches repeated phrases', async () => {
    const realFetch = globalThis.fetch;
    const tts = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      if (String(input).startsWith('https://api.elevenlabs.io/')) return new Response(Buffer.from('mp3-bytes'));
      return realFetch(input, init);
    });

    const first = await request(ctx.app).post('/api/voice/speak').send({ text: 'Lights off.' }).expect(200);
    expect(first.headers['content-type']).toBe('audio/mpeg');
    expect(first.body.toString()).toBe('mp3-bytes');
    expect(String(tts.mock.calls[0]![0])).toBe('https://api.elevenlabs.io/v1/text-to-speech/voice-gary');

    await request(ctx.app).post('/api/voice/speak').send({ text: 'Lights off.' }).expect(200);
    expect(tts).toHaveBeenCalledTimes(1);
  });

  it('400s on empty text', async () => {
    await request(ctx.app).post('/api/voice/speak').send({ text: '' }).expect(400);
  });
});
