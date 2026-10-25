// Owns "what's playing on Spotify". One server-side poller serves every dashboard: it
// runs only while a socket is connected, slows down when nothing is playing, wakes up
// right after a track should end, and pushes 'spotify:state' only when something
// actually changed. GET /api/spotify/now-playing reads the same cache.

import axios from 'axios';
import { spotify, artistNames, type SpPlayer } from './spotifyApi';
import * as connectivity from './connectivity';
import { errorMessage } from '../util';
import type { AppServer, NowPlaying } from '../types';

const CACHE_MS         = 4_000;  // GET /now-playing reuses a fetch this recent
const PLAYING_MS       = 5_000;
const IDLE_MS          = 30_000; // paused or nothing playing
const OFFLINE_MS       = 15_000;
const TRACK_END_MS     = 1_500;  // poll this long after a track should have ended
const MIN_DELAY_MS     = 1_000;
const CONTROL_DELAY_MS = 600;    // Spotify takes a moment to reflect a command
const BACKOFF_MS       = 30_000; // 429 without a Retry-After header
const DRIFT_MS         = 3_000;  // push if progress jumps this far (e.g. a seek from your phone)

let current:      NowPlaying | null = null;
let fetchedAt     = 0;
let backoffUntil  = 0;
let inflight:     Promise<NowPlaying | null> | null = null;

let io:       AppServer | null      = null;
let timer:    NodeJS.Timeout | null = null;
let looping   = 0;
let lastPush: { key: string; progress: number; at: number } | null = null;

function toNowPlaying(data: SpPlayer): NowPlaying {
  const item    = data.item;
  const episode = item?.type === 'episode' ? item : undefined;
  const track   = item?.type === 'track'   ? item : undefined;
  return {
    isPlaying: data.is_playing,
    shuffle:   data.shuffle_state ?? false,
    repeat:    data.repeat_state  ?? 'off',
    context: data.context ? { type: data.context.type, uri: data.context.uri } : null,
    item: {
      uri:      item?.uri ?? null,
      name:     item?.name,
      artist:   episode ? (episode.show?.name ?? null)          : (track ? artistNames(track.artists) : null),
      album:    episode ? (episode.show?.publisher ?? null)     : (track?.album?.name ?? null),
      art:      episode ? (episode.images?.[0]?.url ?? null)    : (track?.album?.images?.[0]?.url ?? null),
      duration: item?.duration_ms ?? 0,
      progress: data.progress_ms ?? 0,
      type:     item?.type ?? 'track',
    },
    device: {
      name:   data.device?.name,
      volume: data.device?.volume_percent ?? 100,
    },
  };
}

// Progress ticking forward isn't a change — clients interpolate it. A jump is.
function push(): void {
  const key      = JSON.stringify(current && { ...current, item: { ...current.item, progress: 0 } });
  const progress = current?.item.progress ?? 0;
  const now      = Date.now();
  if (lastPush?.key === key) {
    const expected = lastPush.progress + (current?.isPlaying ? now - lastPush.at : 0);
    if (Math.abs(progress - expected) < DRIFT_MS) return;
  }
  lastPush = { key, progress, at: now };
  io?.emit('spotify:state', current);
}

async function fetchPlayer(): Promise<NowPlaying | null> {
  const now = Date.now();
  try {
    const { data } = await spotify<SpPlayer | ''>('GET', '/me/player?additional_types=track,episode');
    current = data ? toNowPlaying(data) : null;
  } catch (err) {
    const status = axios.isAxiosError(err) ? err.response?.status : undefined;
    if (status === 204) {
      current = null;
    } else if (status === 429 && axios.isAxiosError(err)) {
      const retryAfter = err.response?.headers?.['retry-after'];
      const backoffMs  = retryAfter ? Number(retryAfter) * 1000 : BACKOFF_MS;
      backoffUntil = now + backoffMs;
      console.warn(`[spotify] now-playing: rate limited — Retry-After: ${retryAfter ?? '?'}s (backing off ${backoffMs / 1000}s)`);
      return current;
    } else {
      throw err;
    }
  }
  fetchedAt = now;
  push();
  return current;
}

/**
 * Current player state, fetching only if the cached copy is older than `maxAgeMs`.
 * During a rate-limit back-off the cached copy is returned regardless.
 */
export function getNowPlaying(maxAgeMs = CACHE_MS): Promise<NowPlaying | null> {
  const now = Date.now();
  if (now < backoffUntil || now - fetchedAt < maxAgeMs) return Promise.resolve(current);
  inflight ??= fetchPlayer().finally(() => { inflight = null; });
  return inflight;
}

function delayFor(state: NowPlaying | null): number {
  if (!state?.isPlaying)          return IDLE_MS;
  if (state.item.duration <= 0)   return PLAYING_MS;
  const untilTrackEnd = state.item.duration - state.item.progress + TRACK_END_MS;
  return Math.max(MIN_DELAY_MS, Math.min(PLAYING_MS, untilTrackEnd));
}

function schedule(ms: number): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => void loop(), ms);
}

async function loop(): Promise<void> {
  timer = null;
  if (!io || io.engine.clientsCount === 0) return; // sleep until a dashboard connects
  looping++;
  let next: number;
  try {
    // While known-offline, only probe connectivity — don't keep failing against Spotify.
    if (connectivity.lastKnown() === false && !(await connectivity.checkInternet())) {
      next = OFFLINE_MS;
    } else {
      next = delayFor(await getNowPlaying(0));
    }
  } catch (err) {
    console.warn('[spotify] now-playing poll failed:', axios.isAxiosError(err) ? (err.response?.status ?? err.code) : errorMessage(err));
    const networkError = axios.isAxiosError(err) && !err.response;
    next = networkError && !(await connectivity.checkInternet()) ? OFFLINE_MS : IDLE_MS;
  } finally {
    looping--;
  }
  next = Math.max(next, backoffUntil - Date.now());
  if (!timer) schedule(next); // a refreshSoon() during this loop already scheduled one
}

/** Re-poll shortly — call after sending Spotify a command so dashboards see the result. */
export function refreshSoon(): void {
  schedule(CONTROL_DELAY_MS);
}

/** Start serving dashboards: push state to new sockets and poll while any are connected. */
export function attach(server: AppServer): void {
  io = server;
  io.on('connection', (socket) => {
    if (lastPush) socket.emit('spotify:state', current);
    if (!timer && !looping) schedule(0);
  });
}
