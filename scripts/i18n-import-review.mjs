#!/usr/bin/env node
/*
 * Writes a reviewed docs/i18n-review.csv back into src/i18n/dict/<locale>/<namespace>.ts.
 * Only changed cells are written; empty cells mean "no change"; unknown keys are reported.
 * Uzbek apostrophes are normalised: oʻ/gʻ → U+02BB, other apostrophes → U+02BC.
 * Usage: node scripts/i18n-import-review.mjs [reviewed.csv] [--dry-run]
 * Afterwards run `npm run typecheck && npx vitest run src/i18n`.
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyCsv } from './i18n-review-lib.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const file = resolve(args.find((a) => !a.startsWith('--')) ?? join(root, 'docs/i18n-review.csv'));
const report = applyCsv(readFileSync(file, 'utf8'), join(root, 'src/i18n/dict'), { dryRun });
console.log(`${dryRun ? '[dry run] ' : ''}updated ${report.updated}, added ${report.added}, unchanged ${report.unchanged}`);
if (report.unknown.length) {
  console.log(`unknown keys (${report.unknown.length}): ${report.unknown.join(', ')}`);
  process.exitCode = 1;
}
