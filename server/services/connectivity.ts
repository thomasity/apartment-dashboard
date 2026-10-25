import { EventEmitter } from 'events';
import axios from 'axios';

// The services the dashboard actually depends on. Probing both means one of them being
// down isn't mistaken for the whole internet being down.
const PROBE_URLS = ['https://api.spotify.com/', 'https://api.open-meteo.com/'];
const CACHE_MS   = 15_000;

let last:     { online: boolean; at: number } | null = null;
let inflight: Promise<boolean> | null              = null;

/** Emits 'change' (online: boolean) whenever a check flips the result. */
export const events = new EventEmitter<{ change: [boolean] }>();

// Any HTTP response — even a 404 — means we got out to the internet; only network
// errors (DNS failure, timeout, unreachable) count as offline.
async function reachable(url: string): Promise<boolean> {
  try {
    await axios.head(url, { timeout: 3000, validateStatus: () => true });
    return true;
  } catch {
    return false;
  }
}

/** Whether the Pi can reach the internet. Cached, and concurrent callers share one probe. */
export function checkInternet(): Promise<boolean> {
  if (last && Date.now() - last.at < CACHE_MS) return Promise.resolve(last.online);
  inflight ??= Promise.all(PROBE_URLS.map(reachable))
    .then((results) => {
      const online  = results.some(Boolean);
      const changed = online !== last?.online;
      last = { online, at: Date.now() };
      if (changed) {
        console.log(`[connectivity] internet ${online ? 'reachable' : 'unreachable'}`);
        events.emit('change', online);
      }
      return online;
    })
    .finally(() => { inflight = null; });
  return inflight;
}

/** Result of the most recent check, or null if we've never needed to check. */
export function lastKnown(): boolean | null {
  return last?.online ?? null;
}
