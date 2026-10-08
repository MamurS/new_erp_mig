#!/usr/bin/env node
/*
 * Builds the API into dist/server.js with esbuild (one ESM bundle; fastify and pg stay in node_modules).
 * `--watch`: rebuilds on change and restarts the server (`node --watch` on the bundle).
 */
import { build, context } from 'esbuild';
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const options = {
  entryPoints: [resolve(here, 'src/server.ts')],
  outfile: resolve(here, 'dist/server.js'),
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
  spawn(process.execPath, ['--watch', '--enable-source-maps', options.outfile], { stdio: 'inherit', cwd: resolve(here, '../..') });
} else {
  await build(options);
}
