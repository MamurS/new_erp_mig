/*
 * The committed database files are generated from the TypeScript sources and must match them:
 *   supabase/migrations/*.sql, docs/backend/RLS.md  — node scripts/gen-schema.mjs
 *   supabase/seed.sql                               — node scripts/gen-seed-sql.mjs
 *   supabase/tests/*_test.sql                       — node scripts/gen-rls-tests.mjs
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createSeed } from '@mig/seed/seed';
import { NESTED_KEYS, LOG_TABLES, TABLE_KEYS } from '../repo';
import { LATER_ENUM_VALUES, TABLES } from '../schema';
import { snake } from '../columns';
import { buildMigrations, MIGRATIONS_DIR } from './migrations';
import { buildRlsDoc, RLS_DOC_PATH } from './rlsDoc';
import { buildRlsTests, TESTS_DIR } from './rlsTests';
import { buildSeedSql, SEED_NOW } from './seed';
import { fieldMappings, physicalColumns } from './physical';

const root = resolve(__dirname, '../../../../..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');

describe('database schema', () => {
  it('has a table for every repository collection, with unique names', () => {
    const names = TABLES.map((t) => t.collection);
    for (const n of [...Object.keys(TABLE_KEYS), ...LOG_TABLES, ...Object.keys(NESTED_KEYS)]) expect(names).toContain(n);
    expect(new Set(TABLES.map((t) => t.table)).size).toBe(TABLES.length);
    expect(new Set(names).size).toBe(names.length);
  });

  it('keys are fields of the row, foreign keys point to tables', () => {
    for (const t of TABLES) {
      if (t.key !== null) expect(Object.keys(t.columns)).toContain(t.key);
      for (const c of Object.values(t.columns)) if (c.ref) expect(TABLES.some((x) => x.collection === c.ref)).toBe(true);
      const cols = physicalColumns(t).map((c) => c.name);
      expect(new Set(cols).size).toBe(cols.length);
      for (const c of cols) expect(c.startsWith('_')).toBe(false);
    }
  });

  it('never stores a card number or an identity value in clear', () => {
    const insured = fieldMappings('insured');
    expect(insured.find((m) => m.field === 'payoutCard')?.columns).toEqual(['payout_card_mask', 'payout_card_token']);
    expect(insured.find((m) => m.field === 'pinfl')?.columns).toEqual(['pinfl_enc', 'pinfl_key_ver', 'pinfl_hmac', 'pinfl_mask']);
    expect(insured.find((m) => m.field === 'phone')?.columns).toEqual(['phone_enc', 'phone_key_ver', 'phone_hmac', 'phone_mask']);
    for (const t of TABLES) for (const c of physicalColumns(t)) expect(['pinfl', 'phone', 'payout_card', 'password']).not.toContain(c.name);
    expect(snake('phone24x7')).toBe('phone24x7');
  });
});

describe('migrations only go forward', () => {
  it('an enum value added later is outside the CHECK of its table and widened by its own migration', () => {
    const files = buildMigrations();
    const base = files.find((f) => f.name.endsWith('_schema.sql'))!;
    for (const x of LATER_ENUM_VALUES) {
      const later = files.find((f) => f.name === x.migration);
      expect(later, x.migration).toBeDefined();
      for (const v of x.values) {
        expect(base.sql).not.toContain(`'${v}'`);
        expect(later!.sql).toContain(`'${v}'`);
      }
    }
  });
});

describe('generated database files are up to date', () => {
  it(`${MIGRATIONS_DIR} matches the schema (run node scripts/gen-schema.mjs)`, () => {
    const files = buildMigrations();
    expect(readdirSync(resolve(root, MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort()).toEqual(files.map((f) => f.name).sort());
    for (const f of files) expect(read(`${MIGRATIONS_DIR}/${f.name}`), f.name).toBe(f.sql);
  });

  it(`${RLS_DOC_PATH} matches the access rules (run node scripts/gen-schema.mjs)`, () => {
    expect(read(RLS_DOC_PATH)).toBe(buildRlsDoc());
  });

  const db = createSeed({ now: SEED_NOW });

  it('supabase/seed.sql matches the seed (run node scripts/gen-seed-sql.mjs)', () => {
    expect(existsSync(resolve(root, 'supabase/seed.sql'))).toBe(true);
    expect(read('supabase/seed.sql') === buildSeedSql(db)).toBe(true);
  });

  it(`${TESTS_DIR} matches the matrix (run node scripts/gen-rls-tests.mjs)`, () => {
    const files = buildRlsTests(db);
    expect(readdirSync(resolve(root, TESTS_DIR)).filter((f) => f.endsWith('_test.sql')).sort()).toEqual(files.map((f) => f.name).sort());
    for (const f of files) expect(read(`${TESTS_DIR}/${f.name}`) === f.sql, f.name).toBe(true);
    expect(files.reduce((n, f) => n + f.count, 0)).toBeGreaterThan(4000);
  });
});
