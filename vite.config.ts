/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';
import { readFileSync } from 'node:fs';

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

export default defineConfig(({ mode }) => {
  // `npm run dev` works out of the box: mocks and demo mode on unless overridden.
  if (mode === 'development') {
    process.env.VITE_DEMO_MODE ??= 'true';
  }
  // There is no real backend yet: mocks are on unless explicitly disabled.
  process.env.VITE_USE_MOCKS ??= 'true';
  return {
    plugins: [react(), previewHeaders()],
    resolve: {
      alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
    },
    build: {
      sourcemap: false,
      modulePreload: { polyfill: false },
      chunkSizeWarningLimit: 1200,
    },
    server: { port: 5173 },
    preview: { port: 4173 },
    test: {
      globals: true,
      environment: 'jsdom',
      setupFiles: ['./vitest.setup.ts'],
      include: ['src/**/*.test.{ts,tsx}', 'tests/**/*.test.ts'],
      testTimeout: 20000,
      env: { VITE_USE_MOCKS: 'true', VITE_DEMO_MODE: 'false', VITE_API_BASE_URL: 'http://localhost/api' },
    },
  };
});
