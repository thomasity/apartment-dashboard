// ── Spotify ───────────────────────────────────────────────────────────────────

export interface SpotifyPlaybackItem {
  uri: string | null;
  name: string;
  artist: string | null;
  album: string | null;
  art: string | null;
  duration: number;
  progress: number;
  type: 'track' | 'episode';
}

export interface SpotifyDevice {
  id?: string;
  name: string;
  type?: string;
  isActive?: boolean;
  volume: number;
}

export interface SpotifyContext {
  type: string;
  uri: string;
}

export interface SpotifyState {
  isPlaying: boolean;
  shuffle: boolean;
  repeat: 'off' | 'context' | 'track';
  context: SpotifyContext | null;
  item: SpotifyPlaybackItem | null;
  device: SpotifyDevice;
}

/** A track or episode in a list (playlist, album, show) */
export interface SpotifyListItem {
  id: string;
  uri: string;
  name: string;
  artist?: string | null;
  duration: number;
  art: string | null;
}

export interface SpotifyPlaylist {
  id: string;
  uri: string;
  name: string;
  image: string | null;
  total: number;
  collectionUri?: string;
}

export interface SpotifyAlbum {
  id: string;
  uri: string;
  name: string;
  artist: string;
  image: string | null;
}

export interface SpotifyShow {
  id: string;
  uri: string;
  name: string;
  publisher: string;
  image: string | null;
  total?: number;
  artist?: string;
}

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

export type RuleActionType = 'power' | 'scene' | 'circadian';

export interface RuleAction {
  type: RuleActionType;
  group: string;
  on?: boolean;
  brightness?: number;
  colorTemp?: number;
  enabled?: boolean;
}

export interface Rule {
  id: string;
  name: string;
  /** "HH:MM" 24-hour format */
  time: string;
  /** 0 = Sunday … 6 = Saturday */
  days: number[];
  enabled: boolean;
  action: RuleAction;
}
