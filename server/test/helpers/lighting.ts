import { vi } from 'vitest';
import { connectedManager } from './fakeMqtt';
import { clearActivityLog, writeConfig } from './config';
import type { AppServer, ConfigSchema, Z2MDevice } from '../../types';

/**
 * The lighting services (controller, presence, rules, rooms) wired to a fake bridge,
 * without HTTP. Config starts at the current schema with whatever `config` adds. Bulbs
 * start on at 70% / 30, and the publish log is cleared once startup has settled.
 */
export async function lightingStack(devices?: Z2MDevice[], config: Partial<ConfigSchema> = {}) {
  clearActivityLog();
  writeConfig({ lightingSchema: 2, ...config });
  vi.resetModules();
  const controller = await import('../../services/controller');
  const presence   = await import('../../services/presence');
  const rules      = await import('../../services/rules');
  const rooms      = await import('../../services/rooms');
  const circadian  = await import('../../services/circadian');
  const { mgr, client } = connectedManager(devices);
  const io = { emit: vi.fn() } as unknown as AppServer;
  controller.init(mgr, io);
  presence.init(mgr);
  client.reset();
  return { controller, presence, rules, rooms, circadian, mgr, client, io };
}
