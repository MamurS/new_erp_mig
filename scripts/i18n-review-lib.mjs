/*
 * Shared code of the native-speaker review round trip:
 *   scripts/i18n-export-review.mjs  → docs/i18n-review.csv (key | ru | uz-Latn | en | where used)
 *   scripts/i18n-import-review.mjs  ← the reviewed CSV, written back into src/i18n/dict/<locale>/<ns>.ts
 * Dictionary files are plain `'key': 'value',` entries, so they are read and patched as text.
 */
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import Papa from 'papaparse';

export const LOCALES = ['ru', 'uz-Latn', 'en'];
export const HEADER = ['ключ', 'ru', 'uz-Latn', 'en', 'где используется'];

const ENTRY = /(['"])((?:(?!\1)[^\\\n]|\\.)*)\1:\s*(['"])((?:(?!\3)[^\\\n]|\\.)*)\3/g;

function unescape(s) {
  return s.replace(/\\(.)/g, (_, c) => (c === 'n' ? '\n' : c));
}
function escapeSingle(s) {
  return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n');
}

/** Entries of one namespace file: [{ key, value }]. */
export function parseDictFile(text) {
  const out = [];
  for (const m of text.matchAll(ENTRY)) out.push({ key: unescape(m[2]), value: unescape(m[4]) });
  return out;
}

function nsFiles(dictRoot, locale) {
  const dir = join(dictRoot, locale);
  return readdirSync(dir)
    .filter((f) => f.endsWith('.ts') && f !== 'index.ts')
    .map((f) => join(dir, f));
}

/** { locale: Map(key → value) } and, per locale, which file holds which key. */
export function readDicts(dictRoot) {
  const values = {};
  const files = {};
  for (const loc of LOCALES) {
    values[loc] = new Map();
    files[loc] = new Map();
    for (const f of nsFiles(dictRoot, loc))
      for (const { key, value } of parseDictFile(readFileSync(f, 'utf8'))) {
        values[loc].set(key, value);
        files[loc].set(key, f);
      }
  }
  return { values, files };
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name !== 'i18n' && name !== 'node_modules') walk(p, out);
    } else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

/** key → source files using it (exact key, else the longest dynamic prefix such as `labels.role`). */
export function findUsages(srcRoot, keys, repoRoot) {
  // One pass over the sources: every quoted key-like literal and every `prefix.${…}` template head.
  const literal = new Map();
  const add = (k, f) => {
    let set = literal.get(k);
    if (!set) literal.set(k, (set = new Set()));
    set.add(f);
  };
  for (const file of walk(srcRoot)) {
    const f = relative(repoRoot, file);
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(/['"`]([a-zA-Z][\w-]*(?:\.[\w-]+)+)\.?['"`]/g)) add(m[1], f);
    for (const m of text.matchAll(/`([a-zA-Z][\w-]*(?:\.[\w-]+)*)\.\$\{/g)) add(m[1], f);
  }
  const usage = new Map();
  for (const key of keys) {
    const base = key.replace(/\.(one|few|many|other)$/, '');
    let found = literal.get(base);
    const parts = base.split('.');
    for (let n = parts.length - 1; !found && n >= 1; n--) found = literal.get(parts.slice(0, n).join('.'));
    usage.set(key, found ? [...found].sort().slice(0, 5).join('; ') : '');
  }
  return usage;
}

// Spreadsheet formula injection: such cells get a leading apostrophe (and lose it on import).
const FORMULA = /^[=+\-@\t\r]/;
const guard = (s) => (FORMULA.test(s) ? `'${s}` : s);
const unguard = (s) => (s.startsWith("'") && FORMULA.test(s.slice(1)) ? s.slice(1) : s);

export function toCsv(rows) {
  return `\ufeff${Papa.unparse([HEADER, ...rows.map((r) => r.map(guard))], { quotes: true, newline: '\n' })}\n`;
}

/** Prefix of the user guide's article titles in the review file (docs/help/USER_GUIDE.<locale>.md). */
export const GUIDE_PREFIX = 'help.guide.';
const GUIDE_FILES = { ru: 'USER_GUIDE.ru.md', 'uz-Latn': 'USER_GUIDE.uz-Latn.md', en: 'USER_GUIDE.en.md' };

/** Article titles («## N. Title {#anchor}») of the user guide per locale, keyed by anchor. */
export function guideTitles(repoRoot) {
  const out = {};
  for (const loc of LOCALES) {
    const map = new Map();
    const file = join(repoRoot, 'docs/help', GUIDE_FILES[loc]);
    if (existsSync(file)) {
      for (const m of readFileSync(file, 'utf8').matchAll(/^## (?:\d+\.\s*)?(.+?)\s*\{#([a-z0-9-]+)\}\s*$/gm)) map.set(m[2], m[1]);
    }
    out[loc] = map;
  }
  return out;
}

export function buildRows(dictRoot, srcRoot, repoRoot) {
  const { values } = readDicts(dictRoot);
  const keys = [...values.ru.keys()].sort();
  const usage = findUsages(srcRoot, keys, repoRoot);
  const rows = keys.map((k) => [k, values.ru.get(k) ?? '', values['uz-Latn'].get(k) ?? '', values.en.get(k) ?? '', usage.get(k) ?? '']);
  // The user guide is reviewed in its markdown files; its article titles are listed for orientation.
  const titles = guideTitles(repoRoot);
  for (const [anchor, ru] of titles.ru) rows.push([GUIDE_PREFIX + anchor, ru, titles['uz-Latn'].get(anchor) ?? '', titles.en.get(anchor) ?? '', 'docs/help']);
  return rows;
}

/** Reviewers type ASCII apostrophes: oʻ/gʻ take U+02BB, any other apostrophe becomes U+02BC. */
export function normalizeUz(s) {
  return s.replace(/([OoGg])['’‘`]/g, '$1ʻ').replace(/['’‘`]/g, 'ʼ');
}

/**
 * Applies a reviewed CSV. Returns { updated, unchanged, unknown, added } and patches the files
 * unless dryRun. A row's empty cell means "no change".
 */
export function applyCsv(csvText, dictRoot, { dryRun = false } = {}) {
  const parsed = Papa.parse(csvText.replace(/^\ufeff/, ''), { header: false, skipEmptyLines: true });
  const [header, ...rows] = parsed.data;
  if (!header || HEADER.some((h, i) => (header[i] ?? '').trim() !== h)) throw new Error(`Unexpected header: ${header?.join(' | ')}`);
  const { values, files } = readDicts(dictRoot);
  const patches = new Map(); // file → [{ key, value, insert }]
  const report = { updated: 0, unchanged: 0, unknown: [], added: 0, guide: 0 };
  for (const row of rows) {
    const key = (row[0] ?? '').trim();
    if (key.startsWith(GUIDE_PREFIX)) {
      // Guide titles live in docs/help/USER_GUIDE.<locale>.md and are edited there, not imported.
      report.guide++;
      continue;
    }
    if (!values.ru.has(key)) {
      if (key) report.unknown.push(key);
      continue;
    }
    LOCALES.forEach((loc, i) => {
      let v = unguard(row[i + 1] ?? '');
      if (v.trim() === '') return;
      if (loc === 'uz-Latn') v = normalizeUz(v);
      if (values[loc].get(key) === v) {
        report.unchanged++;
        return;
      }
      const file = files[loc].get(key) ?? files.ru.get(key).replace(`/ru/`, `/${loc}/`);
      const list = patches.get(file) ?? [];
      list.push({ key, value: v, insert: !values[loc].has(key) });
      patches.set(file, list);
      if (values[loc].has(key)) report.updated++;
      else report.added++;
    });
  }
  if (!dryRun)
    for (const [file, list] of patches) {
      let text = readFileSync(file, 'utf8');
      for (const { key, value, insert } of list) {
        const line = `'${escapeSingle(key)}': '${escapeSingle(value)}'`;
        if (insert) {
          text = text.replace(/\n\}( satisfies Record<string, string>)?;\s*$/, (end) => `\n  ${line},${end}`);
        } else {
          const re = new RegExp(`(['"])${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\1:\\s*(['"])(?:(?!\\2)[^\\\\\\n]|\\\\.)*\\2`);
          text = text.replace(re, line);
        }
      }
      writeFileSync(file, text);
    }
  return report;
}
