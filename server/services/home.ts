import { execFile } from 'child_process';
import { EventEmitter } from 'events';
import * as config from '../config';
import * as roomsSvc from './rooms';
import { ServiceError, errorMessage } from '../util';
import { createLog } from './logs';
import type { MqttManager } from '../mqtt/client';
import type { HomeLogEntry, HomeState, NetworkDevice, TrackedPhone } from '../types';

// Whether you're home, from your phone being on the Wi-Fi. Every minute the Pi asks the
// local network "who's there?" (arp-scan: ARP, which a sleeping phone's Wi-Fi chip still
// answers, unlike ping). Phones still go quiet now and then to save battery, so a phone
// only counts as gone after AWAY_AFTER_MS without a sighting; arriving is noticed on the
// next scan. Arrivals and departures go to data/logs/home.jsonl.
//
// Arriving has two stages, because the phone often joins the Wi-Fi from outside: the
// phone appearing is "arriving"; the first motion in the speaker room (the living room)
// within INSIDE_WITHIN_MS after that is "inside" — the moment the assistant may speak.

const SCAN_MS       = 60_000;
const AWAY_AFTER_MS = 15 * 60_000;
const MAC           = /^([0-9a-f]{2}:){5}[0-9a-f]{2}$/;
const INSIDE_WITHIN_MS = 20 * 60_000;
/** Someone moved in the speaker room this recently = there's someone to talk to */
const LISTENING_MS  = 30 * 60_000;

/**
 * 'arriving' (phone joined the Wi-Fi), 'inside' (then motion in the speaker room), and
 * 'speaker-motion' (any motion there — someone to talk to)
 */
export const homeEvents = new EventEmitter();

let arrivingSince: number | null = null;
/** When Thomas left (his phone last seen), while he's out */
let awaySince: number | null = null;
let lastSpeakerMotion = 0;

export const homeLog = createLog<HomeLogEntry>({ category: 'home', retentionDays: 30 });

/** mac → last sighting */
const seen = new Map<string, NetworkDevice>();
/** mac → home or not, once known */
const status = new Map<string, boolean>();
let startedAt = Date.now();
let timer: NodeJS.Timeout | undefined;
let warned = false;

const phones = (): TrackedPhone[] => config.get('phones') ?? [];

/** arp-scan --plain output: "ip<TAB>mac<TAB>vendor" per line. */
export function parseArpScan(output: string): Array<Omit<NetworkDevice, 'lastSeen'>> {
  return output.split('\n').flatMap((line) => {
    const [ip, mac, vendor] = line.trim().split('\t');
    if (!ip || !mac || !MAC.test(mac.toLowerCase())) return [];
    // A randomized ("private") address has no maker: arp-scan says "(Unknown: locally administered)"
    const maker = vendor?.trim();
    return [{ ip, mac: mac.toLowerCase(), vendor: maker && !maker.startsWith('(Unknown') ? maker : null }];
  });
}

/** Fold one scan's results in, and log any phone that arrived or left. */
export function update(found: Array<Omit<NetworkDevice, 'lastSeen'>>, now = Date.now()): void {
  found.forEach((d) => seen.set(d.mac, { ...d, lastSeen: now }));
  for (const { mac } of phones()) {
    const lastSeen = seen.get(mac)?.lastSeen;
    const home =
        lastSeen !== undefined && now - lastSeen < AWAY_AFTER_MS ? true
      : now - startedAt >= AWAY_AFTER_MS                         ? false
      : null; // just started and not seen yet: could be asleep
    if (home === null) continue;
    const before = status.get(mac);
    status.set(mac, home);
    if (before === undefined || before === home) continue; // the first verdict is where things stand
    homeLog.record({ mac, home, ...(!home && lastSeen !== undefined && { lastSeen }) });
    if (home) {
      arrivingSince = now;
      awaySince = null;
      homeEvents.emit('arriving');
    } else {
      awaySince = lastSeen ?? now;
    }
    console.log(`[home] ${phones().find((p) => p.mac === mac)?.name ?? mac}: ${home ? 'arrived' : 'left'}`);
  }
}

/** The room the assistant speaks in: the setting, else a room called "Living Room". */
export function speakerRoom(): string | null {
  return config.get('speakerRoom') ?? roomsSvc.findRoom('living room');
}

/** Motion somewhere; in the speaker room it can complete an arrival. */
export function noteMotion(room: string | null, now = Date.now()): void {
  const speaker = speakerRoom();
  if (speaker && room !== speaker) return;
  lastSpeakerMotion = now;
  if (arrivingSince !== null && now - arrivingSince <= INSIDE_WITHIN_MS) {
    arrivingSince = null;
    homeEvents.emit('inside');
  }
  homeEvents.emit('speaker-motion');
}

/** How long Thomas has been out (ms), or null when he isn't. */
export function awayFor(now = Date.now()): number | null {
  return isHome() === false && awaySince !== null ? now - awaySince : null;
}

/** When he last left — for "what happened while you were out". */
export function lastLeft(): number | null {
  return [...homeLog.list()].reverse().find((e) => !e.home)?.lastSeen ?? null;
}

/** When his phone last came back onto the Wi-Fi. */
export function lastArrived(): number | null {
  return [...homeLog.list()].reverse().find((e) => e.home)?.at ?? null;
}

/** Is there someone to talk to: not away, and recent motion in the speaker room. */
export function listening(now = Date.now()): boolean {
  return isHome() !== false && now - lastSpeakerMotion < LISTENING_MS;
}

/** Home if any tracked phone is; null when there's no phone set up or it's too soon to say. */
export function isHome(): boolean | null {
  const known = phones().map((p) => status.get(p.mac)).filter((s): s is boolean => s !== undefined);
  if (known.length === 0) return null;
  return known.some(Boolean);
}

export function getState(): HomeState {
  return {
    home: isHome(),
    phones: phones().map((p) => ({ ...p, home: status.get(p.mac) ?? null, lastSeen: seen.get(p.mac)?.lastSeen ?? null })),
  };
}

/** Everything seen on the network in the last hour, most recent first — for picking your phone. */
export function devices(now = Date.now()): NetworkDevice[] {
  return [...seen.values()].filter((d) => now - d.lastSeen < 60 * 60_000).sort((a, b) => b.lastSeen - a.lastSeen);
}

export function addPhone(mac: string, name: string): void {
  const m = mac.trim().toLowerCase();
  if (!MAC.test(m)) throw new ServiceError('mac must look like aa:bb:cc:dd:ee:ff', 'INVALID');
  config.set('phones', [...phones().filter((p) => p.mac !== m), { mac: m, name: name.trim() || 'Phone' }]);
}

export function removePhone(mac: string): void {
  const m = mac.toLowerCase();
  if (!phones().some((p) => p.mac === m)) throw new ServiceError('Not a tracked phone', 'NOT_FOUND');
  config.set('phones', phones().filter((p) => p.mac !== m));
  status.delete(m);
}

function scan(): Promise<string> {
  const iface = process.env.ARP_SCAN_INTERFACE;
  const args = ['--localnet', '--quiet', '--plain', '--retry=3', ...(iface ? [`--interface=${iface}`] : [])];
  return new Promise((resolve, reject) => {
    execFile('arp-scan', args, { timeout: 30_000 }, (err, stdout) => (err ? reject(err) : resolve(stdout)));
  });
}

async function tick(): Promise<void> {
  try {
    update(parseArpScan(await scan()));
  } catch (err) {
    // Say it once — a missing arp-scan or permission would otherwise log every minute
    if (!warned) console.warn('[home] network scan failed (is arp-scan installed with cap_net_raw?):', errorMessage(err));
    warned = true;
  }
}

/** Follow motion sensors (for arriving → inside). Scanning starts separately, in start(). */
export function init(mgr: MqttManager): void {
  mgr.on('occupancyChange', ({ sensor, occupancy }) => {
    if (occupancy) noteMotion(config.get('presence')?.[sensor]?.room ?? null);
  });
}

/** Start scanning. Only from index.ts — tests and mock mode never touch the network. */
export function start(): void {
  startedAt = Date.now();
  clearInterval(timer);
  void tick();
  timer = setInterval(() => void tick(), SCAN_MS);
  timer.unref?.();
}
