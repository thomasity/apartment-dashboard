import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    setupFiles: ['test/setup.ts'],
    // Pinned so time-of-day logic (rules, circadian, routines) behaves the same on every machine.
    env: {
      TZ:  'America/Chicago',
      LAT: '38.6270',
      LON: '-90.1994',
    },
    restoreMocks: true,
    // Server logs are noisy — only show them for tests that fail.
    silent: 'passed-only',
  },
});
