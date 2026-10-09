import { defineConfig, devices, type PlaywrightTestConfig } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// In the managed container a Chromium build is preinstalled; CI installs its own via `playwright install`.
const localChromium = process.env.PW_CHROMIUM_PATH ?? '/opt/pw-browsers/chromium';
const executablePath = !process.env.CI && existsSync(localChromium) ? localChromium : undefined;
// PW_PORT: another port, so that several checkouts can run e2e side by side.
const PORT = Number(process.env.PW_PORT) || 4174;

/*
 * E2E_BACKEND=1 — the same suite against the real backend (BACKEND_SPEC §12.3, CI job `e2e-backend`): the API
 * (apps/api/dist/server.js, APP_ENV=ci) over the local Supabase stack, and the app built with VITE_USE_MOCKS=false
 * served by `vite preview`, which proxies /api to the API — one origin, so the session cookie is first-party.
 * Tests share the database and reset it before each (e2e/test.ts), so they run one at a time.
 */
const BACKEND = process.env.E2E_BACKEND === '1';
// 8787: the address the Send SMS hook of the local Supabase stack calls (supabase/config.toml); the API listens on
// all interfaces so the hook reaches it from the Docker network (codes of phones added by tests, the test mode).
const API_PORT = Number(process.env.E2E_API_PORT) || 8787;
// E2E_API_REPLICAS=2 (CI): two API processes behind a round-robin balancer on API_PORT (scripts/e2e-api-lb.mjs) —
// consecutive requests of one test reach different replicas, as with API_REPLICAS behind Caddy.
const API_REPLICAS = Math.max(1, Number(process.env.E2E_API_REPLICAS) || 1);
const replicaPorts = API_REPLICAS === 1 ? [API_PORT] : Array.from({ length: API_REPLICAS }, (_, i) => API_PORT + 10 + i);
const root = fileURLToPath(new URL('../..', import.meta.url));

/** SUPABASE_URL and the service role key: from the environment (CI) or the local stack (`supabase status`). */
function supabaseEnv(): Record<string, string> {
  if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY)
    return { SUPABASE_URL: process.env.SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY };
  const out = execFileSync('npx', ['supabase', 'status', '-o', 'json'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  const s = JSON.parse(out.slice(out.indexOf('{'))) as { API_URL?: string; SERVICE_ROLE_KEY?: string };
  if (!s.API_URL || !s.SERVICE_ROLE_KEY) throw new Error('E2E_BACKEND: no Supabase stack (npx supabase start)');
  return { SUPABASE_URL: s.API_URL, SUPABASE_SERVICE_ROLE_KEY: s.SERVICE_ROLE_KEY };
}

const mockServer: WebServer = {
  command: `npx vite build --outDir dist-e2e --emptyOutDir && npx vite preview --outDir dist-e2e --port ${PORT} --strictPort`,
  url: `http://localhost:${PORT}`,
  reuseExistingServer: !process.env.CI,
  timeout: 180_000,
  env: { VITE_USE_MOCKS: 'true', VITE_DEMO_MODE: 'true', VITE_SEED_XSS: 'true' },
};

type WebServer = NonNullable<Extract<PlaywrightTestConfig['webServer'], unknown[]>>[number];

const apiServer = (port: number): WebServer => ({
    // The API as CI runs it: demo routes and knobs, test MFA codes, the `__Host-` cookie (Chromium accepts Secure
    // cookies on http://localhost). Built beforehand: `npm run api:build`.
    command: 'node --enable-source-maps apps/api/dist/server.js',
    cwd: root,
    url: `http://127.0.0.1:${port}/api/__demo/failures`,
    reuseExistingServer: false,
    timeout: 60_000,
    // Failures only (LOG_LEVEL=warn): a 500 of the API shows its error in the run's output.
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      APP_ENV: 'ci',
      // The test MFA mode (000000, demo factors, «Войти как…»): off unless asked for (apps/api/src/env.ts).
      ALLOW_TEST_TOTP: 'true',
      // The worker polls the EDO operator every pass: a short pause keeps «signed in EDO» within seconds.
      WORKER_INTERVAL_MS: '2000',
      HOST: '0.0.0.0',
      PORT: String(port),
      DATABASE_URL: process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
      DEMO_PASSWORD: 'Demo-2026!',
      // Invitation e-mails go to Mailpit (docker-compose.test.yml); their links lead to this app.
      SMTP_HOST: '127.0.0.1',
      SMTP_PORT: '1025',
      SMTP_TLS: 'none',
      SMTP_FROM: 'MIG DMS <noreply@mig.test>',
      INVITE_REDIRECT_URL: `http://localhost:${PORT}/`,
      LOG_LEVEL: 'warn',
      ...supabaseEnv(),
    },
});

const backendServers = (): WebServer[] => [
  ...replicaPorts.map(apiServer),
  ...(API_REPLICAS > 1
    ? [
        {
          command: `node scripts/e2e-api-lb.mjs ${API_PORT} ${replicaPorts.join(' ')}`,
          cwd: root,
          url: `http://127.0.0.1:${API_PORT}/api/__demo/failures`,
          reuseExistingServer: false,
          timeout: 30_000,
        },
      ]
    : []),
  {
    command: `npx vite build --outDir dist-e2e-backend --emptyOutDir && npx vite preview --outDir dist-e2e-backend --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    timeout: 180_000,
    env: { VITE_USE_MOCKS: 'false', VITE_DEMO_MODE: 'true', API_PROXY: `http://127.0.0.1:${API_PORT}` },
  },
];

export default defineConfig({
  testDir: './e2e',
  timeout: BACKEND ? 90_000 : 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  workers: BACKEND ? 1 : process.env.CI ? 2 : 4,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    locale: 'ru-RU',
    timezoneId: 'Asia/Tashkent',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: BACKEND ? 'chromium-backend' : 'chromium', use: { ...devices['Desktop Chrome'], launchOptions: { executablePath } } }],
  webServer: BACKEND ? backendServers() : mockServer,
});
