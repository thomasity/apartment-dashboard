import { createLog } from './logs';
import type { AssistantEntry } from '../types';

// Everything you've asked the assistant and what it did about it — data/logs/assistant.jsonl.
// The tool calls and whether they worked are what matter for learning: what you ask
// for again and again, and what it got wrong.

export const assistantLog = createLog<AssistantEntry>({ category: 'assistant', retentionDays: 30 });
