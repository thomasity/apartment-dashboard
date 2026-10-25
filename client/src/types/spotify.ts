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

/** Loose shape of whatever was picked in the explorer (playlist, album, show, track…) */
export interface SelectionData {
  id?: string;
  uri?: string;
  name?: string;
  image?: string | null;
  collectionUri?: string;
  artist?: string | null;
}

export interface ExplorerSelection {
  type: string;
  data?: SelectionData;
}

export interface BtDevice {
  mac: string;
  name: string;
  connected: boolean;
}

export interface BtDiscoveredDevice {
  mac: string;
  name?: string;
}
