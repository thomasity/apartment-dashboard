const express  = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const crypto   = require('crypto');
const config   = require('../config');

const router = express.Router();
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── In-memory timer store (lost on restart — acceptable) ──────────────────────
let timerSeq = 0;
const timerMap = new Map(); // id → { handle, description, firesAt }

// ── TTS LRU cache ─────────────────────────────────────────────────────────────
const TTS_CACHE_MAX = 60;
const ttsCache      = new Map(); // key → Buffer  (Map preserves insertion order for LRU)

function getTts(key) {
  if (!ttsCache.has(key)) return null;
  const buf = ttsCache.get(key); // promote to most-recent
  ttsCache.delete(key);
  ttsCache.set(key, buf);
  return buf;
}

function setTts(key, buf) {
  if (ttsCache.has(key)) ttsCache.delete(key);
  ttsCache.set(key, buf);
  if (ttsCache.size > TTS_CACHE_MAX) ttsCache.delete(ttsCache.keys().next().value);
}

const TOOLS = [
  // ── Read ──────────────────────────────────────────────────────────────────
  {
    name: 'get_home_state',
    description: 'Read the current state of the apartment: light levels per room, what is playing on Spotify, TV status, and plant watering status. Call this before answering questions about current state or before targeting a specific room by name.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'get_plants_due',
    description: 'Get a list of all plants and their watering status — which are overdue, due today, or upcoming.',
    input_schema: { type: 'object', properties: {} },
  },

  // ── Memory ────────────────────────────────────────────────────────────────
  {
    name: 'remember',
    description: 'Store a preference or fact about the user that should persist across sessions. Use a short descriptive label and a plain-English value.',
    input_schema: {
      type: 'object',
      properties: {
        label: { type: 'string', description: 'Short key for this memory, e.g. "morning music", "movie mode".' },
        value: { type: 'string', description: 'What to remember, e.g. "jazz playlists", "dim lights to 20% warm + launch Netflix".' },
      },
      required: ['label', 'value'],
    },
  },
  {
    name: 'get_memories',
    description: "Retrieve all stored preferences and facts about the user. Call this when the user asks what you remember, or when a preference might be relevant.",
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'forget',
    description: 'Delete a single stored memory by its label. Use when the user asks you to forget or correct something specific.',
    input_schema: {
      type: 'object',
      properties: {
        label: { type: 'string', description: 'The exact label of the memory to delete.' },
      },
      required: ['label'],
    },
  },

  // ── Timers ────────────────────────────────────────────────────────────────
  {
    name: 'set_timer',
    description: 'Schedule an action to happen after a delay. Describe the action in plain English — Jarvis will execute it when the timer fires.',
    input_schema: {
      type: 'object',
      properties: {
        description: { type: 'string', description: 'What to do when the timer fires, e.g. "turn off all lights", "pause the music".' },
        delay_minutes: { type: 'number', description: 'How many minutes from now to wait.' },
      },
      required: ['description', 'delay_minutes'],
    },
  },
  {
    name: 'cancel_timers',
    description: 'Cancel all pending timers.',
    input_schema: { type: 'object', properties: {} },
  },

  // ── Lights ────────────────────────────────────────────────────────────────
  {
    name: 'control_lights',
    description: 'Control the apartment lights. Can turn on/off, set brightness, and set color temperature for all lights or a specific room. Call get_home_state first if you need to know room names or current levels.',
    input_schema: {
      type: 'object',
      properties: {
        group:      { type: 'string',  description: '"all" or a specific room name.' },
        power:      { type: 'boolean', description: 'true = on, false = off. Omit to leave power unchanged.' },
        brightness: { type: 'number',  description: 'Brightness 1–100. Omit to leave unchanged.' },
        colorTemp:  { type: 'number',  description: 'Color temperature 0 (warm) – 100 (cool). Omit to leave unchanged.' },
      },
      required: ['group'],
    },
  },

  // ── Music ─────────────────────────────────────────────────────────────────
  {
    name: 'control_music',
    description: 'Control Spotify playback: play, pause, skip, or set volume.',
    input_schema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['play', 'pause', 'next', 'previous'], description: 'Playback action.' },
        volume: { type: 'number', description: 'Volume 0–100. Omit to leave unchanged.' },
      },
      required: ['action'],
    },
  },
  {
    name: 'get_playlists',
    description: "Get all of the user's Spotify playlists by name. Call this when the user makes a vague music request (mood, vibe, activity) so you can pick the best matching playlist rather than guessing.",
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'play_spotify',
    description: "Play something on Spotify. Use type 'my_playlist' to play one of the user's saved playlists by name. Use type 'search' to search Spotify for an artist, song, genre, or mood.",
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Playlist name (for my_playlist) or search terms (for search).' },
        type:  { type: 'string', enum: ['my_playlist', 'search'] },
      },
      required: ['query', 'type'],
    },
  },
  {
    name: 'set_shuffle',
    description: 'Enable or disable Spotify shuffle.',
    input_schema: {
      type: 'object',
      properties: {
        state: { type: 'boolean', description: 'true = shuffle on, false = shuffle off.' },
      },
      required: ['state'],
    },
  },
  {
    name: 'set_repeat',
    description: 'Set Spotify repeat mode.',
    input_schema: {
      type: 'object',
      properties: {
        state: { type: 'string', enum: ['off', 'context', 'track'], description: '"off", "context" (repeat playlist), or "track" (repeat one).' },
      },
      required: ['state'],
    },
  },

  // ── TV ────────────────────────────────────────────────────────────────────
  {
    name: 'control_tv',
    description: 'Control the TV via keypress commands.',
    input_schema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Key to press: "PowerOn", "PowerOff", "VolumeUp", "VolumeDown", "Mute", "Home", "Back", "Up", "Down", "Left", "Right", "Select".' },
      },
      required: ['key'],
    },
  },
  {
    name: 'launch_tv_app',
    description: 'Launch a specific app on the TV by name (e.g. Netflix, YouTube, Disney+).',
    input_schema: {
      type: 'object',
      properties: {
        app_name: { type: 'string', description: 'The name of the app to launch.' },
      },
      required: ['app_name'],
    },
  },

  // ── Plants ────────────────────────────────────────────────────────────────
  {
    name: 'water_plant',
    description: 'Mark a plant as watered today.',
    input_schema: {
      type: 'object',
      properties: {
        plant_name: { type: 'string', description: 'Name of the plant to water (fuzzy matched).' },
      },
      required: ['plant_name'],
    },
  },

  // ── Voice ─────────────────────────────────────────────────────────────────
  {
    name: 'get_voices',
    description: 'Get all available voices and which one is currently active.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'set_voice',
    description: "Switch to a different voice by name. Call get_voices first to see available options.",
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Name of the voice to switch to.' },
      },
      required: ['name'],
    },
  },

  // ── Conversation flow ─────────────────────────────────────────────────────
  {
    name: 'end_conversation',
    description: 'Call this when the conversation is clearly complete — a task is done with no ambiguity, a factual question is answered, or the user said goodbye. Do NOT call it when you asked a question or need more input.',
    input_schema: { type: 'object', properties: {} },
    cache_control: { type: 'ephemeral' },
  },
];

const SYSTEM = [
  {
    type: 'text',
    text: `You are Jarvis, a voice assistant built into Thomas's apartment. You control the lights, music, TV, and plants. You have access to recent conversation history and can reference it naturally.

Each message begins with a [Context: ...] line showing the current time, weather, and what's playing. Use it to be contextually aware — greet appropriately, make time-sensitive suggestions, etc.

Tone and personality: adapt fully to the active Voice description in the context line. Let it shape your word choice, humor, energy level, and attitude — not just your speaking style but your whole character. If the voice is sarcastic, be sarcastic. If it's theatrical, be theatrical. Commit to it.

No filler phrases ("Sure!", "Of course!", "I've gone ahead and..."). Stay in character instead.

Response length: one sentence. Two only if genuinely necessary. Never list things out loud — this is a voice interface, not a text one. If you have multiple items to convey, pick the most relevant one or summarize.

When a request is vague, ask one short clarifying question rather than guessing or listing options. Then act on the answer.

For voices: ask what vibe they want → call get_voices, read ALL descriptions, pick the best match → switch → ask how it sounds in the new voice.

When to speak:
- Non-obvious results: one casual line. "Threw on Chill Vibes." "Netflix is up." "Timer's set."
- Questions: answer in one phrase. "The Weeknd." "Monstera's overdue."
- Clarification: one short question. "Which room?" "What kind of mood?"
- Errors: one line. "Couldn't find that one."

When to stay silent (reply with empty string ""):
- Simple commands with obvious results: lights on/off, pause, skip, volume, TV keypresses.

Tools:
- Call get_home_state before answering questions about current state, or to discover room names.
- When the user says "the lights" without a room, use group "all".
- Use remember to store things the user wants you to remember.
- Call get_memories when addressing Thomas personally, or when a request might match a stored preference (music taste, routines, favorite settings).
- Use set_timer for "turn off the lights in X minutes" style requests.
- Call end_conversation when you're clearly done — task completed, question answered, user said goodbye. If you asked a question or need more input, do NOT call it; the mic will stay open by default.`,
    cache_control: { type: 'ephemeral' },
  },
];

// Drives the Claude tool-use loop: send messages, execute any requested tools, feed the
// results back, and repeat until the model stops asking for tools. `messages` is mutated
// in place so callers can inspect the final transcript if they need to.
//
// When `watchEndConversation` is set, an `end_conversation` tool call is intercepted here
// (rather than dispatched to executeTool) and flips the returned `keepListening` to false —
// used by /chat to tell the client whether to keep the mic open.
async function runAgentLoop(messages, base, { maxTokens, watchEndConversation = false } = {}) {
  let reply         = '';
  let keepListening = true; // default: stay open; AI calls end_conversation to close

  while (true) {
    const response = await client.messages.create({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: maxTokens,
      system:     SYSTEM,
      tools:      TOOLS,
      messages,
    });

    for (const block of response.content) {
      if (block.type === 'text') reply = block.text;
    }

    if (response.stop_reason !== 'tool_use') break;

    const toolResults = [];
    for (const block of response.content) {
      if (block.type !== 'tool_use') continue;
      if (watchEndConversation && block.name === 'end_conversation') {
        keepListening = false;
        toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: '{}' });
        continue;
      }
      const result = await executeTool(block.name, block.input, base);
      toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(result) });
    }

    messages.push({ role: 'assistant', content: response.content });
    messages.push({ role: 'user',      content: toolResults });
  }

  return { reply, keepListening };
}

router.post('/chat', async (req, res) => {
  const { message, history = [], room = null } = req.body;
  if (!message?.trim()) return res.status(400).json({ error: 'No message provided' });

  try {
    const base    = `http://localhost:${process.env.PORT || 3001}/api`;
    const context = await buildContext(base, room);
    const firstMessage = context ? `${context}\n\n${message}` : message;

    const messages = [
      ...history.map((m) => ({ role: m.role, content: m.content })),
      { role: 'user', content: firstMessage },
    ];

    const { reply, keepListening } = await runAgentLoop(messages, base, {
      maxTokens: 300,
      watchEndConversation: true,
    });

    res.json({ reply, keepListening });
  } catch (err) {
    console.error('[voice] error:', err.message);
    res.status(500).json({ error: 'Voice request failed' });
  }
});

// ── Context injection ─────────────────────────────────────────────────────────

let spotifyContextCache = { data: null, at: 0 };
const SPOTIFY_CACHE_TTL = 30_000;

async function buildContext(base, room = null) {
  const now = new Date();
  const timeStr = now.toLocaleString('en-US', {
    weekday: 'long', hour: 'numeric', minute: '2-digit', hour12: true,
  });
  const parts = [timeStr];

  if (room) parts.push(room === 'tablet' ? 'Device: tablet' : `Room: ${room}`);

  const activeName = config.get('active_voice');
  const voices     = config.get('voices') || {};
  if (activeName && voices[activeName]?.description) {
    parts.push(`Voice: ${activeName} — ${voices[activeName].description}`);
  }

  try {
    const wRes = await fetch(`${base}/weather`);
    if (wRes.ok) {
      const w    = await wRes.json();
      const temp = w.current?.temperature_2m;
      const code = w.current?.weather_code;
      if (temp !== undefined) {
        const desc = wmoCondition(code);
        parts.push(`${Math.round(temp)}°F${desc ? `, ${desc}` : ''}`);
      }
    }
  } catch {}

  try {
    if (Date.now() - spotifyContextCache.at > SPOTIFY_CACHE_TTL) {
      const spRes = await fetch(`${base}/spotify/now-playing`);
      if (spRes.ok) spotifyContextCache = { data: await spRes.json(), at: Date.now() };
    }
    const sp    = spotifyContextCache.data;
    const track = (sp?.item ?? sp?.track)?.name;
    if (sp?.isPlaying && track) parts.push(`Spotify: ${track} playing`);
  } catch {}

  return `[Context: ${parts.join(' · ')}]`;
}

function wmoCondition(code) {
  if (code === undefined || code === null) return '';
  if (code === 0)              return 'clear';
  if (code <= 3)               return 'partly cloudy';
  if (code <= 9)               return 'foggy';
  if (code <= 19)              return 'drizzle';
  if (code <= 39)              return 'rainy';
  if (code <= 59)              return 'snowy';
  if (code <= 79)              return 'icy';
  if (code <= 84)              return 'heavy rain';
  if (code <= 99)              return 'stormy';
  return '';
}

// ── Tool execution ────────────────────────────────────────────────────────────

// One handler per entry in TOOLS, keyed by tool name — keeps each tool's implementation
// next to its neighbors instead of buried in a long if/else chain, and lets executeTool
// stay a thin, uniform dispatcher.
const toolHandlers = {
  async get_home_state(input, base) {
    const [lightsRes, spotifyRes, tvRes, plantsRes] = await Promise.all([
      fetch(`${base}/lighting/state`),
      fetch(`${base}/spotify/now-playing`),
      fetch(`${base}/tv/status`),
      fetch(`${base}/plants`),
    ]);
    const lights  = await lightsRes.json().catch(() => null);
    const spotify = await spotifyRes.json().catch(() => null);
    const tv      = await tvRes.json().catch(() => null);
    const plants  = await plantsRes.json().catch(() => []);

    return {
      lights: lights ? {
        rooms: Object.entries(lights.groups || {}).map(([roomName, vals]) => ({
          name:       roomName,
          brightness: vals.brightness,
          colorTemp:  vals.colorTemp,
          on:         !(lights.poweredOff || []).includes(roomName),
        })),
      } : null,
      music: spotify ? {
        isPlaying: spotify.isPlaying,
        track:     (spotify.item ?? spotify.track)?.name   ?? null,
        artist:    (spotify.item ?? spotify.track)?.artist ?? null,
        volume:    spotify.device?.volume ?? null,
        shuffle:   spotify.shuffle,
        repeat:    spotify.repeat,
      } : null,
      tv: tv ? { app: tv.appName, state: tv.playerState } : null,
      plants: plants.map((p) => {
        const days = daysUntil(p);
        return { name: p.name, status: plantStatus(days) };
      }),
    };
  },

  async get_plants_due(input, base) {
    const plantsRes = await fetch(`${base}/plants`);
    const plants    = await plantsRes.json();
    const all = plants.map((p) => {
      const days = daysUntil(p);
      return { name: p.name, status: plantStatus(days), urgent: days === null || days <= 0 };
    });
    return { plants: all, anyDue: all.some((p) => p.urgent) };
  },

  async remember(input) {
    const memories = config.get('memories') || {};
    memories[input.label] = input.value;
    config.set('memories', memories);
    return { ok: true, stored: input.label };
  },

  async get_memories() {
    const memories = config.get('memories') || {};
    const entries  = Object.entries(memories);
    if (!entries.length) return { memories: [], empty: true };
    return { memories: entries.map(([label, value]) => ({ label, value })) };
  },

  async forget(input) {
    const memories = config.get('memories') || {};
    if (!(input.label in memories)) return { error: `No memory found with label "${input.label}".` };
    delete memories[input.label];
    config.set('memories', memories);
    return { ok: true, forgotten: input.label };
  },

  async set_timer(input) {
    const id      = ++timerSeq;
    const ms      = Math.max(1, input.delay_minutes) * 60000;
    const firesAt = new Date(Date.now() + ms);
    const handle  = setTimeout(() => {
      timerMap.delete(id);
      runTimerAction(input.description).catch((err) =>
        console.error('[voice] timer action failed:', err.message)
      );
    }, ms);
    timerMap.set(id, { handle, description: input.description, firesAt });
    return { ok: true, id, description: input.description, firesAt: firesAt.toLocaleTimeString() };
  },

  async cancel_timers() {
    const cancelled = [];
    for (const [id, t] of timerMap) {
      clearTimeout(t.handle);
      cancelled.push(t.description);
      timerMap.delete(id);
    }
    return { ok: true, cancelled };
  },

  async control_lights(input, base) {
    const { group, power, brightness, colorTemp } = input;
    if (power !== undefined) {
      await post(`${base}/lighting/power`, { group, on: power });
    }
    if (brightness !== undefined || colorTemp !== undefined) {
      await post(`${base}/lighting/set`, {
        group,
        ...(brightness !== undefined && { brightness }),
        ...(colorTemp  !== undefined && { colorTemp }),
      });
    }
    return { ok: true };
  },

  async control_music(input, base) {
    const { action, volume } = input;
    if (action)               await post(`${base}/spotify/${action}`);
    if (volume !== undefined) await post(`${base}/spotify/volume`, { volume });
    return { ok: true };
  },

  async get_voices() {
    const voices      = config.get('voices') || {};
    const activeVoice = config.get('active_voice') || null;
    return {
      active: activeVoice,
      voices: Object.entries(voices).map(([n, v]) => ({ name: n, description: v.description, active: n === activeVoice })),
    };
  },

  async set_voice(input) {
    const voices = config.get('voices') || {};
    const match  = Object.keys(voices).find((n) => n.toLowerCase() === input.name.toLowerCase());
    if (!match) return { error: `Voice "${input.name}" not found. Available: ${Object.keys(voices).join(', ')}` };
    config.set('active_voice', match);
    return { ok: true, active: match };
  },

  async get_playlists(input, base) {
    const plRes     = await fetch(`${base}/spotify/playlists`);
    const playlists = await plRes.json();
    return { playlists: playlists.map((p) => ({ name: p.name, id: p.id, tracks: p.total })) };
  },

  async play_spotify(input, base) {
    if (input.type === 'my_playlist') {
      const plRes     = await fetch(`${base}/spotify/playlists`);
      const playlists = await plRes.json();
      const pl        = fuzzyMatch(playlists, input.query);
      if (!pl) return { error: `Playlist "${input.query}" not found.` };
      await post(`${base}/spotify/play`, { context_uri: pl.uri });
      return { ok: true, playing: pl.name };
    }
    if (input.type === 'search') {
      const searchRes = await fetch(`${base}/spotify/search?q=${encodeURIComponent(input.query)}`);
      const results   = await searchRes.json();
      const track     = results.tracks?.[0];
      const playlist  = results.playlists?.[0];
      if (track) {
        await post(`${base}/spotify/play`, { uris: [track.uri] });
        return { ok: true, playing: `${track.name} by ${track.artist}` };
      }
      if (playlist) {
        await post(`${base}/spotify/play`, { context_uri: playlist.uri });
        return { ok: true, playing: playlist.name };
      }
      return { error: 'No results found.' };
    }
    // Unrecognized type — same fallback as an unrecognized tool name.
    return { error: 'Unknown tool' };
  },

  async set_shuffle(input, base) {
    await post(`${base}/spotify/shuffle`, { state: input.state });
    return { ok: true };
  },

  async set_repeat(input, base) {
    await post(`${base}/spotify/repeat`, { state: input.state });
    return { ok: true };
  },

  async control_tv(input, base) {
    await post(`${base}/tv/keypress/${encodeURIComponent(input.key)}`);
    return { ok: true };
  },

  async launch_tv_app(input, base) {
    const appsRes = await fetch(`${base}/tv/apps`);
    const apps    = await appsRes.json();
    const app     = fuzzyMatch(apps, input.app_name);
    if (!app) return { error: `App "${input.app_name}" not found. Available: ${apps.map((a) => a.name).join(', ')}` };
    await post(`${base}/tv/launch/${app.id}`);
    return { ok: true, launched: app.name };
  },

  async water_plant(input, base) {
    const plantsRes = await fetch(`${base}/plants`);
    const plants    = await plantsRes.json();
    const plant     = fuzzyMatch(plants, input.plant_name);
    if (!plant) return { error: `Plant "${input.plant_name}" not found. Available: ${plants.map((p) => p.name).join(', ')}` };
    const today = new Date().toISOString().slice(0, 10);
    await put(`${base}/plants/${plant.id}`, { lastWatered: today });
    return { ok: true, watered: plant.name };
  },
};

async function executeTool(name, input, base) {
  base = base || `http://localhost:${process.env.PORT || 3001}/api`;
  console.log(`[voice] tool → ${name}`, JSON.stringify(input));

  const handler = toolHandlers[name];
  if (!handler) return { error: 'Unknown tool' };

  try {
    return await handler(input, base);
  } catch (err) {
    console.error(`[voice] tool ${name} failed:`, err.message);
    return { error: err.message };
  }
}

// ── Timer execution ───────────────────────────────────────────────────────────

async function runTimerAction(description) {
  const base = `http://localhost:${process.env.PORT || 3001}/api`;
  console.log(`[voice] timer fired: ${description}`);
  const messages = [{ role: 'user', content: `Timer fired. Execute this action now: ${description}` }];
  await runAgentLoop(messages, base, { maxTokens: 100 });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function daysUntil(plant) {
  if (!plant.lastWatered) return null;
  const next = new Date(plant.lastWatered);
  next.setDate(next.getDate() + plant.intervalDays);
  next.setHours(0, 0, 0, 0);
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return Math.ceil((next - now) / 86400000);
}

function plantStatus(days) {
  if (days === null) return 'never watered';
  if (days < 0)      return `${Math.abs(days)}d overdue`;
  if (days === 0)    return 'due today';
  return `due in ${days}d`;
}

function fuzzyMatch(items, query) {
  const q = query.toLowerCase().trim();
  return items.find((i) => i.name.toLowerCase() === q)
      || items.find((i) => i.name.toLowerCase().includes(q))
      || items.find((i) => q.includes(i.name.toLowerCase()));
}

function post(url, body) {
  return fetch(url, {
    method:  'POST',
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body:    body ? JSON.stringify(body) : undefined,
  });
}

function put(url, body) {
  return fetch(url, {
    method:  'PUT',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  });
}

// ── TTS proxy ─────────────────────────────────────────────────────────────────

router.post('/speak', async (req, res) => {
  const { text } = req.body;
  if (!text?.trim()) return res.status(400).json({ error: 'No text provided' });

  const activeName = config.get('active_voice');
  const voices     = config.get('voices') || {};
  const voiceId    = (activeName && voices[activeName]?.id)
    || process.env.ELEVENLABS_VOICE_ID
    || 'pNInz6obpgDQGcFmaJgB';

  const cacheKey = crypto.createHash('md5').update(voiceId + text).digest('hex');
  const cached   = getTts(cacheKey);
  if (cached) {
    res.set('Content-Type', 'audio/mpeg');
    return res.send(cached);
  }

  try {
    const upstream = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
      {
        method:  'POST',
        headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          model_id: 'eleven_turbo_v2_5',
          voice_settings: { stability: 0.5, similarity_boost: 0.75 },
        }),
      }
    );

    if (!upstream.ok) {
      const msg = await upstream.text();
      return res.status(upstream.status).json({ error: msg });
    }

    const buffer = Buffer.from(await upstream.arrayBuffer());
    setTts(cacheKey, buffer);
    res.set('Content-Type', 'audio/mpeg');
    res.send(buffer);
  } catch (err) {
    console.error('[voice] elevenlabs error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
