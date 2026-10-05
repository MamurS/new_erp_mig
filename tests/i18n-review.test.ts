// @vitest-environment node
/* The native-speaker review round trip: export to CSV, edit, import back into the dictionaries. */
import { cpSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import Papa from 'papaparse';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyCsv, buildRows, normalizeUz, readDicts, toCsv } from '../scripts/i18n-review-lib.mjs';
import { ru } from '../src/i18n/dict/ru';

const root = resolve(__dirname, '..');
let dict: string;

beforeEach(() => {
  dict = mkdtempSync(join(tmpdir(), 'i18n-'));
  cpSync(join(root, 'src/i18n/dict'), dict, { recursive: true });
});
afterEach(() => rmSync(dict, { recursive: true, force: true }));

describe('i18n review CSV', () => {
  it('the text parser reads every key the app has', () => {
    const { values } = readDicts(dict);
    expect(values.ru.size).toBe(Object.keys(ru).length);
    expect(values.ru.get('shell.user.logout')).toBe('Выйти');
  });

  it('exports key | ru | uz-Latn | en | where used, guarding formula cells', () => {
    const rows = buildRows(dict, join(root, 'src'), root);
    expect(rows).toHaveLength(Object.keys(ru).length);
    const logout = rows.find((r) => r[0] === 'shell.user.logout')!;
    expect(logout.slice(1, 4)).toEqual(['Выйти', 'Chiqish', 'Sign out']);
    expect(logout[4]).toContain('src/shared/ui/app-sidebar.tsx');
    const csv = toCsv([['k', '=1+1', 'ok', '-x', '']]);
    expect(Papa.parse(csv.replace(/^﻿/, '')).data[1]).toEqual(['k', "'=1+1", 'ok', "'-x", '']);
  });

  it('imports changed cells only, normalises Uzbek apostrophes and reports unknown keys', () => {
    // A first round trip only normalises what is already there.
    applyCsv(toCsv(buildRows(dict, join(root, 'src'), root)), dict);
    const rows = buildRows(dict, join(root, 'src'), root);
    const edited = rows.map((r) => (r[0] === 'shell.user.logout' ? [r[0], r[1], "Tizimdan chiqish (o'zim)", 'Log out', r[4]] : r));
    edited.push(['no.such.key', 'x', 'y', 'z', '']);
    const report = applyCsv(toCsv(edited), dict);
    expect(report.updated).toBe(2);
    expect(report.unknown).toEqual(['no.such.key']);
    const { values } = readDicts(dict);
    expect(values['uz-Latn'].get('shell.user.logout')).toBe('Tizimdan chiqish (oʻzim)');
    expect(values.en.get('shell.user.logout')).toBe('Log out');
    expect(readFileSync(join(dict, 'en/shell.ts'), 'utf8')).toContain("'shell.user.logout': 'Log out',");
    // An unchanged export re-imported changes nothing.
    expect(applyCsv(toCsv(buildRows(dict, join(root, 'src'), root)), dict).updated).toBe(0);
  });

  it('normalises apostrophes typed by reviewers', () => {
    expect(normalizeUz("o'zbek g'alaba ma'lumot O‘zbekiston")).toBe('oʻzbek gʻalaba maʼlumot Oʻzbekiston');
  });
});
