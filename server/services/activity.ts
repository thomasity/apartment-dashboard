import { createLog } from './logs';
import type { ActivityEntry } from '../types';

// What happened to the lights, and who did it — the record behind "why are the lights
// like this?" and the source data for rule suggestions. data/logs/lighting.jsonl.
//
// Only changes are logged, never Auto's gradual drift. Repeats of the same thing in the
// same zone close together (dragging a slider, three bulbs on one wall switch) merge into
// one entry that ends up with the latest values.

export const RETENTION_DAYS = 30;
const MERGE_MS = 10_000;

const sameKind = (a: ActivityEntry, b: Omit<ActivityEntry, 'at'>): boolean =>
  a.action === b.action && a.source === b.source && a.rule === b.rule
  && JSON.stringify(a.bulbs ?? null) === JSON.stringify(b.bulbs ?? null);

const log = createLog<ActivityEntry>({
  category:      'lighting',
  retentionDays: RETENTION_DAYS,
  holdMs:        MERGE_MS,
  keyOf:         (e) => e.zone,
  combine:       (open, next) => (sameKind(open, next) ? { ...open, ...next, at: open.at } : undefined),
});

export function record(entry: Omit<ActivityEntry, 'at'>): void {
  log.record(entry);
}

/** Entries since `since` (ms), oldest first, optionally for one zone — including ones still open. */
export function list(since = 0, zone?: string): ActivityEntry[] {
  return log.list(since, (e) => !zone || e.zone === zone);
}

/** Write any open entries now (tests; shutdown goes through logs.flushAll). */
export function flush(): void {
  log.flush();
}
