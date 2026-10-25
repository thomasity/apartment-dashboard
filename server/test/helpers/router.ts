import express, { type Router } from 'express';
import { vi } from 'vitest';

/**
 * Mounts a single router on a bare Express app. Modules are reset first so per-module
 * caches (Spotify token, weather cache, …) start empty in every test.
 */
export async function mountRouter(mountPath: string, load: () => Promise<{ default: Router }>) {
  vi.resetModules();
  const { default: router } = await load();
  const app = express();
  app.use(express.json());
  app.use(mountPath, router);
  return app;
}
