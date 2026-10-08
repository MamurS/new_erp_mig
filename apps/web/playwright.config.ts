import { defineConfig, devices } from '@playwright/test';
import { existsSync } from 'node:fs';

// In the managed container a Chromium build is preinstalled; CI installs its own via `playwright install`.
const localChromium = process.env.PW_CHROMIUM_PATH ?? '/opt/pw-browsers/chromium';
const executablePath = !process.env.CI && existsSync(localChromium) ? localChromium : undefined;
const PORT = 4174;

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  workers: process.env.CI ? 2 : 4,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    locale: 'ru-RU',
    timezoneId: 'Asia/Tashkent',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], launchOptions: { executablePath } } }],
  webServer: {
    command: `npx vite build --outDir dist-e2e --emptyOutDir && npx vite preview --outDir dist-e2e --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: { VITE_USE_MOCKS: 'true', VITE_DEMO_MODE: 'true', VITE_SEED_XSS: 'true' },
  },
});
