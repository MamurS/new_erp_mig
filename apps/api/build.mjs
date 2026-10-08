#!/usr/bin/env node
/*
 * Builds the API into dist/server.js, the background worker into dist/worker.js and the demo-account provisioning
 * (dev/ci/staging) into dist/provision-demo.js with esbuild (ESM bundles; fastify and pg stay in node_modules).
 * `--watch`: rebuilds on change and restarts the server (`node --watch` on the bundle).
 */
import { build, context } from 'esbuild';
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const options = {
  entryPoints: { server: resolve(here, 'src/server.ts'), worker: resolve(here, 'src/worker.ts'), 'provision-demo': resolve(here, 'src/provisionDemo.ts') },
  outdir: resolve(here, 'dist'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  sourcemap: true,
  // The help engine is imported from the web app by its `@/` alias (tsconfig paths).
  tsconfig: resolve(here, 'tsconfig.json'),
  external: ['fastify', 'pg', 'pg-native'],
  banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" },
  logLevel: 'info',
};

if (process.argv.includes('--watch')) {
  const ctx = await context(options);
  await ctx.rebuild();
  await ctx.watch();
  spawn(process.execPath, ['--watch', '--enable-source-maps', resolve(here, 'dist/server.js')], { stdio: 'inherit', cwd: resolve(here, '../..') });
} else {
  await build(options);
}
