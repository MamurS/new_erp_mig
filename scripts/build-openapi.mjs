#!/usr/bin/env node
/*
 * Generates the integration API contract from the zod schemas (CLINIC_SPEC §6.6):
 *   docs/integration/openapi.yaml         — for the backend team
 *   public/docs/integration/openapi.json  — for the «Документация» tab of the clinic cabinet
 *
 *   node scripts/build-openapi.mjs
 *
 * The TypeScript source is loaded through Vite's SSR loader, so path aliases work as in the app.
 * A unit test fails when the committed files are out of date.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const server = await createServer({
  root,
  configFile: resolve(root, 'vite.config.ts'),
  logLevel: 'error',
  appType: 'custom',
  server: { middlewareMode: true, hmr: false },
  optimizeDeps: { noDiscovery: true, include: [] },
});
try {
  const { buildOpenApi, toYaml } = await server.ssrLoadModule('/src/shared/integration/openapi-files.ts');
  const doc = buildOpenApi();
  const yamlPath = resolve(root, 'docs/integration/openapi.yaml');
  const jsonPath = resolve(root, 'public/docs/integration/openapi.json');
  mkdirSync(dirname(yamlPath), { recursive: true });
  mkdirSync(dirname(jsonPath), { recursive: true });
  writeFileSync(yamlPath, toYaml(doc));
  writeFileSync(jsonPath, `${JSON.stringify(doc, null, 2)}\n`);
  console.log(`Wrote ${yamlPath}\nWrote ${jsonPath}`);
} finally {
  await server.close();
}
