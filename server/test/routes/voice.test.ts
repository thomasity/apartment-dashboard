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
  // Pre-ids shape on purpose: the app migrates it on startup, so this also covers that path.
  writeConfig({
    rooms: { 'Living Room': ['Lamp', 'Ceiling'] } as never,
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

  it('reports a misheard room back to the model instead of claiming success', async () => {
    mockAxios({});
    script(turn(tool('control_lights', { group: 'Garage', power: false })), turn(text('No garage.')));
    await chat('turn off the garage').expect(200);
    expect(toolResults()).toEqual([{ ok: false, error: 'No light or room named "Garage"' }]);
  });

  it('logs each turn with the tools it used and whether they worked', async () => {
    mockAxios({});
    script(
      turn(tool('control_lights', { group: 'Garage', power: false }), tool('control_lights', { group: 'all', power: false })),
      turn(text('No garage, so everything is off.')),
    );
    await chat('turn off the garage', { room: 'tablet' }).expect(200);

    const { assistantLog } = await import('../../services/assistantLog');
    expect(assistantLog.list()).toMatchObject([{
      trigger: 'voice', device: 'tablet', request: 'turn off the garage', reply: 'No garage, so everything is off.',
      tools: [
        { name: 'control_lights', ok: false, error: 'No light or room named "Garage"' },
        { name: 'control_lights', ok: true },
      ],
    }]);
  });

  it('"why are the lights like this?" — voice changes count as manual, and resume hands them back', async () => {
    mockAxios({});
    script(
      turn(tool('control_lights', { group: 'Living Room', brightness: 20 })), turn(text('')),
    );
    await chat('dim the living room').expect(200);

    script(turn(tool('explain_lights', { group: 'living room' })), turn(text('You dimmed it.')));
    await chat('why are the lights so dim?').expect(200);
    const living = (toolResults() as Array<Array<{ room: string; reasons: string[]; recent: string[] }>>)[0]![0];
    expect(living!.room).toBe('Living Room');
    expect(living!.reasons[0]).toMatch(/^You adjusted it by voice at /);
    expect(living!.recent).toEqual([expect.stringMatching(/: You \(voice\) set it to 20% /)]);

    script(turn(tool('resume_automation', { group: 'living room' })), turn(text('')));
    await chat('go back to normal').expect(200);
    expect(toolResults()).toEqual([{ ok: true }]);
    const zones = (await request(ctx.app).get('/api/lighting/zones')).body;
    expect(Object.values(zones)[0]).toMatchObject({ control: 'none' });

    script(turn(tool('resume_automation', { group: 'Garage' })), turn(text('')));
    await chat('reset the garage').expect(200);
    expect(toolResults()).toEqual([{ ok: false, error: 'No light or room named "Garage"' }]);
  });

  it('get_home_state lists real rooms and the lights in them', async () => {
    mockAxios({});
    script(turn(tool('get_home_state', {})), turn(text('')));
    await chat("what's on").expect(200);
    const [state] = toolResults() as Array<{ lights: { rooms: Array<{ name: string; lights: Array<{ name: string }> }> } }>;
    expect(state?.lights.rooms).toEqual([
      { name: 'Living Room', lights: [expect.objectContaining({ name: 'Lamp' }), expect.objectContaining({ name: 'Ceiling' })] },
    ]);
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

  it('rule tools: create by room name, list, change, delete — and undo from the history', async () => {
    mockAxios({});
    script(turn(tool('create_rule', {
      name: 'Weeknight off', time: '23:00', days: ['monday', 'tuesday'], target: 'Living Room', action: 'turn_off',
      motion: 'night_light', end: '07:00', reason: 'You asked for it',
    })), turn(text('')));
    await chat('turn the living room off at 11 on mondays and tuesdays').expect(200);
    expect(toolResults()).toEqual([{ ok: true }]);

    script(turn(tool('list_rules')), turn(text('')));
    await chat('what rules are there').expect(200);
    const [list] = toolResults() as Array<{ count: number; limit: number; rules: string[] }>;
    expect(list).toMatchObject({ count: 1, limit: 15 });
    expect(list!.rules[0]).toMatch(/^Weeknight off \[id \w+\]: 11:00 PM–7:00 AM Mon, Tue · turn off Living Room · motion: night light 10%$/);
    const id = list!.rules[0]!.match(/\[id (\w+)\]/)![1]!;

    script(turn(tool('update_rule', { rule_id: id, time: '23:30', reason: 'You keep overriding it at 11:30' })), turn(text('')));
    await chat('make it later').expect(200);
    script(turn(tool('delete_rule', { rule_id: id, reason: 'No longer needed' })), turn(text('')));
    await chat('get rid of it').expect(200);
    expect(toolResults()).toEqual([{ ok: true }]);

    script(turn(tool('get_activity', { categories: ['rules'] })), turn(text('')));
    await chat('what did you change').expect(200);
    const [lines] = toolResults() as Array<Array<{ what: string }>>;
    expect(lines!.map((l) => l.what.replace(/ \[change \w+\]$/, ''))).toEqual([
      'you, by voice created rule "Weeknight off" — You asked for it',
      'you, by voice edited rule "Weeknight off" — You keep overriding it at 11:30',
      'you, by voice deleted rule "Weeknight off" — No longer needed',
    ]);
    const changeId = lines!.at(-1)!.what.match(/\[change (\w+)\]/)![1]!;

    script(turn(tool('undo_rule_change', { change_id: changeId })), turn(text('')));
    await chat('put it back').expect(200);
    expect(toolResults()).toEqual([{ ok: true }]);
    expect(readConfig().rules).toMatchObject([{ id, time: '23:30', createdBy: 'voice' }]);
  });

  it('play_spotify: a song plays on through its album; Liked Songs; an exact id from the logs', async () => {
    const calls = mockAxios({
      'POST https://accounts.spotify.com/api/token': () => ({ access_token: 't', expires_in: 3600 }),
      [`GET ${SPOTIFY}/search`]: () => ({
        tracks: { items: [{ id: 't', uri: 'spotify:track:t', name: 'Song', artists: [{ name: 'A' }], duration_ms: 1, album: { uri: 'spotify:album:al', images: [] } }] },
        albums: { items: [] }, playlists: { items: [] }, shows: { items: [] }, episodes: { items: [] },
      }),
      [`GET ${SPOTIFY}/me/player/devices`]: () => ({ devices: [{ id: 'd', name: 'raspotify', is_active: true }] }),
      [`GET ${SPOTIFY}/me/tracks`]: () => ({ total: 10, items: [], next: null }),
      [`GET ${SPOTIFY}/me`]: () => ({ id: 'thomas' }),
      [`PUT ${SPOTIFY}/me/player/play`]: () => ({ status: 204 }),
    });
    const plays = () => calls.filter((c) => c.method === 'PUT' && c.url.includes('/me/player/play')).map((c) => c.data);

    script(turn(tool('play_spotify', { type: 'search', query: 'song', kind: 'song' })), turn(text('')));
    await chat('play song').expect(200);
    script(turn(tool('play_spotify', { type: 'liked_songs' })), turn(text('')));
    await chat('play my liked songs').expect(200);
    script(turn(tool('play_spotify', { type: 'uri', uri: 'spotify:track:x', from_uri: 'spotify:playlist:p' })), turn(text('')));
    await chat('play that again').expect(200);

    expect(plays()).toEqual([
      { context_uri: 'spotify:album:al', offset: { uri: 'spotify:track:t' } },
      { context_uri: 'spotify:user:thomas:collection' },
      { context_uri: 'spotify:playlist:p', offset: { uri: 'spotify:track:x' } },
    ]);
  });

  it('the context line says what Thomas usually does around now', async () => {
    const now = new Date();
    const minutes = now.getHours() * 60 + now.getMinutes();
    const habit = { kind: 'music', minutes, spread: 5, matched: 9, eligible: 10, text: '9:00 PM Spotify: Evening Mix ±5 min · 9 of 10 weekdays' };
    const weekend = now.getDay() === 0 || now.getDay() === 6;
    writeConfig({ ...readConfig(), patterns: {
      generatedAt: Date.now(), historyDays: 20,
      weekdays: weekend ? [] : [habit], weekends: weekend ? [habit] : [],
      assistant: { requests: 0, topTools: [], repeated: [], failures: [] },
    } as never });
    mockAxios({});
    script(turn(text('Hi.')));
    await chat('hello').expect(200);
    expect(sent().messages[0]!.content).toContain('Usually now: 9:00 PM Spotify: Evening Mix ·');
  });

  it('on its own: a narrower toolset — no TV, no manual light control — plus say and adjust_lights', async () => {
    const { runProactive } = await import('../../routes/voice');
    mockAxios({});
    script(turn(text('nothing')));
    expect(await runProactive({ trigger: 'event', event: 'Thomas just got home.' })).toBe('nothing');

    const call = claude.create.mock.calls.at(-1)![0] as { tools: Array<{ name: string }>; system: Array<{ text: string }>; messages: Array<{ content: string }> };
    const names = call.tools.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(['say', 'adjust_lights', 'play_spotify', 'create_rule', 'get_patterns']));
    expect(names).not.toEqual(expect.arrayContaining(['control_tv']));
    expect(names).not.toContain('control_lights');
    expect(names).not.toContain('launch_tv_app');
    expect(call.system[0]!.text).toMatch(/acting on your own initiative/);
    expect(call.messages[0]!.content).toMatch(/^\[Event: Thomas just got home\.\]\n\[Context: .*\]\n\[Feedback: /);
  });

  it('its light changes are temporary looks, and what it says waits until Thomas is in the living room', async () => {
    const { runProactive } = await import('../../routes/voice');
    mockAxios({});
    script(
      turn(tool('adjust_lights', { target: 'Living Room', brightness: 30, colorTemp: 0, minutes: 90, reason: 'rainy evening' }),
           tool('say', { text: 'Made it cosy in here.' })),
      turn(text('dimmed the living room')),
    );
    await runProactive({ trigger: 'event', event: 'It started raining.' });
    expect(toolResults()).toMatchObject([{ ok: true }, { ok: true, delivered: 'when Thomas is home and in the living room' }]);

    const zones = (await request(ctx.app).get('/api/lighting/zones')).body;
    expect(Object.values(zones)[0]).toMatchObject({ control: 'assistant', reason: 'rainy evening' });
    expect(readConfig().notices?.items).toMatchObject([{ text: 'Made it cosy in here.', held: true }]);

    const { assistantLog } = await import('../../services/assistantLog');
    expect(assistantLog.list().at(-1)).toMatchObject({ trigger: 'event', request: 'It started raining.', reply: 'dimmed the living room' });
  });

  it('rules it makes are its own, announced with an Undo — and at most two new ones a week', async () => {
    const { runProactive } = await import('../../routes/voice');
    mockAxios({});
    const make = (name: string) => tool('create_rule', {
      name, time: '23:00', days: ['monday'], target: 'Living Room', action: 'turn_off', reason: 'you do this most nights',
    });
    script(turn(make('A'), make('B'), make('C')), turn(text('made rules')));
    await runProactive({ trigger: 'event', event: 'Nightly-ish.' });

    expect(toolResults()).toMatchObject([{ ok: true }, { ok: true }, { ok: false, error: expect.stringMatching(/already added 2 rules this week/) }]);
    expect(readConfig().rules?.map((r) => [r.name, r.createdBy])).toEqual([['A', 'assistant'], ['B', 'assistant']]);
    const notes = readConfig().notices!.items;
    expect(notes.map((n) => n.text)).toEqual([
      'I made a rule: "A" — you do this most nights.',
      'I made a rule: "B" — you do this most nights.',
    ]);
    expect(notes[0]!.undo).toEqual({ kind: 'rule', changeId: expect.any(String) });
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
