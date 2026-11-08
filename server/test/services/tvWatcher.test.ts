import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockAxios } from '../helpers/http';
import { clearLogs, writeConfig } from '../helpers/config';

const ROKU = 'http://192.168.1.50:8060';
let tv: { power: string; app: string };

async function load() {
  vi.resetModules();
  const watcher = await import('../../services/tvWatcher');
  const { mediaLog } = await import('../../services/media');
  return { watcher, mediaLog };
}

beforeEach(() => {
  clearLogs();
  writeConfig({ rokuIp: '192.168.1.50' });
  tv = { power: 'PowerOn', app: '<app id="12">Netflix</app>' };
  mockAxios({
    [`GET ${ROKU}/query/device-info`]: () => `<device-info><power-mode>${tv.power}</power-mode></device-info>`,
    [`GET ${ROKU}/query/active-app`]:  () => `<active-app>${tv.app}</active-app>`,
  });
});

describe('TV watcher', () => {
  it('logs power and app changes after the first look, crediting our own commands', async () => {
    const { watcher, mediaLog } = await load();
    await watcher.check(); // starting point
    expect(mediaLog.list()).toEqual([]);

    tv.app = '<app id="837">YouTube</app>';
    await watcher.check();
    tv.app = '<app>Roku</app>'; // home screen
    await watcher.check();
    watcher.noteCommand('voice');
    tv.power = 'DisplayOff';
    await watcher.check();
    await watcher.check(); // still off: nothing new

    expect(mediaLog.list().map(({ action, source, app }) => ({ action, source, app }))).toEqual([
      { action: 'app', source: 'other', app: 'YouTube' },
      { action: 'app', source: 'other', app: 'Roku' },
      { action: 'off', source: 'voice', app: undefined },
    ]);
  });

  it('an unreachable TV counts as off, and no Roku configured means no checks', async () => {
    const { watcher, mediaLog } = await load();
    await watcher.check();
    mockAxios({}); // unreachable
    await watcher.check();
    expect(mediaLog.list()).toMatchObject([{ device: 'tv', action: 'off' }]);

    writeConfig({});
    const calls = mockAxios({});
    await watcher.check();
    expect(calls).toEqual([]);
  });
});
