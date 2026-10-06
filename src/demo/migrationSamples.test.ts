// @vitest-environment node
/*
 * The demo files of the portfolio transfer are deterministic and are the e2e fixtures
 * (e2e/fixtures/migration). Regenerate them with UPDATE_MIGRATION_FIXTURES=1 npx vitest run src/demo.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MIGRATION_STEPS, emptyDbRefs, migrationFileName, parseMigrationCsv, validateBatch, type RawRow } from '@/shared/domain/migration';
import { MIGRATION_DEMO_DATE, migrationDemoFiles } from './migrationSamples';

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
    expect(rows.insured).toHaveLength(200 + 4);
    expect(rows.claims).toHaveLength(10 + 1);
    expect(rows.invoices!.length).toBeGreaterThanOrEqual(3);
    expect(rows.limits!.length).toBeGreaterThan(10);
    for (const s of MIGRATION_STEPS) expect(/[А-Яа-яЁё]/.test(files[s]), s).toBe(false);
    expect(rows.insured!.filter((r) => /^\d{14}$/.test(r.pinfl ?? ''))).toHaveLength(203);
  });

  it('premiums: by type for most contracts, individual for all of MIG-2026/0503, one deliberate mismatch', () => {
    const contracts = parseMigrationCsv('contracts', files.contracts);
    const insured = parseMigrationCsv('insured', files.insured);
    if ('error' in contracts || 'error' in insured) throw new Error('unreadable');
    const byType = contracts.rows.filter((c) => c.premium_employee && c.premium_family).map((c) => c.oldNumber);
    expect(byType).toEqual(['MIG-2026/0501', 'MIG-2026/0502', 'MIG-2026/0504', 'MIG-2026/0505']);
    const of0503 = insured.rows.filter((r) => r.contractOldNumber === 'MIG-2026/0503');
    // Every person of the contract without premiums by type has an individual premium, except the one error row.
    expect(of0503.filter((r) => !r.premium).map((r) => r.oldCertificate)).toEqual(['C-0503-0902']);
    expect(insured.rows.filter((r) => r.contractOldNumber === 'MIG-2026/0505' && r.premium).map((r) => r.oldCertificate)).toEqual(['C-0505-0001', 'C-0505-0002']);
    expect(insured.rows.filter((r) => r.contractOldNumber === 'MIG-2026/0501' && r.premium)).toHaveLength(0);
    // The dry run: the missing premium is an error; MIG-2026/0504 is the only contract whose premiums do not add up.
    const refs = emptyDbRefs();
    refs.assistances.set('shifo assistans group', 'assistance-id');
    const res = validateBatch({ migrationDate: MIGRATION_DEMO_DATE, files: Object.fromEntries(MIGRATION_STEPS.slice(0, 3).map((s) => [s, (parseMigrationCsv(s, files[s]) as { rows: RawRow[] }).rows])) }, refs);
    expect(res.insured!.issues.filter((i) => i.message === 'migration.v.noPremium')).toHaveLength(1);
    expect(res.contractPremiums!.filter((c) => !c.match).map((c) => [c.oldNumber, c.diff])).toEqual([['MIG-2026/0504', -2_500_000]]);
    expect(res.contractPremiums!.find((c) => c.oldNumber === 'MIG-2026/0503')).toMatchObject({ insured: 40, individual: 40, diff: 0 });
    expect(res.contractPremiums!.find((c) => c.oldNumber === 'MIG-2026/0505')).toMatchObject({ individual: 2, diff: 1, match: true });
  });
});
