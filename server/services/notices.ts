import * as config from '../config';
import * as controller from './controller';
import * as rulesSvc from './rules';
import * as home from './home';
import { feedbackLog } from './feedback';
import { dateKey } from './rules';
import { genId } from '../util';
import type { AppServer, Notice, NoticesState } from '../types';

// The assistant's remarks. Each one shows as a note on every open dashboard; it's also
// read aloud by one dashboard — the one touched most recently, since a browser can only
// play sound after a tap — until the speakerphone on the Pi takes over.
//
// Remarks wait while Thomas is out or not in the living room, and are delivered when he
// is (home.ts 'inside' / 'speaker-motion'). Nothing is spoken during quiet hours or past
// the daily limit; those still show as notes.

const QUIET_FROM  = 23 * 60;   // 11 PM
const QUIET_UNTIL = 7 * 60;    // 7 AM
export const DAILY_LIMIT = 5;
const SHOW_MS = 2 * 60 * 60 * 1000;    // a delivered note stays up this long
const HOLD_MS = 12 * 60 * 60 * 1000;   // a held remark older than this isn't worth saying

let io: AppServer | null = null;
/** The dashboard that speaks: the one touched most recently */
let speaker: { socketId: string; at: number } | null = null;

const getState = (): NoticesState =>
  config.get('notices') ?? { items: [], today: { day: dateKey(new Date()), count: 0 } };

function save(state: NoticesState): void {
  const now = Date.now();
  // Keep what's held (until it's stale) and what was delivered in the last day
  state.items = state.items.filter((n) => (n.held ? now - n.at < HOLD_MS : now - (n.deliveredAt ?? n.at) < 24 * 60 * 60 * 1000));
  config.set('notices', state);
}

export function quietHours(at = new Date()): boolean {
  const m = at.getHours() * 60 + at.getMinutes();
  return m >= QUIET_FROM || m < QUIET_UNTIL;
}

function deliver(state: NoticesState, notice: Notice): void {
  const today = dateKey(new Date());
  if (state.today.day !== today) state.today = { day: today, count: 0 };
  notice.held = false;
  notice.deliveredAt = Date.now();
  const speak = notice.speak && !quietHours() && state.today.count < DAILY_LIMIT;
  state.today.count++;
  io?.emit('assistant:notice', notice);
  if (speak && speaker) io?.to(speaker.socketId).emit('assistant:say', { id: notice.id, text: notice.text });
}

/** Say something. Delivered now if Thomas is around, else held until he is. */
export function notify(remark: { text: string; undo?: Notice['undo']; speak?: boolean }): Notice {
  const state = getState();
  const notice: Notice = { id: genId(), at: Date.now(), text: remark.text, speak: remark.speak ?? true, held: true,
    ...(remark.undo && { undo: remark.undo }) };
  state.items.push(notice);
  if (home.listening()) deliver(state, notice);
  save(state);
  return notice;
}

/** Thomas is here: say what's been waiting, oldest first. */
export function releaseHeld(): void {
  if (!home.listening()) return; // motion with your phone away is someone else
  const state = getState();
  const held = state.items.filter((n) => n.held && Date.now() - n.at < HOLD_MS);
  if (!held.length) return;
  held.forEach((n) => deliver(state, n));
  save(state);
}

/** Notes to show: delivered in the last couple of hours and not dismissed. */
export function active(): Notice[] {
  const now = Date.now();
  return getState().items.filter((n) => !n.held && !n.dismissed && now - (n.deliveredAt ?? 0) < SHOW_MS);
}

export function dismiss(id: string): boolean {
  const state = getState();
  const n = state.items.find((x) => x.id === id);
  if (!n) return false;
  n.dismissed = true;
  save(state);
  return true;
}

/** Undo what the note is about. That's a "no" for the assistant, too. */
export function undo(id: string): boolean {
  const state = getState();
  const n = state.items.find((x) => x.id === id);
  if (!n?.undo) return false;
  if (n.undo.kind === 'look') {
    controller.endAssistant(n.undo.zone, true); // logs its own feedback
  } else {
    rulesSvc.undo(n.undo.changeId, { by: 'dashboard' });
    feedbackLog.record({ kind: 'undone', what: n.text });
  }
  n.dismissed = true;
  save(state);
  return true;
}

export function init(server: AppServer): void {
  io = server;
  io.on('connection', (socket) => {
    socket.on('assistant:active', () => {
      speaker = { socketId: socket.id, at: Date.now() };
    });
    socket.on('disconnect', () => {
      if (speaker?.socketId === socket.id) speaker = null;
    });
  });
  home.homeEvents.on('inside', releaseHeld);
  home.homeEvents.on('speaker-motion', releaseHeld);
}
