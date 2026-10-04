import { EventEmitter } from 'events';
import type { OverridesMap } from '../types';

const DEFAULT_DURATION_MS = 2 * 60 * 60 * 1000; // 2 hours

interface OverrideEntry {
  expiresAt: number;
  timerId:   NodeJS.Timeout;
}

interface OverrideEvents {
  change: [OverridesMap];
  resume: [string];
}

class OverrideService extends EventEmitter<OverrideEvents> {
  private overrides: Record<string, OverrideEntry> = {};

  set(groupName: string, durationMs = DEFAULT_DURATION_MS): void {
    const existing = this.overrides[groupName];
    if (existing) clearTimeout(existing.timerId);
    const expiresAt = Date.now() + durationMs;
    const timerId = setTimeout(() => this.expire(groupName), durationMs);
    timerId.unref();
    this.overrides[groupName] = { expiresAt, timerId };
    this.emit('change', this.getState());
  }

  clear(groupName: string): void {
    const existing = this.overrides[groupName];
    if (!existing) return;
    clearTimeout(existing.timerId);
    delete this.overrides[groupName];
    this.emit('change', this.getState());
  }

  private expire(groupName: string): void {
    delete this.overrides[groupName];
    this.emit('change', this.getState());
    this.emit('resume', groupName);
  }

  isOverridden(groupName: string): boolean {
    return groupName in this.overrides;
  }

  getState(): OverridesMap {
    const state: OverridesMap = {};
    for (const [name, { expiresAt }] of Object.entries(this.overrides)) {
      state[name] = expiresAt;
    }
    return state;
  }
}

export default new OverrideService();
