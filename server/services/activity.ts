import fs from 'fs';
import { siblingPath } from '../config';
import { errorMessage } from '../util';
import type { ActivityEntry } from '../types';

// What happened to the lights, and who did it — the record behind "why are the lights
// like this?" and the source data for rule suggestions. One JSON object per line in
// lighting-log.jsonl next to config.json, kept for RETENTION_DAYS.
//
// Only changes are logged, never Auto's gradual drift. Repeats of the same thing in the
// same zone close together (dragging a slider, three bulbs on one wall switch) merge into
// one entry: an entry stays open for MERGE_MS after its last update and is written to
// disk when it closes.

export const RETENTION_DAYS = 30;
const RETENTION_MS = RETENTION_DAYS * 24 * 60 * 60 * 1000;
const MERGE_MS     = 10_000;
const PRUNE_MS     = 24 * 60 * 60 * 1000;

const logPath = (): string => siblingPath('lighting-log.jsonl');

let entries: ActivityEntry[] | null = null;
/** zone → the entry that can still absorb a repeat */
const open = new Map<string, { entry: ActivityEntry; timer: NodeJS.Timeout }>();
let lastPrune = 0;

function load(): ActivityEntry[] {
  if (entries) return entries;
  entries = [];
  let raw = '';
  try { raw = fs.readFileSync(logPath(), 'utf8'); }
  catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') console.error('[activity] unreadable log:', errorMessage(err));
  }
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try { entries.push(JSON.parse(line)); } catch { /* a torn last line from a crash */ }
  }
  prune(true);
  return entries;
}

function prune(force = false): void {
  const now = Date.now();
  if (!entries || (!force && now - lastPrune < PRUNE_MS)) return;
  lastPrune = now;
  const kept = entries.filter((e) => now - e.at < RETENTION_MS);
  if (kept.length === entries.length) return;
  entries = kept;
  try { fs.writeFileSync(logPath(), kept.map((e) => JSON.stringify(e) + '\n').join('')); }
  catch (err) { console.error('[activity] prune failed:', errorMessage(err)); }
}

function close(zone: string): void {
  const item = open.get(zone);
  if (!item) return;
  clearTimeout(item.timer);
  open.delete(zone);
  load().push(item.entry);
  try { fs.appendFileSync(logPath(), JSON.stringify(item.entry) + '\n'); }
  catch (err) { console.error('[activity] write failed:', errorMessage(err)); }
  prune();
}

const sameKind = (a: ActivityEntry, b: Omit<ActivityEntry, 'at'>): boolean =>
  a.action === b.action && a.source === b.source && a.rule === b.rule
  && JSON.stringify(a.bulbs ?? null) === JSON.stringify(b.bulbs ?? null);

export function record(entry: Omit<ActivityEntry, 'at'>): void {
  load();
  const now  = Date.now();
  const prev = open.get(entry.zone);
  if (prev && sameKind(prev.entry, entry) && now - prev.entry.at < MERGE_MS) {
    // Keep the latest values (a drag ends where you let go) but stay one entry
    prev.entry = { ...prev.entry, ...entry, at: now };
    clearTimeout(prev.timer);
    prev.timer = setTimeout(() => close(entry.zone), MERGE_MS);
    return;
  }
  close(entry.zone);
  open.set(entry.zone, { entry: { ...entry, at: now }, timer: setTimeout(() => close(entry.zone), MERGE_MS) });
}

/** Entries since `since` (ms), oldest first, optionally for one zone — including ones still open. */
export function list(since = 0, zone?: string): ActivityEntry[] {
  const all = [...load(), ...[...open.values()].map((o) => o.entry)]
    .filter((e) => e.at >= since && (!zone || e.zone === zone));
  return all.sort((a, b) => a.at - b.at);
}

/** Write any open entries now (shutdown, tests). */
export function flush(): void {
  [...open.keys()].forEach(close);
}
