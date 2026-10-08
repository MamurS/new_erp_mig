#!/usr/bin/env node
/*
 * Writes the pgTAP tests of supabase/tests/ from the access rules of the schema and the permissions
 * matrix (packages/domain/src/store/sql/rlsTests.ts); the users and rows come from the deterministic seed:
 *
 *   node scripts/gen-rls-tests.mjs
 *
 * Run them with `npx supabase test db` against a database after `npx supabase db reset`.
 */
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { root, withTs } from './lib/ts-loader.mjs';

await withTs(async (load) => {
  const { buildRlsTests, TESTS_DIR } = await load('/packages/domain/src/store/sql/rlsTests.ts');
  const { SEED_NOW } = await load('/packages/domain/src/store/sql/seed.ts');
  const { createSeed } = await load('/packages/seed/src/seed.ts');
  const dir = resolve(root, TESTS_DIR);
  mkdirSync(dir, { recursive: true });
  const files = buildRlsTests(createSeed({ now: SEED_NOW }));
  const names = new Set(files.map((f) => f.name));
  for (const old of readdirSync(dir)) if (old.endsWith('_test.sql') && !names.has(old)) rmSync(resolve(dir, old));
  let total = 0;
  for (const f of files) {
    writeFileSync(resolve(dir, f.name), f.sql);
    total += f.count;
  }
  console.log(`Wrote ${files.length} files with ${total} tests to ${TESTS_DIR}/`);
});
