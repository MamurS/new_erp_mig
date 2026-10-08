import { defineConfig } from 'vitest/config';

// One `vitest run` for the whole repository: the web app (jsdom, its own vite config), the API (node; the
// Postgres suites need DATABASE_URL) and the packages without a browser (node), plus the repository scripts.
export default defineConfig({
  test: {
    projects: [
      'apps/web/vite.config.ts',
      'apps/api/vitest.config.ts',
      {
        test: {
          name: 'packages',
          globals: true,
          environment: 'node',
          include: ['packages/*/src/**/*.test.ts', 'scripts/**/*.test.ts'],
          testTimeout: 20000,
        },
      },
    ],
  },
});
