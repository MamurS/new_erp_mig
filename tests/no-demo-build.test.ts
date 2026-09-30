// @vitest-environment node
/*
 * SPEC §9.5: a build without VITE_DEMO_MODE must not contain demo accounts, the role switcher or demo codes.
 * Two builds are checked:
 * - production-like (mocks off, real API): no demo code and no mock seed either;
 * - mocks on, demo off (a stand with fake data but no demo tools): no demo endpoints and no simulators.
 */
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

const OUT = 'dist-nodemo';
const OUT_MOCKS = 'dist-nodemo-mocks';

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : [p];
  });
}

function build(outDir: string, useMocks: boolean): string {
  execFileSync('npx', ['vite', 'build', '--outDir', outDir, '--emptyOutDir', '--logLevel', 'error'], {
    env: { ...process.env, NODE_ENV: 'production', VITE_DEMO_MODE: 'false', VITE_USE_MOCKS: String(useMocks), VITE_SEED_XSS: 'false' },
    stdio: 'pipe',
  });
  return files(outDir)
    .filter((f) => /\.(js|css|html|txt|json)$/.test(f))
    .map((f) => readFileSync(f, 'utf8'))
    .join('\n');
}

/** Demo endpoints (the `/__demo/*` helpers, e.g. the card code for the two-payer e2e) and unique strings of both simulators. */
const DEMO_TOOLS = [
  '__demo',
  'mis-card',
  // MIS simulator (clinic cabinet)
  'Симулятор МИС',
  'симулятор МИС',
  'Демо-МИС',
  'Передать расписание из МИС',
  'Проверить пациента из МИС',
  'Отправить реестр из МИС',
  'Ответить на заявки из МИС',
  'mis-simulator',
  // Assistance system simulator (assistance portal)
  'Симулятор системы ассистанса',
  'симулятор системы ассистанса',
  'Синхронизировать список застрахованных',
  'Решить все ГП в пределах полномочий',
  'Выставить счёт МИГ за месяц',
  'assist-simulator',
];

describe('build without VITE_DEMO_MODE', () => {
  afterAll(() => {
    rmSync(OUT, { recursive: true, force: true });
    rmSync(OUT_MOCKS, { recursive: true, force: true });
  });

  it('contains no demo code', () => {
    const text = build(OUT, false);
    expect(text.length).toBeGreaterThan(1000);
    for (const needle of ['demo.mig.uz', 'demo-clinic.uz', 'demo-assist.uz', 'Войти как', 'Demo-2026!', 'Демо-версия', ...DEMO_TOOLS]) {
      expect(text.includes(needle), needle).toBe(false);
    }
    // The demo code '000000' as a standalone token; hex colours such as `#000000ff` in libraries are not codes.
    expect(text).not.toMatch(/(?<![#\w])000000(?!\w)/);
    // No source maps are shipped.
    expect(files(OUT).some((f) => f.endsWith('.map'))).toBe(false);
  }, 180_000);

  it('with mocks on still has no demo endpoints, simulators or role switcher', () => {
    const text = build(OUT_MOCKS, true);
    // The mock server is bundled (sanity check that this build differs from the one above).
    expect(text.includes('mockServiceWorker')).toBe(true);
    for (const needle of ['Войти как', 'Демо-версия', ...DEMO_TOOLS]) {
      expect(text.includes(needle), needle).toBe(false);
    }
  }, 180_000);
});
