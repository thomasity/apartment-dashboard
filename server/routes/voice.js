const express   = require('express');
const Anthropic  = require('@anthropic-ai/sdk');

const router  = express.Router();
const client  = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const TOOLS = [
  {
    name: 'control_lights',
    description: 'Control the apartment lights. Can turn on/off, set brightness, and set color temperature for all lights or a specific room.',
    input_schema: {
      type: 'object',
      properties: {
        group:      { type: 'string',  description: 'Target group: "all" or a room name' },
        power:      { type: 'boolean', description: 'true = on, false = off. Omit to leave power unchanged.' },
        brightness: { type: 'number',  description: 'Brightness 1–100. Omit to leave unchanged.' },
        colorTemp:  { type: 'number',  description: 'Color temperature 0 (warm) – 100 (cool). Omit to leave unchanged.' },
      },
      required: ['group'],
    },
  },
  {
    name: 'control_music',
    description: 'Control Spotify playback in the apartment.',
    input_schema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['play', 'pause', 'next', 'previous'],
          description: 'Playback action to perform.',
        },
        volume: { type: 'number', description: 'Volume 0–100. Omit to leave unchanged.' },
      },
      required: ['action'],
    },
  },
  {
    name: 'control_tv',
    description: 'Control the TV via keypress commands.',
    input_schema: {
      type: 'object',
      properties: {
        key: {
          type: 'string',
          description: 'Key to press. Common values: "PowerOn", "PowerOff", "VolumeUp", "VolumeDown", "Mute", "Home", "Back", "Up", "Down", "Left", "Right", "Select".',
        },
      },
      required: ['key'],
    },
  },
  {
    name: 'launch_tv_app',
    description: 'Launch a specific app on the TV by name (e.g. Netflix, YouTube, Hulu, Disney+).',
    input_schema: {
      type: 'object',
      properties: {
        app_name: { type: 'string', description: 'The name of the app to launch.' },
      },
      required: ['app_name'],
    },
  },
  {
    name: 'play_spotify',
    description: "Play something on Spotify. Use type 'my_playlist' to play one of the user's saved playlists by name. Use type 'search' to search Spotify for an artist, song, genre, or mood and play the top result.",
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: "Playlist name (for my_playlist) or search terms (for search)." },
        type:  { type: 'string', enum: ['my_playlist', 'search'], description: "How to find the music." },
      },
      required: ['query', 'type'],
    },
    cache_control: { type: 'ephemeral' },
  },
];

const SYSTEM = [
  {
    type: 'text',
    text: `You are Jarvis, a voice assistant built into an apartment. You control lights, music, and the TV.

Keep responses short and conversational — one or two sentences at most. If you take an action, confirm it briefly. If you can't do something, say so simply.

The apartment has a lighting system with rooms. When the user says "the lights" without specifying a room, use group "all".`,
    cache_control: { type: 'ephemeral' },
  },
];

router.post('/chat', async (req, res) => {
  const { message } = req.body;
  if (!message?.trim()) return res.status(400).json({ error: 'No message provided' });

  try {
    // Agentic loop — Claude may call multiple tools before giving a final reply
    const messages = [{ role: 'user', content: message }];
    let reply = '';

    while (true) {
      const response = await client.messages.create({
        model:      'claude-haiku-4-5-20251001',
        max_tokens: 200,
        system:     SYSTEM,
        tools:      TOOLS,
        messages,
      });

      // Collect any text from this turn
      for (const block of response.content) {
        if (block.type === 'text') reply = block.text;
      }

      if (response.stop_reason !== 'tool_use') break;

      // Execute tool calls
      const toolResults = [];
      for (const block of response.content) {
        if (block.type !== 'tool_use') continue;
        const result = await executeTool(block.name, block.input);
        toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(result) });
      }

      // Feed results back for next turn
      messages.push({ role: 'assistant', content: response.content });
      messages.push({ role: 'user',      content: toolResults });
    }

    res.json({ reply });
  } catch (err) {
    console.error('[voice] error:', err.message);
    res.status(500).json({ error: 'Voice request failed' });
  }
});

async function executeTool(name, input) {
  const base = `http://localhost:${process.env.PORT || 3001}/api`;
  console.log(`[voice] tool → ${name}`, JSON.stringify(input));
  try {
    if (name === 'control_lights') {
      const { group, power, brightness, colorTemp } = input;
      if (power !== undefined) {
        await post(`${base}/lighting/power`, { group, on: power });
      }
      if (brightness !== undefined || colorTemp !== undefined) {
        await post(`${base}/lighting/set`, { group, ...(brightness !== undefined && { brightness }), ...(colorTemp !== undefined && { colorTemp }) });
      }
      return { ok: true };
    }

    if (name === 'control_music') {
      const { action, volume } = input;
      if (action) {
        await post(`${base}/spotify/${action}`);
      }
      if (volume !== undefined) {
        await post(`${base}/spotify/volume`, { volume });
      }
      return { ok: true };
    }

    if (name === 'control_tv') {
      await post(`${base}/tv/keypress/${encodeURIComponent(input.key)}`);
      return { ok: true };
    }

    if (name === 'launch_tv_app') {
      const appsRes = await fetch(`${base}/tv/apps`);
      const apps    = await appsRes.json();
      const app     = fuzzyMatch(apps, input.app_name);
      if (!app) return { error: `App "${input.app_name}" not found. Available: ${apps.map((a) => a.name).join(', ')}` };
      await post(`${base}/tv/launch/${app.id}`);
      return { ok: true, launched: app.name };
    }

    if (name === 'play_spotify') {
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
    }

    return { error: 'Unknown tool' };
  } catch (err) {
    console.error(`[voice] tool ${name} failed:`, err.message);
    return { error: err.message };
  }
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

router.post('/speak', async (req, res) => {
  const { text } = req.body;
  if (!text?.trim()) return res.status(400).json({ error: 'No text provided' });

  const voiceId = process.env.ELEVENLABS_VOICE_ID || 'pNInz6obpgDQGcFmaJgB';

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

    res.set('Content-Type', 'audio/mpeg');
    const buffer = await upstream.arrayBuffer();
    res.send(Buffer.from(buffer));
  } catch (err) {
    console.error('[voice] elevenlabs error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
