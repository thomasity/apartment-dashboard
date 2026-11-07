// ── Lighting ──────────────────────────────────────────────────────────────────

export interface LightingValues {
  brightness: number;
  colorTemp: number;
}

// Bulbs and sensors are keyed by IEEE address; `label` is the current friendly name.

export interface BulbState extends LightingValues {
  label: string;
}

export interface LightingServerState {
  connected: boolean;
  /** IEEE address → bulb */
  groups: Record<string, BulbState>;
  /** IEEE addresses of bulbs that are off */
  poweredOff: string[];
}

export interface CircadianPoint {
  hour: number;
  brightness: number;
  colorTemp: number;
}

export interface CircadianState {
  brightness: number;
  colorTemp: number;
  nextChange: string | null;
  timeline: CircadianPoint[];
}

export interface Room {
  name: string;
  /** Bulb IEEE addresses */
  devices: string[];
}

/** Room id → room */
export type RoomsMap = Record<string, Room>;

/** A room, or a bulb not in one (keyed by its address): what the server decides looks for. */
export interface ZoneState {
  auto: boolean;
  /** Who is deciding the zone's look right now */
  control: 'manual' | 'presence' | 'rule' | 'auto' | 'none';
  ruleName: string | null;
  /** ISO end of the rule window in control */
  until: string | null;
}

export type ZonesMap = Record<string, ZoneState>;

// ── Explanations / activity / suggestions ────────────────────────────────────

export type ActivitySource = 'dashboard' | 'voice' | 'rule' | 'presence' | 'wall';

/** One thing that happened to a zone, already phrased by the server */
export interface ActivityLine {
  at: number;
  source: ActivitySource;
  text: string;
}

/** Why a zone looks the way it does, and what's holding automation back */
export interface ZoneExplanation {
  zone: string;
  name: string;
  on: boolean;
  control: ZoneState['control'];
  auto: boolean;
  reasons: string[];
  blocked: string[];
  history: ActivityLine[];
}

/** A rule the server thinks you'd want, from what you keep doing by hand */
export interface RuleSuggestion {
  id: string;
  zone: string;
  kind: 'on' | 'off' | 'set';
  time: string;
  days: number[];
  text: string;
  rule: Omit<Rule, 'id' | 'enabled'>;
  createdAt: number;
}

// ── Rules ─────────────────────────────────────────────────────────────────────

export type RuleActionType = 'power' | 'reconfigure';
export type RuleConfig = 'none' | 'scene' | 'auto';

export interface RuleAction {
  type: RuleActionType;
  /** "all", a room id, or a bulb address */
  group: string;
  /** power only */
  on?: boolean;
  /** 'none' = resume previous; 'scene' = apply brightness+colorTemp; 'auto' = circadian */
  config?: RuleConfig;
  brightness?: number;
  colorTemp?: number;
}

/** What presence may do while a windowed rule is in effect */
export interface RulePresence {
  mode: 'ignore' | 'normal' | 'custom';
  brightness?: number;
  colorTemp?: number;
  vacantAfterMinutes?: number;
}

export interface Rule {
  id: string;
  name: string;
  /** "HH:MM" 24-hour format, or "sunrise" / "sunset" */
  time: string;
  /** Optional end, same format — makes the rule a window */
  end?: string;
  presence?: RulePresence;
  /** Apply even to rooms in a manual session */
  overrideManual?: boolean;
  /** 0 = Sunday … 6 = Saturday */
  days: number[];
  enabled: boolean;
  action: RuleAction;
}

// ── Presence ──────────────────────────────────────────────────────────────────

export interface PresenceEntry {
  /** Sensor IEEE address */
  sensor: string;
  /** Room id */
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

/** A Zigbee2MQTT device as reported by the bridge */
export interface DeviceEntry {
  ieee_address: string;
  friendly_name: string;
  type: string;
  definition?: { description?: string; exposes?: DeviceExpose[] };
}

export interface DevicesState {
  bridgeOnline: boolean;
  devices: DeviceEntry[];
  pairing: boolean;
  availability?: Record<string, boolean>;
}

/** Editable fields of a rule in the schedule form */
export interface RuleFormState {
  name: string;
  time: string;
  end?: string;
  days: number[];
  action: RuleAction;
  presence?: RulePresence;
  overrideManual?: boolean;
}
