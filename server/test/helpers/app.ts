import { vi } from 'vitest';
import type { AddressInfo } from 'net';
import { connectedManager } from './fakeMqtt';
import type { Z2MDevice } from '../../types';

/**
 * Builds the full app (routes + services + socket.io) around a fake MQTT client. Modules
 * are reset first so each call gets fresh service state (overrides, circadian, rules…).
 */
export async function startApp(devices?: Z2MDevice[]) {
  vi.resetModules();
  const { mgr, client } = connectedManager(devices);
  const { createApp } = await import('../../app');
  const { app, server, io } = createApp(mgr);

  return {
    app, server, io, mgr, client,

    /** Actually listen (needed for socket.io clients and for routes that call our own API). */
    async listen(): Promise<string> {
      await new Promise<void>((resolve) => server.listen(0, resolve));
      const { port } = server.address() as AddressInfo;
      process.env.PORT = String(port); // util.apiBase() reads this per call
      return `http://localhost:${port}`;
    },

    close: () => new Promise<void>((resolve) => io.close(() => resolve())),
  };
}
