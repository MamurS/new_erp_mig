// @vitest-environment node
/*
 * DMS business parameters live in src/shared/config/dmsParameters.ts and in the server store.
 * This test looks through src/ for the values and constants they replaced, so that nobody
 * hardcodes a threshold or a term again. Tests and the parameter registry itself are skipped.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const REGISTRY = join('src', 'shared', 'config', 'dmsParameters.ts');

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : [p];
  });
}

/** Comments may mention the numbers; only code counts. `//` preceded by `:` (URLs) is kept. */
function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const RULES: { name: string; re: RegExp }[] = [
  {
    name: 'old constants (now DMS parameters)',
    re: /\b(QA_SAMPLE_SHARE|REBILL_REVIEW_WORKDAYS|REGISTRY_REVIEW_DAYS|CLINIC_RESPONSE_SLA_MINUTES|GUARANTEE_DUAL_APPROVAL_THRESHOLD|LIMIT_WARN_RATIO|CHECKS_PER_HOUR|CHECK_FAILS_BEFORE_LOCK|CHECK_LOCK_MS|MAX_FAILS)\b/,
  },
  // 10 000 000 (assistance authority) and 20 000 000 (two signatures); 10_000_000_000 is a technical money cap.
  { name: 'guarantee thresholds 10 000 000 / 20 000 000', re: /(?<![\d_.])(10|20)(_?000){2}(?![\d_])/ },
  { name: 'QA sample share 0.05', re: /(?<![\d.])0\.05(?!\d)/ },
  { name: '«limit running low» / loss ratio thresholds', re: /(ratio|Ratio|used|Used|limit|Pct)[^;\n]{0,60}(>=|>|<=|<)\s*(0\.8|0\.2|80)(?![\d.])/ },
  { name: 'clinic response time fallback', re: /responseSlaMinutes\s*\?\?\s*\d/ },
  { name: 'authority limit fallback', re: /authorityLimit\s*\?\?\s*\d/ },
  { name: 'default 30-day terms (guarantee validity, KP validity)', re: /addDaysISO\(todayISO\(\),\s*30\)|\+\s*30\s*\*\s*DAY/ },
  { name: 'lock and check limits in texts', re: /заблокирован[аоы]? на \d+ минут|\d+ проверок в час|\d+ ошибок подряд/ },
];

describe('DMS parameters are not hardcoded', () => {
  const sources = files('src').filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f) && f !== REGISTRY);

  it('finds sources to scan', () => {
    expect(sources.length).toBeGreaterThan(100);
  });

  for (const rule of RULES) {
    it(`no ${rule.name}`, () => {
      const hits = sources.flatMap((f) =>
        code(readFileSync(f, 'utf8'))
          .split('\n')
          .map((line, i) => ({ f, i, line }))
          .filter(({ line }) => rule.re.test(line))
          .map(({ f, i, line }) => `${f}:${i + 1}: ${line.trim()}`),
      );
      expect(hits).toEqual([]);
    });
  }

  it('the rules catch the old code', () => {
    const old = [
      'export const GUARANTEE_DUAL_APPROVAL_THRESHOLD: Money = 20_000_000;',
      'const limit = overview.data?.authorityLimit ?? 10_000_000;',
      'return (limit - used) / limit < 0.2 ? "low" : "available";',
      'tone={(c.lossRatio ?? 0) >= 0.8 ? "warning" : "default"}',
      'const minutes = clinic?.responseSlaMinutes ?? 120;',
      'validUntil: isoDay(today + 30 * DAY),',
      "'Слишком много попыток. Вход заблокирован на 5 минут'",
      'export const QA_SAMPLE_SHARE = 0.05;',
    ];
    for (const line of old) expect(RULES.some((r) => r.re.test(line)), line).toBe(true);
    expect(RULES.some((r) => r.re.test('max(10_000_000_000)'))).toBe(false);
  });
});
