// @vitest-environment node
/*
 * The demo files of the portfolio transfer are deterministic and are the e2e fixtures
 * (e2e/fixtures/migration). Regenerate them with UPDATE_MIGRATION_FIXTURES=1 npx vitest run src/demo.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MIGRATION_STEPS, migrationFileName, parseMigrationCsv } from '@/shared/domain/migration';
import { migrationDemoFiles } from './migrationSamples';

const DIR = join(process.cwd(), 'e2e/fixtures/migration');

describe('demo files of the portfolio transfer', () => {
  const files = migrationDemoFiles();

  it('are the same every time and equal the e2e fixtures', () => {
    expect(migrationDemoFiles()).toEqual(files);
    for (const s of MIGRATION_STEPS) {
      const path = join(DIR, migrationFileName(s, 'demo'));
      if (process.env.UPDATE_MIGRATION_FIXTURES === '1') writeFileSync(path, files[s]);
      expect(existsSync(path), path).toBe(true);
      expect(readFileSync(path, 'utf8'), s).toBe(files[s]);
    }
  });

  it('have the agreed size, Latin names and ASCII numbers', () => {
    const rows = Object.fromEntries(MIGRATION_STEPS.map((s) => {
      const p = parseMigrationCsv(s, files[s]);
      if ('error' in p) throw new Error(p.error);
      return [s, p.rows];
    }));
    // Valid rows plus the rows with errors shown by the validation report.
    expect(rows.clients).toHaveLength(5 + 1);
    expect(rows.contracts).toHaveLength(5);
    expect(rows.insured).toHaveLength(200 + 3);
    expect(rows.claims).toHaveLength(10 + 1);
    expect(rows.invoices!.length).toBeGreaterThanOrEqual(3);
    expect(rows.limits!.length).toBeGreaterThan(10);
    for (const s of MIGRATION_STEPS) expect(/[А-Яа-яЁё]/.test(files[s]), s).toBe(false);
    expect(rows.insured!.filter((r) => /^\d{14}$/.test(r.pinfl ?? ''))).toHaveLength(202);
  });
});
