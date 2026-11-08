import fs from 'fs';
import path from 'path';
import { logPath } from '../config';
import { errorMessage } from '../util';

// History logs, one JSON-lines file per category in data/logs/ (lighting, presence,
// media, assistant). Each log keeps its entries in memory too, drops anything older than
// its retention, and can hold an entry "open" for a while so a quick follow-up can merge
// into it or cancel it — a slider drag is one entry, and a sensor that blinks "empty"
// for a few seconds is no entry at all.

export interface LogEntry {
  /** ms */
  at: number;
}

const DAY_MS   = 24 * 60 * 60 * 1000;
const PRUNE_MS = DAY_MS;

export interface LogOptions<E extends LogEntry> {
  category:      string;
  retentionDays: number;
  /** How long an entry stays open to merge with or cancel a follow-up (0 = written at once) */
  holdMs?:       number;
  /** Entries only combine with an open entry under the same key */
  keyOf?:        (e: Omit<E, 'at'>) => string;
  /**
   * Given the open entry and a new one under the same key: the merged entry, `null` to
   * drop both (they cancel out), or `undefined` to keep them separate.
   */
  combine?:      (open: E, next: Omit<E, 'at'>) => E | null | undefined;
}

export interface Log<E extends LogEntry> {
  readonly retentionDays: number;
  record(entry: Omit<E, 'at'>): void;
  /** Entries since `since` (ms), oldest first, including ones still open */
  list(since?: number, filter?: (e: E) => boolean): E[];
  /** Write any open entries now */
  flush(): void;
}

const all: Array<Log<LogEntry>> = [];

/** Write every log's open entries — on shutdown. */
export function flushAll(): void {
  all.forEach((log) => log.flush());
}

export function createLog<E extends LogEntry>(opts: LogOptions<E>): Log<E> {
  const { category, retentionDays, holdMs = 0, keyOf = () => '', combine } = opts;
  const retentionMs = retentionDays * DAY_MS;
  const file = (): string => logPath(category);

  let entries: E[] | null = null;
  const open = new Map<string, { entry: E; timer: NodeJS.Timeout }>();
  let lastPrune = 0;

  function load(): E[] {
    if (entries) return entries;
    entries = [];
    let raw = '';
    try { raw = fs.readFileSync(file(), 'utf8'); }
    catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') console.error(`[logs] unreadable ${category} log:`, errorMessage(err));
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
    const kept = entries.filter((e) => now - e.at < retentionMs);
    if (kept.length === entries.length) return;
    entries = kept;
    try {
      fs.mkdirSync(path.dirname(file()), { recursive: true });
      fs.writeFileSync(file(), kept.map((e) => JSON.stringify(e) + '\n').join(''));
    } catch (err) { console.error(`[logs] ${category} prune failed:`, errorMessage(err)); }
  }

  function write(entry: E): void {
    load().push(entry);
    try {
      fs.mkdirSync(path.dirname(file()), { recursive: true });
      fs.appendFileSync(file(), JSON.stringify(entry) + '\n');
    } catch (err) { console.error(`[logs] ${category} write failed:`, errorMessage(err)); }
    prune();
  }

  function close(key: string): void {
    const item = open.get(key);
    if (!item) return;
    clearTimeout(item.timer);
    open.delete(key);
    write(item.entry);
  }

  const hold = (key: string, entry: E): void => {
    open.set(key, { entry, timer: setTimeout(() => close(key), holdMs) });
  };

  const log: Log<E> = {
    retentionDays,

    record(next) {
      load();
      const now = Date.now();
      if (holdMs === 0) return write({ ...next, at: now } as E);

      const key  = keyOf(next);
      const prev = open.get(key);
      if (prev && combine) {
        const result = combine(prev.entry, next);
        if (result !== undefined) {
          clearTimeout(prev.timer);
          open.delete(key);
          if (result) hold(key, { ...result, at: now });
          return;
        }
      }
      close(key);
      hold(key, { ...next, at: now } as E);
    },

    list(since = 0, filter = () => true) {
      return [...load(), ...[...open.values()].map((o) => o.entry)]
        .filter((e) => e.at >= since && filter(e))
        .sort((a, b) => a.at - b.at);
    },

    flush() {
      [...open.keys()].forEach(close);
    },
  };
  all.push(log as unknown as Log<LogEntry>);
  return log;
}
