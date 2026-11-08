import * as activity from './activity';
import * as controller from './controller';
import * as roomsSvc from './rooms';
import * as rulesSvc from './rules';
import { occupancyHistory } from './presence';
import { mediaLog } from './media';
import { assistantLog } from './assistantLog';
import { homeLog } from './home';
import { describe } from './explain';
import type { MediaEntry, Rule, RuleChange } from '../types';

// Every log as short readable lines, for the assistant's get_activity tool: "what was I
// listening to last night?", "when did I get home?", "did motion turn the hall on?".

export const CATEGORIES = ['lights', 'presence', 'home', 'music', 'tv', 'assistant', 'rules'] as const;
export type Category = typeof CATEGORIES[number];

export interface HistoryLine {
  at:       number;
  category: Category;
  text:     string;
  /** Spotify ids, so a song or playlist can be played again exactly */
  uri?:     string;
  fromUri?: string;
}

export interface HistoryQuery {
  categories?: Category[];
  since:       number;
  /** A room name or id — narrows lights and presence */
  room?:       string;
  /** Most recent N */
  limit?:      number;
}

const who = (source: string): string =>
  source === 'dashboard' ? 'you, dashboard' : source === 'voice' ? 'you, by voice' : source === 'assistant' ? 'the assistant' : 'phone or remote';

function mediaText(e: MediaEntry): string {
  if (e.device === 'tv') {
    return e.action === 'app' ? `TV switched to ${e.app} (${who(e.source)})`
      : `TV turned ${e.action}${e.app ? ` — ${e.app}` : ''} (${who(e.source)})`;
  }
  const song = [e.title && `"${e.title}"`, e.artist && `by ${e.artist}`].filter(Boolean).join(' ');
  const from = e.from ? ` from ${e.from}` : '';
  if (e.action === 'pause') return `Spotify paused${song ? ` on ${song}` : ''} (${who(e.source)})`;
  if (e.action === 'track') return `Spotify moved on to ${song}${from}`;
  return `Spotify played ${song}${from} (${who(e.source)})`;
}

function ruleText(c: RuleChange): string {
  const name = (c.after ?? c.before)?.name ?? c.ruleId;
  const by = c.by === 'assistant' ? 'the assistant' : c.by === 'voice' ? 'you, by voice' : 'you';
  const verb = c.undoes ? 'undid a change to' : c.change === 'create' ? 'created' : c.change === 'update' ? 'edited' : 'deleted';
  return `${by} ${verb} rule "${name}"${c.reason ? ` — ${c.reason}` : ''} [change ${c.id}]`;
}

export function history({ categories = [...CATEGORIES], since, room, limit = 30 }: HistoryQuery): HistoryLine[] {
  const want = new Set(categories);
  const zone = room ? controller.zonesForTarget(room)[0] ?? room : undefined;
  const roomName = (id: string | null) => (id ? roomsSvc.getRoom(id)?.name ?? id : 'a room with no lights assigned');
  const lines: HistoryLine[] = [];

  if (want.has('lights')) {
    for (const e of activity.list(since, zone)) {
      lines.push({ at: e.at, category: 'lights', text: `${controller.zoneName(e.zone)}: ${describe(e, controller.zoneName)}` });
    }
  }
  if (want.has('presence')) {
    for (const e of occupancyHistory(since)) {
      if (zone && e.room !== zone) continue;
      lines.push({ at: e.at, category: 'presence', text: `${roomName(e.room)} ${e.occupied ? 'occupied' : 'empty'}` });
    }
  }
  if (want.has('home')) {
    for (const e of homeLog.list(since)) {
      lines.push({ at: e.lastSeen ?? e.at, category: 'home', text: e.home ? 'Thomas got home' : 'Thomas left' });
    }
  }
  for (const e of mediaLog.list(since)) {
    const category = e.device === 'tv' ? 'tv' : 'music';
    if (!want.has(category)) continue;
    lines.push({ at: e.at, category, text: mediaText(e), ...(e.uri && { uri: e.uri }), ...(e.fromUri && { fromUri: e.fromUri }) });
  }
  if (want.has('assistant')) {
    for (const e of assistantLog.list(since)) {
      const failed = e.tools.filter((t) => !t.ok).map((t) => `${t.name} failed: ${t.error ?? '?'}`);
      lines.push({
        at: e.at, category: 'assistant',
        text: `${e.trigger === 'timer' ? 'Timer' : 'Asked'}: "${e.request}" → "${e.reply}"${failed.length ? ` (${failed.join('; ')})` : ''}`,
      });
    }
  }
  if (want.has('rules')) {
    for (const c of rulesSvc.changeLog.list(since)) lines.push({ at: c.at, category: 'rules', text: ruleText(c) });
  }

  return lines.sort((a, b) => a.at - b.at).slice(-limit);
}

// ── Rules, phrased ──────────────────────────────────────────────────────────

const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const timeText = (spec: string): string => {
  if (spec === 'sunrise' || spec === 'sunset') return spec;
  const [h, m] = spec.split(':').map(Number);
  return new Date(2000, 0, 1, h, m).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
};

const daysText = (days: number[]): string => {
  const s = [...days].sort();
  if (s.length === 7) return 'every day';
  if (s.join() === '1,2,3,4,5') return 'weekdays';
  if (s.join() === '0,6') return 'weekends';
  return s.map((d) => DAY_SHORT[d]).join(', ');
};

/** "Bedtime [id abc]: 10:30 PM–7:00 AM weekdays · turn off Living Room · motion: night light 10%" */
export function ruleSummary(rule: Rule): string {
  const a = rule.action;
  const target = a.group === 'all' ? 'all lights' : controller.zoneName(a.group);
  const what =
      a.type === 'power' && !a.on     ? `turn off ${target}`
    : a.type === 'power'              ? `turn on ${target}${a.config === 'scene' ? ` at ${a.brightness}%` : a.config === 'auto' ? ' on Auto' : ''}`
    : a.config === 'scene'            ? `set ${target} to ${a.brightness}%, colour ${a.colorTemp}`
    : a.config === 'auto'             ? `put ${target} on Auto`
    : `change ${target}`;
  const extras = [
    rule.end && rule.presence?.mode === 'custom' ? `motion: night light ${rule.presence.brightness ?? 10}%` : null,
    rule.end && rule.presence?.mode === 'ignore' ? 'motion: ignored' : null,
    rule.overrideManual ? 'overrides manual changes' : null,
    rule.createdBy === 'assistant' ? 'made by the assistant' : null,
    rule.enabled ? null : 'DISABLED',
  ].filter(Boolean);
  return `${rule.name} [id ${rule.id}]: ${timeText(rule.time)}${rule.end ? `–${timeText(rule.end)}` : ''} ${daysText(rule.days)} · ${what}`
    + (extras.length ? ` · ${extras.join(' · ')}` : '');
}
