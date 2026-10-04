// Shared domain types — anything persisted to config.json, sent over socket.io,
// or passed between services lives here so the shapes have a single source of truth.

import type { Server } from 'socket.io';

// ── Lighting ────────────────────────────────────────────────────────────────

export interface LightValues {
  brightness: number; // 0–100
  colorTemp:  number; // 0 = warmest (2200K) … 100 = coolest (6500K)
}

export interface GroupState extends LightValues {
  label: string;
}

/** Last state the app intentionally set for a bulb — replayed when it comes back online. */
export interface DesiredState {
  power?:      boolean;
  brightness?: number;
  colorTemp?:  number;
}

export interface LightingState {
  connected:  boolean;
  groups:     Record<string, GroupState>;
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
  availability: Record<string, boolean>;
}

/** A non-light device. Holds every property the device has reported (illuminance, sensitivity, …). */
export interface SensorState {
  label:     string;
  occupancy: boolean | null;
  [key: string]: unknown;
}

export interface OccupancyEvent {
  name:      string;
  occupancy: boolean;
}

// ── Rooms / circadian / override ────────────────────────────────────────────

/** Room name → device/group names assigned to it. */
export type RoomsMap = Record<string, string[]>;

export interface CircadianPoint extends LightValues {
  hour: number;
}

export interface CircadianState extends LightValues {
  enabledGroups: string[];
  nextChange:    string | null;
}

/** Group name → override expiry timestamp (ms). */
export type OverridesMap = Record<string, number>;

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

export interface Rule {
  id:      string;
  name:    string;
  time:    string;   // "HH:MM" 24-hour, or "sunrise" / "sunset"
  days:    number[]; // 0 = Sunday … 6 = Saturday
  enabled: boolean;
  action:  RuleAction;
}

// ── Presence ────────────────────────────────────────────────────────────────

export interface PresenceConfigEntry {
  room:                     string;
  vacantAfterMinutes:       number;
  manualOffCooldownMinutes: number;
  enabled:                  boolean;
}

/** Keyed by sensor name. */
export type PresenceConfigMap = Record<string, PresenceConfigEntry>;

export interface PresenceEntry extends PresenceConfigEntry {
  sensor:             string;
  occupancy:          boolean | null;
  manualOffUntil:     number | null;
  vacancyTimerActive: boolean;
}

// ── Plants / voice ──────────────────────────────────────────────────────────

export interface Plant {
  id:           string;
  name:         string;
  intervalDays: number;
  lastWatered:  string | null; // "YYYY-MM-DD"
}

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

// ── Persisted config (config.json) ──────────────────────────────────────────

export interface ConfigSchema {
  rooms:             RoomsMap;
  circadianGroups:   string[];
  bulbDesiredStates: Record<string, DesiredState>;
  rules:             Rule[];
  presence:          PresenceConfigMap;
  plants:            Plant[];
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
  'lighting:override':     (overrides: OverridesMap) => void;
  'lighting:bridge_event': (event: unknown) => void;
}

// The client never emits anything to the server.
export type ClientToServerEvents = Record<string, never>;

export type AppServer = Server<ClientToServerEvents, ServerToClientEvents>;
