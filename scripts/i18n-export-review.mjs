#!/usr/bin/env node
/*
 * Writes docs/i18n-review.csv for a native speaker: key | ru | uz-Latn | en | where used.
 * Usage: node scripts/i18n-export-review.mjs [out.csv]
 */
import { writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildRows, toCsv } from './i18n-review-lib.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(process.argv[2] ?? join(root, 'docs/i18n-review.csv'));
const rows = buildRows(join(root, 'src/i18n/dict'), join(root, 'src'), root);
writeFileSync(out, toCsv(rows));
console.log(`${rows.length} keys → ${out}`);
