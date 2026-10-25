// ── Lighting ──────────────────────────────────────────────────────────────────

export interface LightingValues {
  brightness: number;
  colorTemp: number;
}

export interface LightingServerState {
  connected: boolean;
  groups: Record<string, LightingValues>;
  poweredOff: string[];
}

export interface CircadianPoint {
  time: string;
  brightness: number;
  colorTemp: number;
}

export interface CircadianState {
  enabledGroups: string[];
  brightness: number;
  colorTemp: number;
  nextChange: string | null;
  timeline: CircadianPoint[];
}

export type RoomsMap = Record<string, string[]>;

/** expiresAt timestamp per group name */
export type OverridesMap = Record<string, number>;

// ── Rules ─────────────────────────────────────────────────────────────────────

export type RuleActionType = 'power' | 'reconfigure';
export type RuleConfig = 'none' | 'scene' | 'auto';

export interface RuleAction {
  type: RuleActionType;
  group: string;
  /** power only */
  on?: boolean;
  /** 'none' = resume previous; 'scene' = apply brightness+colorTemp; 'auto' = circadian */
  config?: RuleConfig;
  brightness?: number;
  colorTemp?: number;
}

export interface Rule {
  id: string;
  name: string;
  /** "HH:MM" 24-hour format, or "sunrise" / "sunset" */
  time: string;
  /** 0 = Sunday … 6 = Saturday */
  days: number[];
  enabled: boolean;
  action: RuleAction;
}

// ── Presence ──────────────────────────────────────────────────────────────────

export interface PresenceEntry {
  sensor: string;
  room: string;
  vacantAfterMinutes: number;
  manualOffCooldownMinutes: number;
  enabled: boolean;
  occupancy: boolean | null;
  manualOffUntil: number | null;
  vacancyTimerActive: boolean;
}

export type SensorsMap = Record<string, { label: string; occupancy: boolean | null } & Record<string, unknown>>;

/** Zigbee2MQTT-reported settable/readable property for a device (access bit 2 = settable) */
export interface DeviceExpose {
  type: string;
  name: string;
  property: string;
  access: number;
  description?: string;
  unit?: string;
  value_min?: number;
  value_max?: number;
  value_step?: number;
  values?: (string | number)[];
}

/** Editable fields of a rule in the schedule form */
export interface RuleFormState {
  name: string;
  time: string;
  days: number[];
  action: RuleAction;
}
