import express from 'express';
import Anthropic from '@anthropic-ai/sdk';
import crypto from 'crypto';
import * as config from '../config';
import { apiBase, errorMessage, toHHMM } from '../util';
import { assistantLog } from '../services/assistantLog';
import * as patternsSvc from '../services/patterns';
import * as rulesSvc from '../services/rules';
import { history, ruleSummary, type Category } from '../services/history';
import type { AssistantToolCall, LightingState, Rule, RoomsMap, ZoneExplanation } from '../types';

const router = express.Router();
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const;
type DayName = typeof DAY_NAMES[number];

// ── In-memory timer store (lost on restart — acceptable) ──────────────────────
interface PendingTimer { handle: NodeJS.Timeout; description: string; firesAt: Date }
let timerSeq = 0;
const timerMap = new Map<number, PendingTimer>();

// ── TTS LRU cache ─────────────────────────────────────────────────────────────
const TTS_CACHE_MAX = 60;
const ttsCache      = new Map<string, Buffer>(); // Map preserves insertion order for LRU

function getTts(key: string): Buffer | null {
  const buf = ttsCache.get(key);
  if (!buf) return null;
  ttsCache.delete(key); // promote to most-recent
  ttsCache.set(key, buf);
  return buf;
}

function setTts(key: string, buf: Buffer): void {
  ttsCache.delete(key);
  ttsCache.set(key, buf);
  if (ttsCache.size > TTS_CACHE_MAX) {
    const oldest = ttsCache.keys().next().value;
    if (oldest !== undefined) ttsCache.delete(oldest);
  }
}

const TOOLS: Anthropic.Tool[] = [
  // ── Read ──────────────────────────────────────────────────────────────────
  {
    name: 'get_home_state',
    description: 'Read the current state of the apartment: light levels per room, what is playing on Spotify and TV Status. Call this before answering questions about current state or before targeting a specific room by name.',
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

  // ── Routines ──────────────────────────────────────────────────────────────
  {
    name: 'remember_routine',
    description: 'Store a recurring routine — something that happens on certain days within a certain time window, e.g. "weekday mornings I\'m getting ready for work." The current time/day is checked against all stored routines on every message, and any matching one is added to context automatically. Use a label that already exists to overwrite/update that routine.',
    input_schema: {
      type: 'object',
      properties: {
        label:       { type: 'string', description: 'Short key for this routine, e.g. "weekday mornings", "sunday wind-down".' },
        days:        { type: 'array', items: { type: 'string', enum: [...DAY_NAMES] }, description: 'Days this routine applies on.' },
        start_time:  { type: 'string', description: '24-hour "HH:MM" — start of the window, e.g. "07:00".' },
        end_time:    { type: 'string', description: '24-hour "HH:MM" — end of the window, e.g. "08:30".' },
        description: { type: 'string', description: 'What\'s going on and how to behave, e.g. "getting ready for work — keep responses terse, skip small talk."' },
      },
      required: ['label', 'days', 'start_time', 'end_time', 'description'],
    },
  },
  {
    name: 'get_routines',
    description: 'Retrieve all stored routines. Call this when the user asks what routines you know about, or wants to review/adjust one.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'forget_routine',
    description: 'Delete a single stored routine by its label. Use when the user asks you to forget or correct one.',
    input_schema: {
      type: 'object',
      properties: {
        label: { type: 'string', description: 'The exact label of the routine to delete.' },
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
        group:      { type: 'string',  description: '"all", a room name, or a single light\'s name (names from get_home_state).' },
        power:      { type: 'boolean', description: 'true = on, false = off. Omit to leave power unchanged.' },
        brightness: { type: 'number',  description: 'Brightness 1–100. Omit to leave unchanged.' },
        colorTemp:  { type: 'number',  description: 'Color temperature 0 (warm) – 100 (cool). Omit to leave unchanged.' },
      },
      required: ['group'],
    },
  },
  {
    name: 'get_patterns',
    description: "Thomas's habits, worked out each night from the last four weeks of logs: when his day starts and ends, when he leaves and gets home, the lights he sets, what he plays and when, TV — each with its usual time and how often. Also what he asks the assistant most and what keeps failing. Use it to understand vague requests (\"the usual\", \"my morning music\") or questions about his routine.",
    input_schema: {
      type: 'object',
      properties: { days: { type: 'string', enum: ['weekdays', 'weekends', 'both'], description: 'Default both.' } },
    },
  },
  {
    name: 'get_activity',
    description: 'What actually happened recently, from the logs, as timestamped lines: lights (who changed what), presence (rooms occupied/empty), home (Thomas leaving/arriving, from his phone), music (with Spotify ids to play again), tv, assistant (past requests and failures), rules (changes, with change ids for undo_rule_change). Use for "what was that song last night", "when did I get home", "what did you change".',
    input_schema: {
      type: 'object',
      properties: {
        categories: { type: 'array', items: { type: 'string', enum: ['lights', 'presence', 'home', 'music', 'tv', 'assistant', 'rules'] }, description: 'Default all.' },
        hours:      { type: 'number', description: 'How far back. Default 24, up to 720 (30 days).' },
        room:       { type: 'string', description: 'Narrow lights/presence to one room.' },
        limit:      { type: 'number', description: 'Most recent N lines. Default 25, up to 100.' },
      },
    },
  },

  // ── Rules ─────────────────────────────────────────────────────────────────
  {
    name: 'list_rules',
    description: 'All lighting rules with their ids, times, days and what they do, plus how many there are against the limit.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'create_rule',
    description: 'Add a lighting rule. Check list_rules first: prefer editing a similar rule (same room, nearby time) over adding another. At the limit this fails — merge or delete a rule first. Always give a reason.',
    input_schema: {
      type: 'object',
      properties: {
        name:           { type: 'string' },
        time:           { type: 'string', description: '"HH:MM" 24-hour, "sunrise" or "sunset".' },
        end:            { type: 'string', description: 'Optional end, same format — the rule then holds until it (a window), e.g. Bedtime 22:30–07:00.' },
        days:           { type: 'array', items: { type: 'string', enum: [...DAY_NAMES] } },
        target:         { type: 'string', description: '"all", a room name, or a light name.' },
        action:         { type: 'string', enum: ['turn_on', 'turn_off', 'set_look', 'auto'], description: 'turn_on (optionally with brightness/colorTemp), turn_off, set_look (change lights that are on), auto (follow the daylight curve).' },
        brightness:     { type: 'number', description: '1–100, for turn_on / set_look.' },
        colorTemp:      { type: 'number', description: '0 warm – 100 cool, for turn_on / set_look.' },
        motion:         { type: 'string', enum: ['ignore', 'normal', 'night_light'], description: 'Windows only: what motion may do while the rule holds.' },
        override_manual:{ type: 'boolean', description: 'Apply even to rooms Thomas has adjusted by hand. Default false.' },
        reason:         { type: 'string', description: 'Why — shown in the rule history.' },
      },
      required: ['name', 'time', 'days', 'target', 'action', 'reason'],
    },
  },
  {
    name: 'update_rule',
    description: 'Change a rule (any rule, Thomas\'s or yours). Only pass what changes. enabled:false pauses it. Always give a reason.',
    input_schema: {
      type: 'object',
      properties: {
        rule_id:        { type: 'string' },
        name:           { type: 'string' },
        time:           { type: 'string' },
        end:            { type: 'string', description: 'A new end, or "none" to make it a one-off moment.' },
        days:           { type: 'array', items: { type: 'string', enum: [...DAY_NAMES] } },
        target:         { type: 'string' },
        action:         { type: 'string', enum: ['turn_on', 'turn_off', 'set_look', 'auto'] },
        brightness:     { type: 'number' },
        colorTemp:      { type: 'number' },
        motion:         { type: 'string', enum: ['ignore', 'normal', 'night_light'] },
        override_manual:{ type: 'boolean' },
        enabled:        { type: 'boolean' },
        reason:         { type: 'string' },
      },
      required: ['rule_id', 'reason'],
    },
  },
  {
    name: 'delete_rule',
    description: 'Delete a rule. It stays restorable for 30 days (undo_rule_change). Always give a reason.',
    input_schema: {
      type: 'object',
      properties: { rule_id: { type: 'string' }, reason: { type: 'string' } },
      required: ['rule_id', 'reason'],
    },
  },
  {
    name: 'undo_rule_change',
    description: 'Reverse one rule change by its change id (from get_activity with category rules): brings a deleted rule back, puts an edit back, or removes a new rule.',
    input_schema: {
      type: 'object',
      properties: { change_id: { type: 'string' } },
      required: ['change_id'],
    },
  },
  {
    name: 'explain_lights',
    description: 'Explain why lights are the way they are, or why they did or didn\'t turn on/off: who is in control (Thomas by hand, a rule, motion, Auto), what is holding automation back (motion cooldown, a rule ignoring motion, an unreachable bulb) and what happened recently. Use for any "why" question about the lights.',
    input_schema: {
      type: 'object',
      properties: {
        group: { type: 'string', description: 'A room or light name. Omit for every room.' },
      },
    },
  },
  {
    name: 'resume_automation',
    description: 'Hand lights back to automation: ends a manual adjustment (so rules and Auto take over again) and lets the motion sensor switch the room on again after it was turned off by hand. Use for "go back to normal", "let the sensor work again", "stop overriding".',
    input_schema: {
      type: 'object',
      properties: {
        group: { type: 'string', description: '"all", a room name, or a light name.' },
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
    description: "Play something on Spotify. 'my_playlist': one of Thomas's playlists by name. 'search': search Spotify — say what kind of result to play (a playlist keeps going, which suits moods and genres; a song plays on through its album). 'uri': play an exact Spotify id from get_activity or get_patterns (pass from_uri too to continue the same playlist/album). 'liked_songs': his Liked Songs.",
    input_schema: {
      type: 'object',
      properties: {
        type:     { type: 'string', enum: ['my_playlist', 'search', 'uri', 'liked_songs'] },
        query:    { type: 'string', description: 'Playlist name (my_playlist) or search terms (search).' },
        kind:     { type: 'string', enum: ['playlist', 'song', 'album', 'podcast'], description: 'search only: what to play. Default playlist.' },
        uri:      { type: 'string', description: 'uri only: a spotify:track/album/playlist/episode/show id.' },
        from_uri: { type: 'string', description: 'uri only, with a track: the playlist/album it was playing from.' },
      },
      required: ['type'],
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

const SYSTEM: Anthropic.TextBlockParam[] = [
  {
    type: 'text',
    text: `You are a voice assistant built into Thomas's apartment. You control the lights, music, and TV. You have access to recent conversation history and can reference it naturally.

Each message begins with a [Context: ...] line showing the current time, weather, and what's playing. Use it to be contextually aware — greet appropriately, make time-sensitive suggestions, etc.

Tone and personality: adapt fully to the active Voice description in the context line. Let it shape your word choice, humor, energy level, and attitude — not just your speaking style but your whole character. If the voice is sarcastic, be sarcastic. If it's theatrical, be theatrical. Commit to it.

No filler phrases ("Sure!", "Of course!", "I've gone ahead and..."). Stay in character instead.

Response length: one sentence. Two only if genuinely necessary. Never list things out loud — this is a voice interface, not a text one. If you have multiple items to convey, pick the most relevant one or summarize.

When a request is vague, ask one short clarifying question rather than guessing or listing options. Then act on the answer.

For voices: ask what vibe they want → call get_voices, read ALL descriptions, pick the best match → switch → ask how it sounds in the new voice.

When to speak:
- Non-obvious results: one casual line. "Threw on Chill Vibes." "Netflix is up." "Timer's set."
- Questions: answer in one phrase. "The Weeknd." "72 and sunny."
- Clarification: one short question. "Which room?" "What kind of mood?"
- Errors: one line. "Couldn't find that one."

When to stay silent (reply with empty string ""):
- Simple commands with obvious results: lights on/off, pause, skip, volume, TV keypresses.

Tools:
- Call get_home_state before answering questions about current state, or to discover room names.
- For "why" questions about the lights ("why are the lights so dim?", "why didn't the light come on?"), call explain_lights and answer from its reasons/blocked in one sentence. If Thomas then wants things back to normal, call resume_automation.
- Changing the lights by voice counts as a manual adjustment: it holds until the room is turned off.
- When the user says "the lights" without a room, use group "all".
- Use remember to store things the user wants you to remember.
- Call get_memories when addressing Thomas personally, or when a request might match a stored preference (music taste, favorite settings).
- If the current time/day matches a stored routine, the context line will show it (e.g. "Routine: getting ready for work") — let it shape your tone and assumptions without being told explicitly.
- When Thomas describes a recurring pattern in his day ("weekday mornings I'm rushing out the door", "I wind down around 10 on Sundays"), use remember_routine to store it with the right days/time window. Use get_routines if he asks what you know about his schedule, and forget_routine to remove or let him redefine one.
- Use set_timer for "turn off the lights in X minutes" style requests.
- The context line may include "Usually now: …" — what Thomas normally does around this time. Use it to resolve vague requests ("put something on" → his usual playlist for now, via play_spotify type uri with the from_uri from get_patterns). Don't recite it.
- get_patterns for his routine and habits; get_activity for what actually happened ("what was that song last night?" — then play it again with its uri).
- Music: for a mood or genre, search with kind playlist so it keeps playing; for a specific song, kind song; for an album, kind album.
- Rules: you may create, change and delete any lighting rule — Thomas wants you to look after them. Before creating, call list_rules and prefer adjusting a similar rule over adding one. There's a limit; at it, merge or remove a rule first. Always pass a reason. After changing rules, say in one line what you changed. If he wants a change undone, find its change id with get_activity (category rules) and call undo_rule_change.
- When Thomas describes something he wants to happen regularly ("turn the lights off at 11 on weeknights"), make it a rule rather than a one-off.
- Call end_conversation when you're clearly done — task completed, question answered, user said goodbye. If you asked a question or need more input, do NOT call it; the mic will stay open by default.`,
    cache_control: { type: 'ephemeral' },
  },
];

interface AgentLoopOptions {
  maxTokens:             number;
  watchEndConversation?: boolean;
}

// Drives the Claude tool-use loop: send messages, execute any requested tools, feed the
// results back, and repeat until the model stops asking for tools. `messages` is mutated
// in place so callers can inspect the final transcript if they need to.
//
// When `watchEndConversation` is set, an `end_conversation` tool call is intercepted here
// (rather than dispatched to executeTool) and flips the returned `keepListening` to false —
// used by /chat to tell the client whether to keep the mic open.
async function runAgentLoop(
  messages: Anthropic.MessageParam[],
  base: string,
  { maxTokens, watchEndConversation = false }: AgentLoopOptions,
): Promise<{ reply: string; keepListening: boolean; tools: AssistantToolCall[] }> {
  let reply         = '';
  let keepListening = true; // default: stay open; AI calls end_conversation to close
  const tools: AssistantToolCall[] = [];

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

    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const block of response.content) {
      if (block.type !== 'tool_use') continue;
      if (watchEndConversation && block.name === 'end_conversation') {
        keepListening = false;
        toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: '{}' });
        continue;
      }
      const result = await executeTool(block.name, block.input, base);
      tools.push(toolCall(block.name, block.input, result));
      toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(result) });
    }

    messages.push({ role: 'assistant', content: response.content });
    messages.push({ role: 'user',      content: toolResults });
  }

  return { reply, keepListening, tools };
}

/** A tool call for the assistant log: failed if the result says so ({ ok: false } / { error }). */
function toolCall(name: string, input: unknown, result: unknown): AssistantToolCall {
  const r = (result ?? {}) as { ok?: unknown; error?: unknown };
  const error = typeof r.error === 'string' ? r.error : undefined;
  return { name, input, ok: r.ok !== false && !error, ...(error && { error }) };
}

interface ChatBody {
  message?: string;
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
  room?:    string | null;
}

router.post('/chat', async (req, res) => {
  const { message, history = [], room = null } = req.body as ChatBody;
  if (!message?.trim()) return res.status(400).json({ error: 'No message provided' });

  try {
    const base    = apiBase();
    const context = await buildContext(base, room);
    const firstMessage = context ? `${context}\n\n${message}` : message;

    const messages: Anthropic.MessageParam[] = [
      ...history.map((m) => ({ role: m.role, content: m.content })),
      { role: 'user', content: firstMessage },
    ];

    const { reply, keepListening, tools } = await runAgentLoop(messages, base, {
      maxTokens: 300,
      watchEndConversation: true,
    });

    assistantLog.record({ trigger: 'voice', device: room, request: message, reply, tools });
    res.json({ reply, keepListening });
  } catch (err) {
    console.error('[voice] error:', errorMessage(err));
    assistantLog.record({ trigger: 'voice', device: room, request: message, reply: '', tools: [], error: errorMessage(err) });
    res.status(500).json({ error: 'Voice request failed' });
  }
});

function voicesSummary() {
  const voices      = config.get('voices') ?? {};
  const activeVoice = config.get('active_voice') || null;
  return {
    active: activeVoice,
    voices: Object.entries(voices).map(([n, v]) => ({ name: n, description: v.description, active: n === activeVoice })),
  };
}

router.get('/voices', (_req, res) => {
  res.json(voicesSummary());
});

// ── Internal API response shapes (what our own routes return) ─────────────────

interface NowPlayingLite {
  isPlaying: boolean;
  shuffle:   boolean;
  repeat:    string;
  item?:     { name?: string; artist?: string | null } | null;
  device?:   { volume?: number };
}
interface WeatherLite { current?: { temperature_2m?: number; weather_code?: number } }
interface TvStatusLite { appName: string | null; playerState: string }
interface NamedItem { name: string }
interface PlaylistLite extends NamedItem { id: string; uri: string; total: number }
interface TvAppLite extends NamedItem { id: string }
interface SearchLite {
  tracks?:    Array<{ uri: string; name: string; artist: string; albumUri: string | null }>;
  albums?:    Array<{ uri: string; name: string; artist: string }>;
  playlists?: Array<{ uri: string; name: string }>;
  episodes?:  Array<{ uri: string; name: string; artist: string | null }>;
}

// ── Rules, in the assistant's terms ───────────────────────────────────────────

type RuleToolAction = 'turn_on' | 'turn_off' | 'set_look' | 'auto';

interface RuleToolInput {
  name?:            string;
  time?:            string;
  end?:             string;
  days?:            DayName[];
  target?:          string;
  action?:          RuleToolAction;
  brightness?:      number;
  colorTemp?:       number;
  motion?:          'ignore' | 'normal' | 'night_light';
  override_manual?: boolean;
}

/** The tool's simple fields as a (partial) rule, as the rules API takes it. */
function toRule(input: RuleToolInput, existing?: Rule): Record<string, unknown> {
  const rule: Record<string, unknown> = {};
  if (input.name !== undefined) rule.name = input.name;
  if (input.time !== undefined) rule.time = input.time;
  if (input.end  !== undefined) rule.end  = input.end === 'none' ? null : input.end;
  if (input.days !== undefined) rule.days = input.days.map((d) => DAY_NAMES.indexOf(d)).filter((i) => i >= 0);
  if (input.override_manual !== undefined) rule.overrideManual = input.override_manual;

  if (input.action || input.target || input.brightness !== undefined || input.colorTemp !== undefined) {
    const group = input.target ?? existing?.action.group ?? 'all';
    const look  = {
      brightness: input.brightness ?? existing?.action.brightness ?? 70,
      colorTemp:  input.colorTemp  ?? existing?.action.colorTemp  ?? 30,
    };
    const action = input.action ?? (
        existing?.action.type === 'power' ? (existing.action.on ? 'turn_on' : 'turn_off')
      : existing?.action.config === 'auto' ? 'auto' : 'set_look');
    const withLook = input.brightness !== undefined || input.colorTemp !== undefined || existing?.action.config === 'scene';
    rule.action =
        action === 'turn_off' ? { type: 'power', group, on: false }
      : action === 'turn_on'  ? { type: 'power', group, on: true, config: withLook ? 'scene' : 'none', ...(withLook && look) }
      : action === 'auto'     ? { type: 'reconfigure', group, config: 'auto' }
      : { type: 'reconfigure', group, config: 'scene', ...look };
  }
  if (input.motion) {
    rule.presence = input.motion === 'night_light'
      ? { mode: 'custom', brightness: 10, colorTemp: 0, vacantAfterMinutes: 2 }
      : { mode: input.motion };
  }
  return rule;
}

/** A failed internal call's message, or null when it worked. */
async function failure(res: globalThis.Response): Promise<string | null> {
  if (res.ok) return null;
  const body = await res.json().catch(() => ({})) as { error?: string };
  return body.error ?? `HTTP ${res.status}`;
}

const at = (ms: number): string =>
  new Date(ms).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' });

// ── Context injection ─────────────────────────────────────────────────────────

let spotifyContextCache: { data: NowPlayingLite | null; at: number } = { data: null, at: 0 };
const SPOTIFY_CACHE_TTL = 30_000;

async function buildContext(base: string, room: string | null = null): Promise<string> {
  const now = new Date();
  const timeStr = now.toLocaleString('en-US', {
    weekday: 'long', hour: 'numeric', minute: '2-digit', hour12: true,
  });
  const parts = [timeStr];

  if (room) parts.push(room === 'tablet' ? 'Device: tablet' : `Room: ${room}`);

  const routine = activeRoutine(now);
  if (routine) parts.push(`Routine: ${routine}`);

  const usual = usuallyNow(now);
  if (usual) parts.push(`Usually now: ${usual}`);

  const activeName = config.get('active_voice');
  const voice      = activeName ? config.get('voices')?.[activeName] : undefined;
  if (voice?.description) {
    parts.push(`Voice: ${activeName} — ${voice.description}`);
  }

  try {
    const wRes = await fetch(`${base}/weather`);
    if (wRes.ok) {
      const w    = await wRes.json() as WeatherLite;
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
      if (spRes.ok) spotifyContextCache = { data: await spRes.json() as NowPlayingLite | null, at: Date.now() };
    }
    const sp    = spotifyContextCache.data;
    const track = sp?.item?.name;
    if (sp?.isPlaying && track) parts.push(`Spotify: ${track} playing`);
  } catch {}

  return `[Context: ${parts.join(' · ')}]`;
}

function wmoCondition(code: number | undefined | null): string {
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

/** Input shape for each tool, matching its input_schema in TOOLS. */
interface ToolInputs {
  get_home_state:   Record<string, never>;
  remember:         { label: string; value: string };
  get_memories:     Record<string, never>;
  forget:           { label: string };
  remember_routine: { label: string; days: DayName[]; start_time: string; end_time: string; description: string };
  get_routines:     Record<string, never>;
  forget_routine:   { label: string };
  set_timer:        { description: string; delay_minutes: number };
  cancel_timers:    Record<string, never>;
  control_lights:   { group: string; power?: boolean; brightness?: number; colorTemp?: number };
  explain_lights:   { group?: string };
  resume_automation: { group: string };
  control_music:    { action: 'play' | 'pause' | 'next' | 'previous'; volume?: number };
  get_voices:       Record<string, never>;
  set_voice:        { name: string };
  get_playlists:    Record<string, never>;
  play_spotify:     { type: 'my_playlist' | 'search' | 'uri' | 'liked_songs'; query?: string; kind?: 'playlist' | 'song' | 'album' | 'podcast'; uri?: string; from_uri?: string };
  get_patterns:     { days?: 'weekdays' | 'weekends' | 'both' };
  get_activity:     { categories?: Category[]; hours?: number; room?: string; limit?: number };
  list_rules:       Record<string, never>;
  create_rule:      RuleToolInput & { name: string; time: string; days: DayName[]; target: string; action: RuleToolAction; reason: string };
  update_rule:      RuleToolInput & { rule_id: string; enabled?: boolean; reason: string };
  delete_rule:      { rule_id: string; reason: string };
  undo_rule_change: { change_id: string };
  set_shuffle:      { state: boolean };
  set_repeat:       { state: 'off' | 'context' | 'track' };
  control_tv:       { key: string };
  launch_tv_app:    { app_name: string };
}

type ToolHandlers = { [K in keyof ToolInputs]: (input: ToolInputs[K], base: string) => Promise<unknown> };

// One handler per entry in TOOLS, keyed by tool name — keeps each tool's implementation
// next to its neighbors instead of buried in a long if/else chain, and lets executeTool
// stay a thin, uniform dispatcher.
const toolHandlers: ToolHandlers = {
  async get_home_state(_input, base) {
    const [lightsRes, roomsRes, spotifyRes, tvRes] = await Promise.all([
      fetch(`${base}/lighting/state`),
      fetch(`${base}/lighting/rooms`),
      fetch(`${base}/spotify/now-playing`),
      fetch(`${base}/tv/status`),
    ]);
    const lights  = await lightsRes.json().catch(() => null)  as LightingState | null;
    const rooms   = await roomsRes.json().catch(() => ({}))   as RoomsMap;
    const spotify = await spotifyRes.json().catch(() => null) as NowPlayingLite | null;
    const tv      = await tvRes.json().catch(() => null)      as TvStatusLite | null;
    const playing = spotify?.item;

    // Rooms with their lights, plus any light not in a room — by name only (the lighting
    // API resolves names), and every name here is a valid control_lights group.
    const describeLight = (id: string) => {
      const vals = lights?.groups[id];
      return vals && {
        name:       vals.label,
        brightness: vals.brightness,
        colorTemp:  vals.colorTemp,
        on:         !(lights?.poweredOff ?? []).includes(id),
      };
    };
    const inARoom = new Set(Object.values(rooms).flatMap((r) => r.devices));

    return {
      lights: lights ? {
        rooms: Object.values(rooms).map((room) => ({
          name:   room.name,
          lights: room.devices.map(describeLight).filter(Boolean),
        })),
        unassigned: Object.keys(lights.groups).filter((id) => !inARoom.has(id)).map(describeLight),
      } : null,
      music: spotify ? {
        isPlaying: spotify.isPlaying,
        track:     playing?.name   ?? null,
        artist:    playing?.artist ?? null,
        volume:    spotify.device?.volume ?? null,
        shuffle:   spotify.shuffle,
        repeat:    spotify.repeat,
      } : null,
      tv: tv ? { app: tv.appName, state: tv.playerState } : null,
    };
  },

  async remember(input) {
    const memories = config.get('memories') ?? {};
    memories[input.label] = input.value;
    config.set('memories', memories);
    return { ok: true, stored: input.label };
  },

  async get_memories() {
    const entries = Object.entries(config.get('memories') ?? {});
    if (!entries.length) return { memories: [], empty: true };
    return { memories: entries.map(([label, value]) => ({ label, value })) };
  },

  async forget(input) {
    const memories = config.get('memories') ?? {};
    if (!(input.label in memories)) return { error: `No memory found with label "${input.label}".` };
    delete memories[input.label];
    config.set('memories', memories);
    return { ok: true, forgotten: input.label };
  },

  async remember_routine(input) {
    const { label, days, start_time, end_time, description } = input;
    const dayIndices = days
      .map((d) => DAY_NAMES.indexOf(d.toLowerCase() as DayName))
      .filter((i) => i !== -1);
    const routines = config.get('routines') ?? {};
    routines[label] = { days: dayIndices, start: start_time, end: end_time, description };
    config.set('routines', routines);
    return { ok: true, stored: label };
  },

  async get_routines() {
    const entries = Object.entries(config.get('routines') ?? {});
    if (!entries.length) return { routines: [], empty: true };
    return {
      routines: entries.map(([label, r]) => ({
        label,
        days: r.days.map((i) => DAY_NAMES[i]),
        window: `${r.start}–${r.end}`,
        description: r.description,
      })),
    };
  },

  async forget_routine(input) {
    const routines = config.get('routines') ?? {};
    if (!(input.label in routines)) return { error: `No routine found with label "${input.label}".` };
    delete routines[input.label];
    config.set('routines', routines);
    return { ok: true, forgotten: input.label };
  },

  async set_timer(input) {
    const id      = ++timerSeq;
    const ms      = Math.max(1, input.delay_minutes) * 60000;
    const firesAt = new Date(Date.now() + ms);
    const handle  = setTimeout(() => {
      timerMap.delete(id);
      runTimerAction(input.description).catch((err) =>
        console.error('[voice] timer action failed:', errorMessage(err)),
      );
    }, ms);
    timerMap.set(id, { handle, description: input.description, firesAt });
    return { ok: true, id, description: input.description, firesAt: firesAt.toLocaleTimeString() };
  },

  async cancel_timers() {
    const cancelled: string[] = [];
    for (const [id, t] of timerMap) {
      clearTimeout(t.handle);
      cancelled.push(t.description);
      timerMap.delete(id);
    }
    return { ok: true, cancelled };
  },

  async control_lights(input, base) {
    const { group, power, brightness, colorTemp } = input;
    // Surface a 404/400 (e.g. a misheard room) so the reply can say so instead of
    // claiming success.
    const check = async (res: globalThis.Response) => {
      if (res.ok) return null;
      const body = await res.json().catch(() => ({})) as { error?: string };
      return body.error ?? `HTTP ${res.status}`;
    };
    if (power !== undefined) {
      const error = await check(await post(`${base}/lighting/power`, { group, on: power, source: 'voice' }));
      if (error) return { ok: false, error };
    }
    if (brightness !== undefined || colorTemp !== undefined) {
      const error = await check(await post(`${base}/lighting/set`, {
        group,
        source: 'voice',
        ...(brightness !== undefined && { brightness }),
        ...(colorTemp  !== undefined && { colorTemp }),
      }));
      if (error) return { ok: false, error };
    }
    return { ok: true };
  },

  async explain_lights(input, base) {
    const query = input.group ? `?group=${encodeURIComponent(input.group)}` : '';
    const res = await fetch(`${base}/lighting/explain${query}`);
    const body = await res.json().catch(() => ({})) as ZoneExplanation[] | { error?: string };
    if (!res.ok || !Array.isArray(body)) return { ok: false, error: (body as { error?: string }).error ?? `HTTP ${res.status}` };
    // Keep it short for the model: the reasons, and the last few things that happened
    return body.map((z) => ({
      room:    z.name,
      on:      z.on,
      reasons: z.reasons,
      blocked: z.blocked,
      recent:  z.history.slice(-5).map((h) => `${new Date(h.at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}: ${h.text}`),
    }));
  },

  async resume_automation(input, base) {
    const res = await post(`${base}/lighting/zones/${encodeURIComponent(input.group)}/resume`, { source: 'voice' });
    if (res.ok) return { ok: true };
    const body = await res.json().catch(() => ({})) as { error?: string };
    return { ok: false, error: body.error ?? `HTTP ${res.status}` };
  },

  async control_music(input, base) {
    const { action, volume } = input;
    if (action)               await post(`${base}/spotify/${action}`);
    if (volume !== undefined) await post(`${base}/spotify/volume`, { volume });
    return { ok: true };
  },

  async get_voices() {
    return voicesSummary();
  },

  async set_voice(input) {
    const voices = config.get('voices') ?? {};
    const match  = Object.keys(voices).find((n) => n.toLowerCase() === input.name.toLowerCase());
    if (!match) return { error: `Voice "${input.name}" not found. Available: ${Object.keys(voices).join(', ')}` };
    config.set('active_voice', match);
    return { ok: true, active: match };
  },

  async get_playlists(_input, base) {
    const playlists = await getJson<PlaylistLite[]>(`${base}/spotify/playlists`);
    return { playlists: playlists.map((p) => ({ name: p.name, id: p.id, tracks: p.total })) };
  },

  async play_spotify(input, base) {
    const play = async (body: object, playing: string) => {
      const error = await failure(await post(`${base}/spotify/play`, body));
      return error ? { ok: false, error } : { ok: true, playing };
    };

    if (input.type === 'my_playlist') {
      const playlists = await getJson<PlaylistLite[]>(`${base}/spotify/playlists`);
      const pl        = fuzzyMatch(playlists, input.query ?? '');
      if (!pl) return { error: `Playlist "${input.query}" not found.` };
      return play({ context_uri: pl.uri }, pl.name);
    }

    if (input.type === 'liked_songs') {
      const { collectionUri } = await getJson<{ collectionUri: string }>(`${base}/spotify/liked-songs?count_only=true`);
      return play({ context_uri: collectionUri }, 'Liked Songs');
    }

    if (input.type === 'uri') {
      const uri = input.uri ?? '';
      const single = /^spotify:(track|episode):/.test(uri);
      if (!single) return play({ context_uri: uri }, uri);
      return play(input.from_uri ? { context_uri: input.from_uri, offset_uri: uri } : { uris: [uri] }, uri);
    }

    if (input.type === 'search') {
      const r = await getJson<SearchLite>(`${base}/spotify/search?q=${encodeURIComponent(input.query ?? '')}`);
      const track = r.tracks?.[0], album = r.albums?.[0], playlist = r.playlists?.[0], episode = r.episodes?.[0];
      // A song plays on through its album, so the music doesn't stop after one track
      const playSong = () => track && play(
        track.albumUri ? { context_uri: track.albumUri, offset_uri: track.uri } : { uris: [track.uri] },
        `${track.name} by ${track.artist}`,
      );
      const playAlbum    = () => album    && play({ context_uri: album.uri }, `${album.name} by ${album.artist}`);
      const playPlaylist = () => playlist && play({ context_uri: playlist.uri }, playlist.name);
      const playEpisode  = () => episode  && play({ uris: [episode.uri] }, episode.name);
      const order = {
        song:     [playSong, playAlbum, playPlaylist],
        album:    [playAlbum, playSong, playPlaylist],
        playlist: [playPlaylist, playAlbum, playSong],
        podcast:  [playEpisode],
      }[input.kind ?? 'playlist'];
      for (const attempt of order) {
        const result = await attempt();
        if (result) return result;
      }
      return { error: 'No results found.' };
    }
    // Unrecognized type — same fallback as an unrecognized tool name.
    return { error: 'Unknown tool' };
  },

  async get_patterns(input) {
    const p = patternsSvc.current();
    const which = input.days ?? 'both';
    return {
      historyDays: p.historyDays,
      ...(p.historyDays < 7 && { note: 'Less than a week of history — patterns will appear as the logs fill up.' }),
      ...(which !== 'weekends' && { weekdays: p.weekdays.map((h) => h.text) }),
      ...(which !== 'weekdays' && { weekends: p.weekends.map((h) => h.text) }),
      music: [...p.weekdays, ...p.weekends].filter((h) => h.fromUri).map((h) => ({ habit: h.text, from_uri: h.fromUri })),
      assistant: p.assistant,
    };
  },

  async get_activity(input) {
    const hours = Math.min(720, Math.max(1, input.hours ?? 24));
    const lines = history({
      categories: input.categories,
      since:      Date.now() - hours * 60 * 60 * 1000,
      room:       input.room,
      limit:      Math.min(100, Math.max(1, input.limit ?? 25)),
    });
    return lines.map((l) => ({ time: at(l.at), what: l.text, ...(l.uri && { uri: l.uri }), ...(l.fromUri && { from_uri: l.fromUri }) }));
  },

  async list_rules() {
    const rules = rulesSvc.getRules();
    return { count: rules.length, limit: rulesSvc.MAX_RULES, rules: rules.map(ruleSummary) };
  },

  async create_rule(input, base) {
    const error = await failure(await post(`${base}/lighting/rules`, { ...toRule(input), reason: input.reason }));
    return error ? { ok: false, error } : { ok: true };
  },

  async update_rule(input, base) {
    const existing = rulesSvc.getRules().find((r) => r.id === input.rule_id);
    if (!existing) return { ok: false, error: `No rule with id ${input.rule_id}` };
    const patch = { ...toRule(input, existing), ...(input.enabled !== undefined && { enabled: input.enabled }) };
    const error = await failure(await send('PATCH', `${base}/lighting/rules/${encodeURIComponent(input.rule_id)}`, { ...patch, reason: input.reason }));
    return error ? { ok: false, error } : { ok: true };
  },

  async delete_rule(input, base) {
    const error = await failure(await send('DELETE', `${base}/lighting/rules/${encodeURIComponent(input.rule_id)}`, { reason: input.reason }));
    return error ? { ok: false, error } : { ok: true };
  },

  async undo_rule_change(input, base) {
    const error = await failure(await post(`${base}/lighting/rule-changes/${encodeURIComponent(input.change_id)}/undo`));
    return error ? { ok: false, error } : { ok: true };
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
    const apps = await getJson<TvAppLite[]>(`${base}/tv/apps`);
    const app  = fuzzyMatch(apps, input.app_name);
    if (!app) return { error: `App "${input.app_name}" not found. Available: ${apps.map((a) => a.name).join(', ')}` };
    await post(`${base}/tv/launch/${app.id}`);
    return { ok: true, launched: app.name };
  },
};

function isToolName(name: string): name is keyof ToolInputs {
  return Object.hasOwn(toolHandlers, name);
}

async function executeTool(name: string, input: unknown, base = apiBase()): Promise<unknown> {
  console.log(`[voice] tool → ${name}`, JSON.stringify(input));

  if (!isToolName(name)) return { error: 'Unknown tool' };
  // The model's input is validated against the tool's input_schema by the API,
  // so it's safe to treat it as that tool's input type here.
  const handler = toolHandlers[name] as (input: unknown, base: string) => Promise<unknown>;

  try {
    return await handler(input, base);
  } catch (err) {
    console.error(`[voice] tool ${name} failed:`, errorMessage(err));
    return { error: errorMessage(err) };
  }
}

// ── Timer execution ───────────────────────────────────────────────────────────

async function runTimerAction(description: string): Promise<void> {
  console.log(`[voice] timer fired: ${description}`);
  const messages: Anthropic.MessageParam[] = [
    { role: 'user', content: `Timer fired. Execute this action now: ${description}` },
  ];
  try {
    const { reply, tools } = await runAgentLoop(messages, apiBase(), { maxTokens: 100 });
    assistantLog.record({ trigger: 'timer', request: description, reply, tools });
  } catch (err) {
    assistantLog.record({ trigger: 'timer', request: description, reply: '', tools: [], error: errorMessage(err) });
    throw err;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const USUALLY_WITHIN_MIN = 45;

// What Thomas normally does within USUALLY_WITHIN_MIN of now on this kind of day, from the
// nightly patterns — "6:50 AM Spotify: Morning Mix, about 40 min; 8:10 AM leaves".
function usuallyNow(now: Date): string | null {
  const weekend = now.getDay() === 0 || now.getDay() === 6;
  const habits  = weekend ? patternsSvc.current().weekends : patternsSvc.current().weekdays;
  const minutes = now.getHours() * 60 + now.getMinutes();
  const near = habits.filter((h) => {
    const d = Math.abs(h.minutes - minutes) % 1440;
    return Math.min(d, 1440 - d) <= USUALLY_WITHIN_MIN;
  });
  if (!near.length) return null;
  return near.slice(0, 4).map((h) => h.text.split(' ±')[0]).join('; ');
}

// Returns the description of the first stored routine whose day+time window contains `now`,
// or null if none match. Windows that cross midnight (start > end) wrap correctly.
function activeRoutine(now: Date): string | null {
  const day  = now.getDay();
  const hhmm = toHHMM(now);

  for (const r of Object.values(config.get('routines') ?? {})) {
    if (!r.days.includes(day)) continue;
    const inWindow = r.start <= r.end
      ? hhmm >= r.start && hhmm <= r.end
      : hhmm >= r.start || hhmm <= r.end;
    if (inWindow) return r.description;
  }
  return null;
}

function fuzzyMatch<T extends NamedItem>(items: T[], query: string): T | undefined {
  const q = query.toLowerCase().trim();
  return items.find((i) => i.name.toLowerCase() === q)
      ?? items.find((i) => i.name.toLowerCase().includes(q))
      ?? items.find((i) => q.includes(i.name.toLowerCase()));
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  return await res.json() as T;
}

// Every call voice makes to our own API is marked as coming from voice, so the logs can
// tell it apart from the dashboard (see util.requestSource).
function post(url: string, body?: unknown): Promise<globalThis.Response> {
  return send('POST', url, body);
}

function send(method: string, url: string, body?: unknown): Promise<globalThis.Response> {
  return fetch(url, {
    method,
    headers: { 'X-Source': 'voice', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body:    body ? JSON.stringify(body) : undefined,
  });
}

// ── TTS proxy ─────────────────────────────────────────────────────────────────

router.post('/speak', async (req, res) => {
  const { text } = req.body as { text?: string };
  if (!text?.trim()) return res.status(400).json({ error: 'No text provided' });

  const activeName = config.get('active_voice');
  const voices     = config.get('voices') ?? {};
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
        headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY ?? '', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          model_id: 'eleven_turbo_v2_5',
          voice_settings: { stability: 0.5, similarity_boost: 0.75 },
        }),
      },
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
    console.error('[voice] elevenlabs error:', errorMessage(err));
    res.status(500).json({ error: errorMessage(err) });
  }
});

export default router;
