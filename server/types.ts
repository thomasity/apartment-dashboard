// Shared domain types — anything persisted to config.json, sent over socket.io,
// or passed between services lives here so the shapes have a single source of truth.

import type { Server } from 'socket.io';

// ── Lighting ────────────────────────────────────────────────────────────────

export interface LightValues {
  brightness: number; // 0–100
  colorTemp:  number; // 0 = warmest (2200K) … 100 = coolest (6500K)
}

// Bulbs and sensors are keyed by their Zigbee IEEE address everywhere (rooms, rules,
// presence, sessions), so a rename never orphans anything. `label` is the current
// friendly name, for display and for MQTT topics.

export interface GroupState extends LightValues {
  label: string;
}

export interface LightingState {
  connected:  boolean;
  /** IEEE address → bulb */
  groups:     Record<string, GroupState>;
  /** IEEE addresses of bulbs that are off */
  poweredOff: string[];
}

// ── Zigbee2MQTT ─────────────────────────────────────────────────────────────

export interface Z2MExpose {
  type:      string;
  property?: string;
  [key: string]: unknown;
}

export interface Z2MDevice {
  ieee_address:        string;
  friendly_name:       string;
  type:                string;
  interview_completed: boolean;
  definition?: {
    description?: string;
    exposes?:     Z2MExpose[];
    [key: string]: unknown;
  } | null;
  [key: string]: unknown;
}

export interface DevicesState {
  bridgeOnline: boolean;
  devices:      Z2MDevice[];
  pairing:      boolean;
  /** IEEE address → online */
  availability: Record<string, boolean>;
}

/** A non-light device. Holds every property the device has reported (illuminance, sensitivity, …). */
export interface SensorState {
  label:     string;
  occupancy: boolean | null;
  [key: string]: unknown;
}

export interface OccupancyEvent {
  /** Sensor IEEE address */
  sensor:    string;
  occupancy: boolean;
}

// ── Rooms / zones / circadian ───────────────────────────────────────────────

export interface Room {
  name:    string;
  /** Bulb IEEE addresses */
  devices: string[];
}

/** Room id → room */
export type RoomsMap = Record<string, Room>;

export interface CircadianPoint extends LightValues {
  hour: number;
}

export interface CircadianState extends LightValues {
  nextChange: string | null;
}

/**
 * A zone is what the lighting controller decides for: a room, or a bulb that isn't in
 * one. Its id is the room id or the bulb's IEEE address.
 */
export interface ManualSession {
  startedAt: number;
  /** Bulb IEEE address → the look it was given (or had) during the session */
  looks:     Record<string, LightValues>;
}

/**
 * A look the assistant chose on its own — a one-off window that ends by itself. It never
 * freezes the room: your changes replace it, and a rule starting later wins over it.
 */
export interface AssistantLook {
  look:      LightValues;
  startedAt: number;
  until:     number;
  /** Why, in a few words — shown on the dashboard and in the history */
  reason:    string;
}

/** Persisted per-zone controller state. */
export interface ZoneRuntime {
  manual?:       ManualSession;
  assistant?:    AssistantLook;
  /** Set when presence switched the zone on under a rule's custom look */
  presenceLook?: LightValues;
}

/** What the dashboard shows for a zone: who is deciding its look right now, and until when. */
export interface ZoneState {
  auto:     boolean;
  control:  'manual' | 'presence' | 'assistant' | 'rule' | 'auto' | 'none';
  ruleName: string | null;
  /** ISO end of the rule window (or assistant look) in control, if any */
  until:    string | null;
  /** Why the assistant set it, when it's in control */
  reason?:  string | null;
}

// ── Activity / explanations / suggestions ───────────────────────────────────

/** Who changed the lights. dashboard and voice are you (manual). */
export type ActivitySource = 'dashboard' | 'voice' | 'rule' | 'presence' | 'wall' | 'assistant';

export interface ActivityEntry {
  /** ms */
  at:      number;
  zone:    string;
  source:  ActivitySource;
  /**
   * on / off / set (brightness or colour) / resume (handed back to automation) /
   * auto-on / auto-off (the Auto toggle) / skipped (a rule left a manual zone alone) /
   * blocked (presence held back, e.g. by the cooldown)
   */
  action:  'on' | 'off' | 'set' | 'resume' | 'auto-on' | 'auto-off' | 'skipped' | 'blocked';
  /** The look the zone (or the bulbs touched) ended up with */
  look?:   LightValues;
  /** Only some of the zone's bulbs were touched */
  bulbs?:  string[];
  /** Rule name, for source 'rule' */
  rule?:   string;
  note?:   string;
}

/** A room becoming occupied or empty (data/logs/presence.jsonl). */
export interface PresenceLogEntry {
  at:       number;
  /** Sensor IEEE address */
  sensor:   string;
  /** Room id, when the sensor is assigned to one */
  room:     string | null;
  occupied: boolean;
}

// ── Home / away (phone on the Wi-Fi) ────────────────────────────────────────

/** A phone whose presence on the home network means you're home. */
export interface TrackedPhone {
  /** Wi-Fi hardware address, lower case */
  mac:  string;
  name: string;
}

/** A tracked phone arriving or leaving (data/logs/home.jsonl). */
export interface HomeLogEntry {
  at:        number;
  mac:       string;
  home:      boolean;
  /** For leaving: when the phone was last actually seen — the real time you left */
  lastSeen?: number;
}

/** Something that answered the last network scans. */
export interface NetworkDevice {
  ip:       string;
  mac:      string;
  vendor:   string | null;
  lastSeen: number;
}

/** A remark from the assistant: shown on dashboards, and spoken when it can be. */
export interface Notice {
  id:            string;
  at:            number;
  text:          string;
  /** What Undo on the note reverses, if anything */
  undo?:         { kind: 'look'; zone: string } | { kind: 'rule'; changeId: string };
  /** Say it out loud (not during quiet hours, not past the daily limit) */
  speak:         boolean;
  /** Waiting for Thomas to be home and in the living room */
  held:          boolean;
  deliveredAt?:  number;
  dismissed?:    boolean;
}

export interface NoticesState {
  items: Notice[];
  /** Remarks delivered today, for the daily limit */
  today: { day: string; count: number };
}

export interface HomeState {
  /** null when no phone is set up yet, or right after startup */
  home:   boolean | null;
  phones: Array<TrackedPhone & { home: boolean | null; lastSeen: number | null }>;
}

/** Who started something on Spotify or the TV. 'other' = a phone, the remote, or it just moved on. */
export type MediaSource = 'dashboard' | 'voice' | 'assistant' | 'other';

/** Music and TV (data/logs/media.jsonl). */
export interface MediaEntry {
  at:      number;
  device:  'spotify' | 'tv';
  /** play / pause / track (next song) for Spotify; on / off / app for the TV */
  action:  'play' | 'pause' | 'track' | 'on' | 'off' | 'app';
  source:  MediaSource;
  /** Track or episode, for Spotify */
  title?:  string;
  artist?: string;
  /** Spotify id of the track or episode (spotify:track:…), so it can be played again exactly */
  uri?:    string;
  /** What it's playing from: a playlist / album / show name when known, else its type */
  from?:   string;
  /** Spotify id of what it's playing from (spotify:playlist:…, spotify:album:…) */
  fromUri?: string;
  /** TV app name */
  app?:    string;
}

export interface AssistantToolCall {
  name:  string;
  input: unknown;
  ok:    boolean;
  error?: string;
}

/** One conversation turn with the assistant (data/logs/assistant.jsonl). */
export interface AssistantEntry {
  at:       number;
  /**
   * voice = you spoke to it; timer = a timer you set went off; event = it woke on its own
   * (you got home, a habit coming up…); nightly = its nightly review
   */
  trigger:  'voice' | 'timer' | 'event' | 'nightly';
  /** Where it came from, e.g. "tablet" */
  device?:  string | null;
  request:  string;
  reply:    string;
  tools:    AssistantToolCall[];
  error?:   string;
}

// ── Patterns (nightly summary of the logs) ──────────────────────────────────

export type HabitKind = 'day-start' | 'day-end' | 'leave' | 'return' | 'lights' | 'music' | 'tv';

/** Something that recurs at about the same time on most weekdays (or weekends). */
export interface Habit {
  kind:      HabitKind;
  /** Typical time, minutes after midnight */
  minutes:   number;
  /** How much it varies, ± minutes */
  spread:    number;
  /** On how many of the eligible days it happened, and how many there were */
  matched:   number;
  eligible:  number;
  /** Typical length in minutes, for things that last (music, TV, being out) */
  duration?: number;
  /** lights */
  zone?:     string;
  action?:   'on' | 'off' | 'set';
  look?:     LightValues;
  /** music: the usual playlist / album, with its Spotify id; tv: the usual app */
  from?:     string;
  fromUri?:  string;
  app?:      string;
  /** e.g. "6:40 day starts ±10 min · 9 of 10 weekdays" */
  text:      string;
}

export interface AssistantSummary {
  requests:  number;
  /** Tools used most, most first */
  topTools:  Array<{ name: string; count: number }>;
  /** Things asked for again and again, word for word */
  repeated:  Array<{ request: string; count: number }>;
  /** Tool failures that keep happening */
  failures:  Array<{ name: string; error: string; count: number }>;
}

export interface Patterns {
  generatedAt: number;
  /** Days of history the summary is based on */
  historyDays: number;
  weekdays:    Habit[];
  weekends:    Habit[];
  assistant:   AssistantSummary;
}

/** A log entry for display, already phrased. */
export interface ActivityLine {
  at:     number;
  source: ActivitySource;
  text:   string;
}

/** Why a zone looks the way it does right now, and what is holding automation back. */
export interface ZoneExplanation {
  zone:    string;
  name:    string;
  on:      boolean;
  control: ZoneState['control'];
  auto:    boolean;
  /** Plain-English reasons for the current look, most important first */
  reasons: string[];
  /** Things that would otherwise happen but won't right now */
  blocked: string[];
  history: ActivityLine[];
}

export type SuggestionKind = 'on' | 'off' | 'set';

export interface RuleSuggestion {
  id:          string;
  zone:        string;
  kind:        SuggestionKind;
  /** "HH:MM" */
  time:        string;
  days:        number[];
  look?:       LightValues;
  /** e.g. "You've dimmed Living Room to about 30% around 10:00 PM on 9 of the last 10 weekdays." */
  text:        string;
  /** A ready-to-edit rule */
  rule:        Omit<Rule, 'id' | 'enabled'>;
  createdAt:   number;
}

export interface DismissedSuggestion {
  zone:    string;
  kind:    SuggestionKind;
  days:    number[];
  /** Minutes after midnight */
  minutes: number;
  /** ms; null = never again */
  until:   number | null;
}

export interface SuggestionsState {
  current:   RuleSuggestion | null;
  /** When the last new suggestion was shown (ms) — at most one a week */
  lastNewAt: number;
  dismissed: DismissedSuggestion[];
}

// ── Rules ───────────────────────────────────────────────────────────────────

export type RuleActionType = 'power' | 'reconfigure';
/** 'none' = resume previous; 'scene' = apply brightness+colorTemp; 'auto' = circadian */
export type RuleConfigMode = 'none' | 'scene' | 'auto';

export interface RuleAction {
  type:        RuleActionType;
  group:       string;
  on?:         boolean; // power only
  config?:     RuleConfigMode;
  brightness?: number;
  colorTemp?:  number;
}

/** What presence may do while a rule's window is in effect. */
export interface RulePresence {
  mode:                'ignore' | 'normal' | 'custom';
  /** custom only */
  brightness?:         number;
  colorTemp?:          number;
  vacantAfterMinutes?: number;
}

export interface Rule {
  id:      string;
  name:    string;
  time:    string;   // "HH:MM" 24-hour, or "sunrise" / "sunset"
  /** Optional end ("HH:MM" / "sunrise" / "sunset") — makes the rule a window, not an instant */
  end?:    string;
  days:    number[]; // 0 = Sunday … 6 = Saturday (of the start)
  enabled: boolean;
  /** "all", a room id, or a bulb IEEE address */
  action:  RuleAction;
  /** Windowed rules only */
  presence?:       RulePresence;
  /** Apply even to zones in a manual session (and end that session) */
  overrideManual?: boolean;
  /** Who made it: you on the dashboard, you by voice, or the assistant on its own */
  createdBy?:      RuleChangeSource;
}

export type RuleChangeSource = 'dashboard' | 'voice' | 'assistant';

/** One change to the rules (data/logs/rules.jsonl) — what makes every change undoable. */
export interface RuleChange {
  at:      number;
  /** This change's own id, for undo */
  id:      string;
  ruleId:  string;
  change:  'create' | 'update' | 'delete';
  by:      RuleChangeSource;
  /** Why, when the assistant made it */
  reason?: string;
  before?: Rule;
  after?:  Rule;
  /** Set on a change that was itself an undo */
  undoes?: string;
}

// ── Presence ────────────────────────────────────────────────────────────────

export interface PresenceConfigEntry {
  /** Room id */
  room:                     string;
  vacantAfterMinutes:       number;
  manualOffCooldownMinutes: number;
  enabled:                  boolean;
}

/** Keyed by sensor IEEE address. */
export type PresenceConfigMap = Record<string, PresenceConfigEntry>;

export interface PresenceEntry extends PresenceConfigEntry {
  /** Sensor IEEE address */
  sensor:             string;
  occupancy:          boolean | null;
  manualOffUntil:     number | null;
  vacancyTimerActive: boolean;
}

// ── Voice ──────────────────────────────────────────────────────────

export interface Voice {
  id:          string;
  description: string;
}

export interface Routine {
  days:        number[]; // 0 = Sunday … 6 = Saturday
  start:       string;   // "HH:MM"
  end:         string;   // "HH:MM"
  description: string;
}

// ── Spotify ─────────────────────────────────────────────────────────────────

/** Flattened player state sent to dashboards (GET /api/spotify/now-playing and 'spotify:state'). */
export interface NowPlaying {
  isPlaying: boolean;
  shuffle:   boolean;
  repeat:    string;
  context:   { type: string; uri: string } | null;
  item: {
    uri:      string | null;
    name:     string | undefined;
    artist:   string | null;
    album:    string | null;
    art:      string | null;
    duration: number;
    progress: number;
    type:     string;
  };
  device: { name: string | undefined; volume: number };
}

// ── Persisted config (config.json) ──────────────────────────────────────────

export interface ConfigSchema {
  /** 2 = everything keyed by ids (see services/migrate.ts) */
  lightingSchema:    number;
  rooms:             RoomsMap;
  /** Zone ids on Auto (circadian) */
  autoZones:         string[];
  zones:             Record<string, ZoneRuntime>;
  rules:             Rule[];
  /** Rule id → date key (YYYY-MM-DD) of the start it last fired for */
  ruleLastFired:     Record<string, string>;
  presence:          PresenceConfigMap;
  suggestions:       SuggestionsState;
  patterns:          Patterns;
  phones:            TrackedPhone[];
  /** Room id where the assistant's speaker is; defaults to a room named "Living Room" */
  speakerRoom:       string;
  notices:           NoticesState;
  active_voice:      string;
  voices:            Record<string, Voice>;
  memories:          Record<string, string>;
  routines:          Record<string, Routine>;
  rokuIp:            string;
  rokuName:          string;
  rokuMac:           string;
}

// ── Socket.io ───────────────────────────────────────────────────────────────

export interface ServerToClientEvents {
  'lighting:state':        (state: LightingState) => void;
  'lighting:devices':      (state: DevicesState) => void;
  'lighting:circadian':    (state: CircadianState) => void;
  'lighting:rooms':        (rooms: RoomsMap) => void;
  'lighting:zones':        (zones: Record<string, ZoneState>) => void;
  /** The rules changed (by you, voice or the assistant) */
  'lighting:rules':        (rules: Rule[]) => void;
  /** A remark from the assistant, for every dashboard to show */
  'assistant:notice':      (notice: Notice) => void;
  /** Read this aloud — sent to one dashboard only, the one used most recently */
  'assistant:say':         (say: { id: string; text: string }) => void;
  'lighting:suggestion':   (suggestion: RuleSuggestion | null) => void;
  'lighting:bridge_event': (event: unknown) => void;
  'spotify:state':         (state: NowPlaying | null) => void;
  'connectivity':          (state: { online: boolean }) => void;
}

// The client never emits anything to the server.
export interface ClientToServerEvents {
  /** Someone touched this dashboard (it can play sound now) — make it the one that speaks */
  'assistant:active': () => void;
}

export type AppServer = Server<ClientToServerEvents, ServerToClientEvents>;
