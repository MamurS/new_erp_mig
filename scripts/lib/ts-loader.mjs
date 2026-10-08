/*
 * Runs a callback with TypeScript modules of the packages loaded through Vite's SSR loader (no build
 * step, no extra dependencies), like scripts/build-openapi.mjs does for the web app.
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/** `load('/packages/domain/src/store/sql/migrations.ts')` inside `fn`. */
export async function withTs(fn) {
  const server = await createServer({
    root,
    configFile: false,
    logLevel: 'error',
    appType: 'custom',
    server: { middlewareMode: true, hmr: false },
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  try {
    return await fn((path) => server.ssrLoadModule(path));
  } finally {
    await server.close();
  }
}
