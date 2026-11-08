import { describe, expect, it } from 'vitest';
import { computePatterns, type PatternInput } from '../../services/patterns';
import type { ActivityEntry, AssistantEntry, MediaEntry, PresenceLogEntry } from '../../types';

const NOW = new Date(2026, 5, 22, 10, 0).getTime(); // a Monday morning

/** hh:mm on the day `daysAgo` before NOW's date (hh may pass 24 for after midnight). */
const at = (daysAgo: number, hh: number, mm: number) =>
  new Date(2026, 5, 22 - daysAgo, hh, mm).getTime();
const isWeekend = (daysAgo: number) => [0, 6].includes(new Date(at(daysAgo, 12, 0)).getDay());
const DAYS = Array.from({ length: 28 }, (_, i) => i + 1);

/** Four weeks of a typical routine, with a few minutes' wobble. */
function routine(): PatternInput {
  const presence: PresenceLogEntry[] = [], lighting: ActivityEntry[] = [], media: MediaEntry[] = [];
  const occ = (t: number, sensor: string, occupied: boolean) => presence.push({ at: t, sensor, room: sensor, occupied });
  for (const d of DAYS) {
    const j = (d % 3) * 5 - 5; // -5, 0, +5
    if (isWeekend(d)) {
      occ(at(d, 9, 30 + j), 'bedroom', true);
      lighting.push({ at: at(d, 23, 50), zone: 'living', source: 'dashboard', action: 'off' });
      continue;
    }
    occ(at(d, 6, 40 + j), 'bedroom', true);
    occ(at(d, 6, 55), 'bedroom', false);
    occ(at(d, 7, 0), 'bath', true);
    lighting.push({ at: at(d, 6, 45 + j), zone: 'bath', source: 'dashboard', action: 'on', look: { brightness: 80, colorTemp: 70 } });
    media.push({ at: at(d, 6, 50 + j), device: 'spotify', action: 'play', source: 'voice', title: 'x', from: 'Morning Mix', fromUri: 'spotify:playlist:mm' });
    media.push({ at: at(d, 7, 30 + j), device: 'spotify', action: 'pause', source: 'other' });
    lighting.push({ at: at(d, 8, 5 + j), zone: 'bath', source: 'dashboard', action: 'off' });
    occ(at(d, 8, 10 + j), 'bath', false);          // everyone out
    occ(at(d, 18, 5 + j), 'hall', true);           // home again
    occ(at(d, 18, 15 + j), 'hall', false);         // on the sofa, where there's no sensor…
    lighting.push({ at: at(d, 18, 20 + j), zone: 'living', source: 'voice', action: 'on' }); // …with the lights on
    lighting.push({ at: at(d, 23, 30 + j), zone: 'living', source: 'dashboard', action: 'off' });
  }
  const sort = <T extends { at: number }>(xs: T[]) => xs.sort((a, b) => a.at - b.at);
  return { presence: sort(presence), lighting: sort(lighting), media: sort(media), assistant: [] };
}

const names = (z: string) => ({ bath: 'Bathroom', living: 'Living Room' }[z] ?? z);

describe('patterns', () => {
  it('finds a weekday routine at its real times, in the order the day happens', () => {
    const p = computePatterns(routine(), NOW, names);
    expect(p.weekdays.map((h) => h.text)).toEqual([
      '6:40 AM day starts ±5 min · 20 of 20 weekdays',
      '6:45 AM Bathroom lights on (80% cool) ±5 min · 20 of 20 weekdays',
      '6:50 AM Spotify: Morning Mix, about 40 min ±5 min · 20 of 20 weekdays',
      '8:05 AM Bathroom lights off ±5 min · 20 of 20 weekdays',
      '8:10 AM leaves (out about 10 h) ±5 min · 20 of 20 weekdays',
      '6:05 PM home again ±5 min · 20 of 20 weekdays',
      '6:20 PM Living Room lights on ±5 min · 20 of 20 weekdays',
      '11:30 PM Living Room lights off ±5 min · 20 of 20 weekdays',
      '11:30 PM day ends ±5 min · 20 of 20 weekdays',
    ]);
    expect(p.weekdays.find((h) => h.kind === 'music')).toMatchObject({ fromUri: 'spotify:playlist:mm', duration: 40 });
  });

  it('keeps weekends separate', () => {
    const p = computePatterns(routine(), NOW, names);
    expect(p.weekends.map((h) => h.text)).toEqual([
      '9:30 AM day starts ±5 min · 8 of 8 weekend days',
      '11:50 PM Living Room lights off ±5 min · 8 of 8 weekend days',
      '11:50 PM day ends ±5 min · 8 of 8 weekend days',
    ]);
  });

  it('a late night belongs to the day it started on', () => {
    const input = routine();
    input.lighting = input.lighting.filter((e) => e.zone !== 'living');
    for (const d of DAYS) if (!isWeekend(d)) input.lighting.push({ at: at(d, 25, 10), zone: 'living', source: 'voice', action: 'off' });
    input.lighting.sort((a, b) => a.at - b.at);
    const end = computePatterns(input, NOW, names).weekdays.find((h) => h.kind === 'day-end');
    expect(end).toMatchObject({ minutes: 70 }); // 1:10 AM
  });

  it('leaves out what only happens now and then', () => {
    const input = routine();
    // TV on some evenings — 6 of 20 weekdays isn't a habit
    input.media.push(...DAYS.filter((d) => !isWeekend(d)).slice(0, 6)
      .map((d): MediaEntry => ({ at: at(d, 20, 0), device: 'tv', action: 'on', source: 'other', app: 'Netflix' })));
    input.media.sort((a, b) => a.at - b.at);
    expect(computePatterns(input, NOW, names).weekdays.some((h) => h.kind === 'tv')).toBe(false);
  });

  it('needs a week of history before it says anything', () => {
    const input = routine();
    const recent = <T extends { at: number }>(xs: T[]) => xs.filter((e) => e.at > at(4, 0, 0));
    const p = computePatterns({ presence: recent(input.presence), lighting: recent(input.lighting), media: recent(input.media), assistant: [] }, NOW);
    expect(p).toMatchObject({ historyDays: 4, weekdays: [], weekends: [] });
  });

  it('summarises the assistant: busiest tools, repeated asks, recurring failures', () => {
    const turn = (request: string, tools: AssistantEntry['tools']): AssistantEntry =>
      ({ at: at(1, 12, 0), trigger: 'voice', request, reply: '', tools });
    const lights = { name: 'control_lights', input: {}, ok: true };
    const missing = { name: 'play_spotify', input: {}, ok: false, error: 'Playlist "chill" not found.' };
    const p = computePatterns({ ...routine(), assistant: [
      turn('Turn off the lights.', [lights]),
      turn('turn off the lights', [lights]),
      turn('Turn off the lights!', [lights]),
      turn('play chill', [missing]),
      turn('play chill stuff', [missing]),
    ] }, NOW);
    expect(p.assistant).toEqual({
      requests: 5,
      topTools: [{ name: 'control_lights', count: 3 }, { name: 'play_spotify', count: 2 }],
      repeated: [{ request: 'turn off the lights', count: 3 }],
      failures: [{ name: 'play_spotify', error: 'Playlist "chill" not found.', count: 2 }],
    });
  });
});

describe('GET /api/patterns', () => {
  it('serves the saved summary, and refresh recomputes it', async () => {
    const { default: request } = await import('supertest');
    const { startApp } = await import('../helpers/app');
    const { writeConfig, readConfig } = await import('../helpers/config');
    writeConfig({ lightingSchema: 2 });
    const ctx = await startApp();
    try {
      const { body } = await request(ctx.app).get('/api/patterns').expect(200);
      expect(body).toMatchObject({ historyDays: 0, weekdays: [], weekends: [], assistant: { requests: 0 } });
      expect(readConfig().patterns?.generatedAt).toBe(body.generatedAt); // saved at startup

      const { body: fresh } = await request(ctx.app).post('/api/patterns/refresh').expect(200);
      expect(fresh.generatedAt).toBeGreaterThanOrEqual(body.generatedAt);
    } finally {
      await ctx.close();
    }
  });
});
