import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// The API's tests. Suites that need Postgres skip themselves without DATABASE_URL (CI job `api`). They share one
// database, so files run one after another; the global teardown puts the canonical seed back.
export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('../web/src', import.meta.url)) } },
  test: {
    name: 'api',
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    fileParallelism: false,
    testTimeout: 120_000,
    hookTimeout: 120_000,
    globalSetup: ['./src/test/globalSetup.ts'],
  },
});
