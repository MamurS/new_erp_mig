/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';
import { readFileSync } from 'node:fs';
import { stripDemoArticles } from './src/shared/help/demoStrip';

/** Parses public/_headers (Cloudflare Pages format) for the `/*` block. */
function readHeaders(): Record<string, string> {
  const text = readFileSync(new URL('./public/_headers', import.meta.url), 'utf8');
  const headers: Record<string, string> = {};
  let inGlobal = false;
  for (const line of text.split('\n')) {
    if (!line.startsWith(' ') && line.trim()) {
      inGlobal = line.trim() === '/*';
      continue;
    }
    if (!inGlobal) continue;
    const idx = line.indexOf(':');
    if (idx > 0) headers[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }
  return headers;
}

/** Applies security headers from public/_headers in `vite preview`. */
function previewHeaders(): Plugin {
  return {
    name: 'mig-preview-headers',
    configurePreviewServer(server) {
      const headers = readHeaders();
      // HSTS / upgrade-insecure-requests would break plain-http localhost preview.
      delete headers['Strict-Transport-Security'];
      const csp = headers['Content-Security-Policy'];
      if (csp) headers['Content-Security-Policy'] = csp.replace(/;\s*upgrade-insecure-requests/, '');
      server.middlewares.use((_req, res, next) => {
        for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
        next();
      });
    },
  };
}

/**
 * The user guide (docs/help/USER_GUIDE.<locale>.md) imported with `?raw` by the mock server. A build
 * without VITE_DEMO_MODE drops the demo-only articles, so their text is not in the bundle at all.
 */
function helpGuide(): Plugin {
  let strip = false;
  return {
    name: 'mig-help-guide',
    enforce: 'pre',
    configResolved(config) {
      strip = config.command === 'build' && process.env.VITE_DEMO_MODE !== 'true';
    },
    load(id) {
      if (!/[\\/]docs[\\/]help[\\/]USER_GUIDE\.[\w-]+\.md\?raw$/.test(id)) return null;
      const file = id.slice(0, -'?raw'.length);
      this.addWatchFile(file);
      const text = readFileSync(file, 'utf8');
      return `export default ${JSON.stringify(strip ? stripDemoArticles(text) : text)};`;
    },
  };
}

export default defineConfig(({ mode }) => {
  // `npm run dev` works out of the box: mocks and demo mode on unless overridden.
  if (mode === 'development') {
    process.env.VITE_DEMO_MODE ??= 'true';
  }
  // Mocks are on unless explicitly disabled (VITE_USE_MOCKS=false: the app talks to the API at /api).
  process.env.VITE_USE_MOCKS ??= 'true';
  /*
   * The app against a local API (README «Запуск с бэкендом», e2e-backend): `/api` of the dev server and of `vite
   * preview` goes to the API, so the app and the API share one origin and the session cookie is first-party (like
   * Caddy in the deployment). DEV/E2E only: API_PROXY, e.g. http://127.0.0.1:8787.
   */
  const apiProxy = process.env.API_PROXY;
  const proxy = apiProxy ? { '/api': { target: apiProxy, xfwd: true } } : undefined;
  return {
    plugins: [react(), previewHeaders(), helpGuide()],
    resolve: {
      alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
    },
    build: {
      sourcemap: false,
      modulePreload: { polyfill: false },
      chunkSizeWarningLimit: 1200,
    },
    server: { port: 5173, ...(proxy ? { proxy } : {}) },
    preview: { port: 4173, ...(proxy ? { proxy } : {}) },
    test: {
      name: 'web',
      root: fileURLToPath(new URL('.', import.meta.url)),
      globals: true,
      environment: 'jsdom',
      setupFiles: ['./vitest.setup.ts'],
      include: ['src/**/*.test.{ts,tsx}', 'tests/**/*.test.ts'],
      testTimeout: 20000,
      env: { VITE_USE_MOCKS: 'true', VITE_DEMO_MODE: 'false', VITE_API_BASE_URL: 'http://localhost/api' },
    },
  };
});