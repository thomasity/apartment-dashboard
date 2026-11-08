import axios from 'axios';
import { fetchDeviceInfo, parseActiveApp, rokuIp, xmlTag } from './roku';
import { mediaLog } from './media';
import type { MediaSource } from '../types';

// Checks the Roku every minute and logs to the media log when the TV turns on or off or
// switches app. A change soon after one of our own TV commands is credited to whoever
// sent it; otherwise it was the remote.

const POLL_MS    = 60_000;
const COMMAND_MS = 90_000; // a poll can land up to a minute after the command

let timer: NodeJS.Timeout | undefined;
let last: { on: boolean; app: string | null } | null = null;
let lastCommand: { source: MediaSource; at: number } | null = null;

export function noteCommand(source: MediaSource): void {
  lastCommand = { source, at: Date.now() };
}

/** On (and which app), or off — an unreachable or standby TV counts as off. */
async function readTv(ip: string): Promise<{ on: boolean; app: string | null }> {
  try {
    const info = await fetchDeviceInfo(ip, 4000);
    if (xmlTag(info, 'power-mode') !== 'PowerOn') return { on: false, app: null };
    const { data } = await axios.get<string>(`http://${ip}:8060/query/active-app`, { timeout: 4000 });
    return { on: true, app: parseActiveApp(data).name };
  } catch {
    return { on: false, app: null };
  }
}

export async function check(): Promise<void> {
  const ip = rokuIp();
  if (!ip) return;
  const now = await readTv(ip);
  const prev = last;
  last = now;
  if (!prev) return; // the first look is the starting point, not a change

  const source: MediaSource = lastCommand && Date.now() - lastCommand.at < COMMAND_MS ? lastCommand.source : 'other';
  if (now.on !== prev.on) {
    mediaLog.record({ device: 'tv', action: now.on ? 'on' : 'off', source, ...(now.app && { app: now.app }) });
  } else if (now.on && now.app !== prev.app && now.app) {
    mediaLog.record({ device: 'tv', action: 'app', source, app: now.app });
  }
}

export function start(): void {
  clearInterval(timer);
  void check();
  timer = setInterval(() => void check(), POLL_MS);
  timer.unref?.();
}
