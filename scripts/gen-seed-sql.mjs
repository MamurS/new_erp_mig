#!/usr/bin/env node
/*
 * Writes supabase/seed.sql from the deterministic demo database (createSeed of packages/seed, fixed «now»):
 *
 *   node scripts/gen-seed-sql.mjs
 *
 * DEV ONLY: personal data is stored as plaintext bytes with key version 0 (see packages/domain/src/store/sql/seed.ts).
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { root, withTs } from './lib/ts-loader.mjs';

await withTs(async (load) => {
  const { buildSeedSql, SEED_NOW } = await load('/packages/domain/src/store/sql/seed.ts');
  const { createSeed } = await load('/packages/seed/src/seed.ts');
  const path = resolve(root, 'supabase/seed.sql');
  writeFileSync(path, buildSeedSql(createSeed({ now: SEED_NOW })));
  console.log('Wrote supabase/seed.sql');
});
