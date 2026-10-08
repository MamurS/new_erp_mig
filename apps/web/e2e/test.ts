/*
 * `test` and `expect` of every spec. One suite, two runs (README «e2e против бэкенда»):
 *
 * - the mock run (default): the API is the mock in the page; every test has a fresh browser context, so a fresh
 *   seed — nothing to do here;
 * - the backend run (E2E_BACKEND=1, CI job `e2e-backend`): the built app with VITE_USE_MOCKS=false behind one
 *   origin with the API (APP_ENV=ci). Tests share the database, so each starts from a fresh state: the server's
 *   demo reset (the seed for the current time, the XSS variant the mock run builds with VITE_SEED_XSS), the failure
 *   simulation off and the test clock back at the real time. Workers run one at a time (playwright.config.ts).
 */
import { test as base, expect, type Page } from '@playwright/test';

export { expect };
export type { Locator, Page } from '@playwright/test';

/** The run against the real backend. */
export const BACKEND = process.env.E2E_BACKEND === '1';

const CSRF = { 'X-Requested-With': 'mig-web' };

export const test = base.extend<{ freshData: void }>({
  freshData: [
    async ({ request }, use) => {
      if (BACKEND) {
        // The clock first: the seed is built for the server's «now».
        expect((await request.post('/api/__demo/clock', { data: { offsetMs: 0 }, headers: CSRF })).status()).toBe(200);
        expect((await request.post('/api/__demo/failures', { data: { enabled: false }, headers: CSRF })).status()).toBe(200);
        const reset = await request.post('/api/__demo/reset', { data: { xss: true }, headers: CSRF });
        expect(reset.status(), 'demo reset of the backend').toBe(200);
      }
      await use();
    },
    { auto: true },
  ],
});

/**
 * Moves time forward: the page's clock (installed with `page.clock.install()`) and, against the backend, the
 * server's test clock by the same amount (the mock in the page follows the page's clock by itself).
 */
export async function fastForward(page: Page, by: number | string): Promise<void> {
  await page.clock.fastForward(by);
  if (BACKEND) {
    const ms = typeof by === 'number' ? by : by.split(':').reduce((acc, part) => acc * 60 + Number(part), 0) * 1000;
    const r = await page.request.post('/api/__demo/clock', { data: { advanceMs: ms }, headers: CSRF });
    expect(r.status(), 'test clock of the backend').toBe(200);
  }
}
