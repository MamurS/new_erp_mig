// @vitest-environment node
/*
 * SPEC §9.5: a build without VITE_DEMO_MODE must not contain demo accounts, the role switcher or demo codes.
 * The production-like build also has mocks off (real API), so the mock seed is not bundled either.
 */
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

const OUT = 'dist-nodemo';

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : [p];
  });
}

describe('build without VITE_DEMO_MODE', () => {
  afterAll(() => rmSync(OUT, { recursive: true, force: true }));

  it('contains no demo code', () => {
    execFileSync('npx', ['vite', 'build', '--outDir', OUT, '--emptyOutDir', '--logLevel', 'error'], {
      env: { ...process.env, NODE_ENV: 'production', VITE_DEMO_MODE: 'false', VITE_USE_MOCKS: 'false', VITE_SEED_XSS: 'false' },
      stdio: 'pipe',
    });
    const text = files(OUT)
      .filter((f) => /\.(js|css|html|txt|json)$/.test(f))
      .map((f) => readFileSync(f, 'utf8'))
      .join('\n');
    expect(text.length).toBeGreaterThan(1000);
    for (const needle of ['demo.mig.uz', 'Войти как', 'Demo-2026!', 'Демо-версия']) {
      expect(text.includes(needle), needle).toBe(false);
    }
    // The demo code '000000' as a standalone token; hex colours such as `#000000ff` in libraries are not codes.
    expect(text).not.toMatch(/(?<![#\w])000000(?!\w)/);
    // No source maps are shipped.
    expect(files(OUT).some((f) => f.endsWith('.map'))).toBe(false);
  }, 180_000);
});
