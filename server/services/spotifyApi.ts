import axios, { type Method } from 'axios';

// Spotify Web API client shared by the routes and the now-playing poller.

const CLIENT_ID     = process.env.SPOTIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;

// ── Spotify Web API shapes (only the fields we read) ──────────────────

export interface SpImage   { url: string }
export interface SpArtist  { name: string }
export interface SpAlbum   { id: string; uri: string; name: string; artists: SpArtist[]; images?: SpImage[] }
export interface SpShow    { id: string; uri: string; name: string; publisher: string; images?: SpImage[]; total_episodes: number }
export interface SpTrack   { type: 'track'; id: string; uri: string; name: string; artists: SpArtist[]; album?: SpAlbum; duration_ms: number }
export interface SpEpisode { type: 'episode'; id: string; uri: string; name: string; show?: SpShow; images?: SpImage[]; duration_ms: number }
export interface SpPlaylist {
  id: string; uri: string; name: string; images?: SpImage[] | null;
  owner: { id: string }; collaborative: boolean; tracks?: { total: number };
}
export interface SpDevice  { id: string; name: string; type: string; is_active: boolean; volume_percent: number }
export interface SpPlayer {
  is_playing:     boolean;
  shuffle_state?: boolean;
  repeat_state?:  string;
  progress_ms?:   number;
  context?:       { type: string; uri: string } | null;
  item?:          SpTrack | SpEpisode | null;
  device?:        { name: string; volume_percent: number | null };
}
export interface SpPage<T> { items: T[]; next: string | null; total: number }
export interface SpSearch {
  tracks?:    SpPage<SpTrack>;
  albums?:    SpPage<SpAlbum>;
  playlists?: SpPage<SpPlaylist | null>;
  shows?:     SpPage<SpShow | null>;
  episodes?:  SpPage<SpEpisode | null>;
}

let accessToken: string | null = null;
let tokenExpiresAt = 0;

export const artistNames = (artists: SpArtist[]) => artists.map((a) => a.name).join(', ');

export async function getAccessToken(): Promise<string> {
  if (Date.now() < tokenExpiresAt && accessToken) return accessToken;

  const { data } = await axios.post<{ access_token: string; expires_in: number }>(
    'https://accounts.spotify.com/api/token',
    new URLSearchParams({ grant_type: 'refresh_token', refresh_token: process.env.SPOTIFY_REFRESH_TOKEN ?? '' }),
    {
      headers: {
        'Content-Type':  'application/x-www-form-urlencoded',
        Authorization: `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64')}`,
      },
    },
  );

  accessToken    = data.access_token;
  tokenExpiresAt = Date.now() + (data.expires_in - 60) * 1000;
  return accessToken;
}

export async function spotify<T = unknown>(method: Method, path: string, data?: unknown) {
  const token = await getAccessToken();
  return axios.request<T>({ method, url: `https://api.spotify.com/v1${path}`, data,
    headers: { Authorization: `Bearer ${token}` } });
}

// Spotify's Web API paginates list endpoints via a "next" URL — follow it until
// exhausted and return every item collected along the way.
export async function fetchAllPages<T>(path: string): Promise<T[]> {
  const items: T[] = [];
  let url: string | null = path;
  while (url) {
    const { data }: { data: SpPage<T> } = await spotify<SpPage<T>>('GET', url);
    items.push(...data.items);
    url = data.next ? data.next.replace('https://api.spotify.com/v1', '') : null;
  }
  return items;
}
