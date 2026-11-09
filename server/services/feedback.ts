import { createLog } from './logs';

// How Thomas reacted to what the assistant did on its own — data/logs/feedback.jsonl.
// Reversing one of its changes within UNDO_WINDOW_MS (or tapping Undo on its note) is a
// "no"; the assistant reads these before acting, so it backs off what he doesn't want.

export const UNDO_WINDOW_MS = 10 * 60 * 1000;

export interface FeedbackEntry {
  at:     number;
  /** undone = he reversed it; kept = it stood */
  kind:   'undone' | 'kept';
  /** What the assistant had done, in its own words */
  what:   string;
  zone?:  string;
}

export const feedbackLog = createLog<FeedbackEntry>({ category: 'feedback', retentionDays: 90 });
