import { createLog } from './logs';
import type { MediaEntry } from '../types';

// Music and TV history — data/logs/media.jsonl. Spotify plays, pauses and track changes
// (spotifyPlayer.ts) and TV power and app changes (tvWatcher.ts).

export const mediaLog = createLog<MediaEntry>({ category: 'media', retentionDays: 30 });
