#!/usr/bin/env node
/*
 * Writes the SQL migrations of supabase/migrations/ (and docs/backend/RLS.md) from the declarative schema
 * (packages/domain/src/store/schema.ts), the permissions matrix and the job list:
 *
 *   node scripts/gen-schema.mjs
 *
 * The committed files are the source of truth of the database; a unit test fails when they differ
 * from what this script would write (packages/domain/src/store/sql/generated.test.ts).
 */
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { root, withTs } from './lib/ts-loader.mjs';

await withTs(async (load) => {
  const { buildMigrations, MIGRATIONS_DIR } = await load('/packages/domain/src/store/sql/migrations.ts');
  const { buildRlsDoc, RLS_DOC_PATH } = await load('/packages/domain/src/store/sql/rlsDoc.ts');
  const dir = resolve(root, MIGRATIONS_DIR);
  mkdirSync(dir, { recursive: true });
  const files = buildMigrations();
  const names = new Set(files.map((f) => f.name));
  for (const old of readdirSync(dir)) if (old.endsWith('.sql') && !names.has(old)) rmSync(resolve(dir, old));
  for (const f of files) {
    writeFileSync(resolve(dir, f.name), f.sql);
    console.log(`Wrote ${MIGRATIONS_DIR}/${f.name}`);
  }
  const doc = resolve(root, RLS_DOC_PATH);
  mkdirSync(dirname(doc), { recursive: true });
  writeFileSync(doc, buildRlsDoc());
  console.log(`Wrote ${RLS_DOC_PATH}`);
});
