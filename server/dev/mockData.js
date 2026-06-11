// Mock data for local development (PROD=false).
// Shapes must exactly match what each real route returns.

const lightingState = {
  connected: true,
  groups: {
    'Living Room': { label: 'Living Room', brightness: 70, colorTemp: 30 },
    'Bedroom':     { label: 'Bedroom',     brightness: 45, colorTemp: 60 },
  },
};

const devicesState = {
  bridgeOnline: true,
  pairing: false,
  devices: [
    { ieee_address: '0xdev000', friendly_name: 'Coordinator', type: 'Coordinator', interview_completed: true, definition: null },
    { ieee_address: '0xdev001', friendly_name: 'Living Room', type: 'Router', interview_completed: true, definition: { description: 'Smart Bulb E27' } },
    { ieee_address: '0xdev002', friendly_name: 'Bedroom',     type: 'Router', interview_completed: true, definition: { description: 'Smart Bulb E27' } },
  ],
  availability: { 'Living Room': true, 'Bedroom': false },
};

const circadianState = {
  enabledGroups: [],
  brightness: 65,
  colorTemp: 45,
  nextChange: null,
  timeline: [],
};

const nowPlaying = {
  isPlaying: true,
  shuffle: false,
  repeat: 'off',
  context: { type: 'playlist', uri: 'spotify:playlist:dev001' },
  track: {
    uri:      'spotify:track:dev001',
    name:     'Local Dev Track',
    artist:   'Dev Artist',
    album:    'Dev Album',
    art:      null,
    duration: 214000,
    progress: 67000,
  },
  device: { name: 'Apartment Hub', volume: 80 },
};

const spotifyDevices = [
  { id: 'dev-pi-001',   name: 'Apartment Hub', type: 'speaker',  isActive: true,  volume: 80 },
  { id: 'dev-comp-001', name: 'Dev Computer',  type: 'computer', isActive: false, volume: 100 },
];

const playlists = [
  { id: 'dev-pl-1', uri: 'spotify:playlist:dev-pl-1', name: 'My Playlist', image: null, total: 12 },
  { id: 'dev-pl-2', uri: 'spotify:playlist:dev-pl-2', name: 'Chill Vibes', image: null, total: 24 },
  { id: 'dev-pl-3', uri: 'spotify:playlist:dev-pl-3', name: 'Work Focus',  image: null, total: 30 },
];

const playlistTracks = Array.from({ length: 8 }, (_, i) => ({
  id:       `dev-t${i + 1}`,
  uri:      `spotify:track:dev-t${i + 1}`,
  name:     `Track ${i + 1}`,
  artist:   `Artist ${String.fromCharCode(65 + i)}`,
  duration: 180000 + i * 15000,
  art:      null,
}));

const bluetoothDevices = [
  { mac: 'AA:BB:CC:DD:EE:01', name: 'Dev Speaker', connected: false },
];

const tvStatus = { appId: '12', appName: 'Netflix', playerState: 'play' };

const tvApps = [
  { id: '12',    name: 'Netflix' },
  { id: '2285',  name: 'YouTube' },
  { id: '13',    name: 'Prime Video' },
  { id: '2553',  name: 'Roku Channel' },
  { id: '22297', name: 'Spotify' },
  { id: '34376', name: 'Disney+' },
  { id: '61322', name: 'Max' },
];

module.exports = {
  lightingState,
  devicesState,
  circadianState,
  nowPlaying,
  spotifyDevices,
  playlists,
  playlistTracks,
  bluetoothDevices,
  tvStatus,
  tvApps,
};
