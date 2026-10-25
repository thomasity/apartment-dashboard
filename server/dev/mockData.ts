// Mock data for local development (MOCK=true). Shapes must match what each real route
// returns — lighting is not mocked here, it runs the real services against fakeZigbee.ts.

import type { ConfigSchema, NowPlaying, Z2MDevice } from '../types';

// ── Lighting (Zigbee2MQTT device list + the config.json it starts from) ──────

function bulb(name: string, description = 'Smart Bulb E27'): Z2MDevice {
  return {
    ieee_address: `0x${Buffer.from(name).toString('hex').slice(0, 16)}`,
    friendly_name: name,
    type: 'Router',
    interview_completed: true,
    definition: { description, exposes: [{ type: 'light', features: [] }] },
  };
}

export const PRESENCE_SENSOR = 'Living Room Sensor';

export const zigbeeDevices: Z2MDevice[] = [
  { ieee_address: '0x0000', friendly_name: 'Coordinator', type: 'Coordinator', interview_completed: true, definition: null },
  bulb('Floor Lamp'),
  bulb('Ceiling'),
  bulb('Desk Lamp', 'Smart Bulb GU10'),
  bulb('Bedside'),
  bulb('Hallway'),
  {
    ieee_address: '0x5e05041ee0',
    friendly_name: PRESENCE_SENSOR,
    type: 'EndDevice',
    interview_completed: true,
    definition: {
      description: 'mmWave presence sensor',
      exposes: [
        { type: 'binary',  name: 'occupancy', property: 'occupancy', access: 1 },
        { type: 'numeric', name: 'radar_sensitivity', property: 'radar_sensitivity', access: 7, value_min: 0, value_max: 10, value_step: 1 },
        { type: 'numeric', name: 'presence_timeout', property: 'presence_timeout', access: 7, value_min: 0, value_max: 600, value_step: 10, unit: 's' },
        { type: 'enum',    name: 'motion_mode', property: 'motion_mode', access: 7, values: ['standard', 'sensitive', 'small'] },
      ],
    },
  },
];

/** Initial reported state per device, in Zigbee2MQTT units (brightness 0–254, color_temp mireds). */
export const zigbeeStates: Record<string, Record<string, unknown>> = {
  'Floor Lamp': { state: 'ON',  brightness: 178, color_temp: 370 },
  'Ceiling':    { state: 'ON',  brightness: 230, color_temp: 250 },
  'Desk Lamp':  { state: 'OFF', brightness: 127, color_temp: 200 },
  'Bedside':    { state: 'ON',  brightness: 60,  color_temp: 440 },
  'Hallway':    { state: 'ON',  brightness: 127, color_temp: 300 },
  [PRESENCE_SENSOR]: { occupancy: true, radar_sensitivity: 6, presence_timeout: 120, motion_mode: 'standard' },
};

/** Devices that report offline, so the offline UI has something to show. */
export const offlineDevices = ['Hallway'];

/** A bulb that "joins" a few seconds after pairing is enabled. */
export const pairableBulb = bulb('New Bulb');

export const seedConfig: Partial<ConfigSchema> = {
  rooms: {
    'Living Room': ['Floor Lamp', 'Ceiling'],
    'Bedroom':     ['Bedside'],
  },
  circadianGroups: ['Bedside'],
  rules: [
    {
      id: 'mock-rule-1', name: 'Wake up', time: '07:00', days: [1, 2, 3, 4, 5], enabled: true,
      action: { type: 'power', group: 'Bedroom', on: true, config: 'auto' },
    },
    {
      id: 'mock-rule-2', name: 'Evening glow', time: 'sunset', days: [0, 1, 2, 3, 4, 5, 6], enabled: true,
      action: { type: 'reconfigure', group: 'Living Room', config: 'scene', brightness: 45, colorTemp: 15 },
    },
    {
      id: 'mock-rule-3', name: 'Lights out', time: '23:30', days: [0, 6], enabled: false,
      action: { type: 'power', group: 'all', on: false },
    },
  ],
  presence: {
    [PRESENCE_SENSOR]: { room: 'Living Room', vacantAfterMinutes: 10, manualOffCooldownMinutes: 30, enabled: true },
  },
  rokuIp:   '192.168.1.50',
  rokuName: 'Living Room Roku',
};

// ── Spotify ───────────────────────────────────────────────────────────────────

export interface MockTrack { id: string; uri: string; name: string; artist: string; duration: number; art: null }

const track = (id: string, name: string, artist: string, seconds: number): MockTrack =>
  ({ id, uri: `spotify:track:${id}`, name, artist, duration: seconds * 1000, art: null });

export const playlistTracks: Record<string, MockTrack[]> = {
  'mock-pl-1': [
    track('mock-t1', 'Midnight City',        'M83',               243),
    track('mock-t2', 'Breathe Deeper',       'Tame Impala',       372),
    track('mock-t3', 'Nights',               'Frank Ocean',       307),
    track('mock-t4', 'Motion Sickness',      'Phoebe Bridgers',   230),
    track('mock-t5', 'Kids',                 'MGMT',              302),
    track('mock-t6', 'Electric Feel',        'MGMT',              229),
  ],
  'mock-pl-2': [
    track('mock-t7',  'Weightless',          'Marconi Union',     480),
    track('mock-t8',  'An Ending (Ascent)',  'Brian Eno',         264),
    track('mock-t9',  'Re: Stacks',          'Bon Iver',          401),
    track('mock-t10', 'Holocene',            'Bon Iver',          336),
  ],
  'mock-pl-3': [
    track('mock-t11', 'Intro',               'The xx',            127),
    track('mock-t12', 'Teardrop',            'Massive Attack',    330),
    track('mock-t13', 'Roygbiv',             'Boards of Canada',  151),
  ],
};

export const playlists = [
  { id: 'mock-pl-1', uri: 'spotify:playlist:mock-pl-1', name: 'Apartment Rotation', image: null, total: 6 },
  { id: 'mock-pl-2', uri: 'spotify:playlist:mock-pl-2', name: 'Wind Down',          image: null, total: 4 },
  { id: 'mock-pl-3', uri: 'spotify:playlist:mock-pl-3', name: 'Focus',              image: null, total: 3 },
];

export const albums = [
  { id: 'mock-al-1', uri: 'spotify:album:mock-al-1', name: 'Currents',             artist: 'Tame Impala', image: null },
  { id: 'mock-al-2', uri: 'spotify:album:mock-al-2', name: 'Blonde',               artist: 'Frank Ocean', image: null },
  { id: 'mock-al-3', uri: 'spotify:album:mock-al-3', name: 'For Emma, Forever Ago', artist: 'Bon Iver',   image: null },
];

export const albumTracks: Record<string, MockTrack[]> = {
  'mock-al-1': [track('mock-a1', "Let It Happen", 'Tame Impala', 467), track('mock-a2', 'The Moment', 'Tame Impala', 255)],
  'mock-al-2': [track('mock-a3', 'Nikes', 'Frank Ocean', 314), track('mock-a4', 'Ivy', 'Frank Ocean', 249)],
  'mock-al-3': [track('mock-a5', 'Flume', 'Bon Iver', 219), track('mock-a6', 'Skinny Love', 'Bon Iver', 238)],
};

export const likedTracks: MockTrack[] = [
  track('mock-l1', 'Dreams',      'Fleetwood Mac', 257),
  track('mock-l2', 'Redbone',     'Childish Gambino', 326),
  track('mock-l3', 'Pink + White', 'Frank Ocean', 184),
];

export const shows = [
  { id: 'mock-sh-1', uri: 'spotify:show:mock-sh-1', name: 'Hardcore History', publisher: 'Dan Carlin', image: null, total: 2 },
  { id: 'mock-sh-2', uri: 'spotify:show:mock-sh-2', name: 'Radiolab',         publisher: 'WNYC Studios', image: null, total: 2 },
];

export const showEpisodes: Record<string, { id: string; uri: string; name: string; duration: number; art: null }[]> = {
  'mock-sh-1': [
    { id: 'mock-ep1', uri: 'spotify:episode:mock-ep1', name: 'Supernova in the East I', duration: 4 * 3600_000, art: null },
    { id: 'mock-ep2', uri: 'spotify:episode:mock-ep2', name: 'Supernova in the East II', duration: 5 * 3600_000, art: null },
  ],
  'mock-sh-2': [
    { id: 'mock-ep3', uri: 'spotify:episode:mock-ep3', name: 'The Cataclysm Sentence', duration: 52 * 60_000, art: null },
    { id: 'mock-ep4', uri: 'spotify:episode:mock-ep4', name: 'Colors', duration: 61 * 60_000, art: null },
  ],
};

export const spotifyDevices = [
  { id: 'mock-dev-hub',    name: 'Apartment Hub', type: 'speaker',    isActive: true,  volume: 65 },
  { id: 'mock-dev-laptop', name: 'MacBook',       type: 'computer',   isActive: false, volume: 100 },
  { id: 'mock-dev-phone',  name: 'Phone',         type: 'smartphone', isActive: false, volume: 80 },
];

export const LIKED_COLLECTION_URI = 'spotify:user:mock-user:collection';

/** Every playable thing, for looking up a track by URI. */
export function allTracks(): MockTrack[] {
  return [...Object.values(playlistTracks), ...Object.values(albumTracks), likedTracks].flat();
}

export function initialNowPlaying(): NowPlaying {
  const first = playlistTracks['mock-pl-1']![0]!;
  return {
    isPlaying: true,
    shuffle:   false,
    repeat:    'off',
    context:   { type: 'playlist', uri: 'spotify:playlist:mock-pl-1' },
    item:      { uri: first.uri, name: first.name, artist: first.artist, album: 'Hurry Up, We\'re Dreaming', art: null, duration: first.duration, progress: 41_000, type: 'track' },
    device:    { name: 'Apartment Hub', volume: 65 },
  };
}

// ── Bluetooth ─────────────────────────────────────────────────────────────────

export const bluetoothPaired = [
  { mac: 'AA:BB:CC:DD:EE:01', name: 'Bookshelf Speaker', connected: true },
  { mac: 'AA:BB:CC:DD:EE:02', name: 'Headphones',        connected: false },
];

export const bluetoothDiscovered = [
  { mac: 'AA:BB:CC:DD:EE:10', name: 'Kitchen Speaker' },
  { mac: 'AA:BB:CC:DD:EE:11' },
];

// ── TV / Roku ─────────────────────────────────────────────────────────────────

export const tvApps = [
  { id: '12',    name: 'Netflix' },
  { id: '837',   name: 'YouTube' },
  { id: '13',    name: 'Prime Video' },
  { id: '151908', name: 'The Roku Channel' },
  { id: '22297', name: 'Spotify' },
  { id: '291097', name: 'Disney Plus' },
  { id: '61322', name: 'Max' },
  { id: '2285',  name: 'Hulu' },
];

export const tvDiscovered = [
  { ip: '192.168.1.50', name: 'Living Room Roku', model: 'Roku Streaming Stick 4K' },
  { ip: '192.168.1.51', name: 'Bedroom Roku',     model: 'Roku Express' },
];

// ── Weather (Open-Meteo shape, generated around the current time) ─────────────

export function weather() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const pad  = (n: number) => String(n).padStart(2, '0');
  const date = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const days = Array.from({ length: 5 }, (_, i) => new Date(today.getTime() + i * 86_400_000));
  const codes = [1, 2, 61, 3, 0];

  const hourly = { time: [] as string[], temperature_2m: [] as number[], weather_code: [] as number[], precipitation_probability: [] as number[] };
  days.forEach((d, day) => {
    for (let h = 0; h < 24; h++) {
      hourly.time.push(`${date(d)}T${pad(h)}:00`);
      // Coolest just before dawn, warmest mid-afternoon
      hourly.temperature_2m.push(Math.round(58 + day * 2 + 12 * Math.sin(((h - 9) / 24) * 2 * Math.PI)));
      hourly.weather_code.push(codes[day]!);
      hourly.precipitation_probability.push(codes[day] === 61 ? 40 + (h % 6) * 8 : h % 7 === 0 ? 10 : 0);
    }
  });

  const nowHour = new Date().getHours();
  return {
    current: {
      temperature_2m:       hourly.temperature_2m[nowHour]!,
      apparent_temperature: hourly.temperature_2m[nowHour]! - 2,
      weather_code:         codes[0]!,
      relative_humidity_2m: 54,
      wind_speed_10m:       7.4,
    },
    hourly,
    daily: {
      time:               days.map(date),
      weather_code:       codes,
      temperature_2m_max: days.map((_, i) => 70 + i * 2),
      temperature_2m_min: days.map((_, i) => 46 + i * 2),
    },
  };
}
