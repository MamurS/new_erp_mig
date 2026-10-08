// @vitest-environment node
/* The native-speaker review round trip: export to CSV, edit, import back into the dictionaries. */
import { cpSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import Papa from 'papaparse';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyCsv, buildRows, GUIDE_PREFIX, guideTitles, normalizeUz, readDicts, toCsv } from './i18n-review-lib.mjs';
import { ru as ruMain } from '@mig/i18n/dict/ru/index';
import { demo } from '@mig/i18n/dict/ru/demo';

const ru = { ...ruMain, ...demo };

const root = resolve(__dirname, '..');
let dict: string;

beforeEach(() => {
  dict = mkdtempSync(join(tmpdir(), 'i18n-'));
  cpSync(join(root, 'packages/i18n/src/dict'), dict, { recursive: true });
});
afterEach(() => rmSync(dict, { recursive: true, force: true }));

describe('i18n review CSV', () => {
  it('the text parser reads every key the app has', () => {
    const { values } = readDicts(dict);
    expect(values.ru.size).toBe(Object.keys(ru).length);
    expect(values.ru.get('shell.user.logout')).toBe('Выйти');
  });

  it('exports key | ru | uz-Latn | en | where used, guarding formula cells', () => {
    const rows = buildRows(dict, [join(root, 'apps/web/src'), join(root, 'packages')], root);
    expect(rows.filter((r) => !r[0]!.startsWith(GUIDE_PREFIX))).toHaveLength(Object.keys(ru).length);
    const logout = rows.find((r) => r[0] === 'shell.user.logout')!;
    expect(logout.slice(1, 4)).toEqual(['Выйти', 'Chiqish', 'Sign out']);
    expect(logout[4]).toContain('src/shared/ui/app-sidebar.tsx');
    const csv = toCsv([['k', '=1+1', 'ok', '-x', '']]);
    expect(Papa.parse(csv.replace(/^\ufeff/, '')).data[1]).toEqual(['k', "'=1+1", 'ok', "'-x", '']);
  });

  it('imports changed cells only, normalises Uzbek apostrophes and reports unknown keys', () => {
    // A first round trip only normalises what is already there.
    applyCsv(toCsv(buildRows(dict, [join(root, 'apps/web/src'), join(root, 'packages')], root)), dict);
    const rows = buildRows(dict, [join(root, 'apps/web/src'), join(root, 'packages')], root);
    const edited: string[][] = rows.map((r) => (r[0] === 'shell.user.logout' ? [r[0]!, r[1]!, "Tizimdan chiqish (o'zim)", 'Log out', r[4]!] : r));
    edited.push(['no.such.key', 'x', 'y', 'z', '']);
    const report = applyCsv(toCsv(edited), dict);
    expect(report.updated).toBe(2);
    expect(report.unknown).toEqual(['no.such.key']);
    const { values } = readDicts(dict);
    expect(values['uz-Latn'].get('shell.user.logout')).toBe('Tizimdan chiqish (oʻzim)');
    expect(values.en.get('shell.user.logout')).toBe('Log out');
    expect(readFileSync(join(dict, 'en/shell.ts'), 'utf8')).toContain("'shell.user.logout': 'Log out',");
    // An unchanged export re-imported changes nothing.
    expect(applyCsv(toCsv(buildRows(dict, [join(root, 'apps/web/src'), join(root, 'packages')], root)), dict).updated).toBe(0);
  });

  it('lists the user guide article titles in three languages and never imports them into the dictionaries', () => {
    const titles = guideTitles(root);
    expect(titles.ru.size).toBe(20);
    const rows = buildRows(dict, [join(root, 'apps/web/src'), join(root, 'packages')], root).filter((r) => r[0]!.startsWith(GUIDE_PREFIX));
    expect(rows).toHaveLength(titles.ru.size);
    for (const r of rows) expect(r.slice(1, 4).every((v) => v !== '')).toBe(true);
    const report = applyCsv(toCsv(rows.map((r) => [r[0]!, r[1]!, 'x', 'y', r[4]!])), dict);
    expect(report).toMatchObject({ updated: 0, unknown: [], guide: rows.length });
  });

  it('normalises apostrophes typed by reviewers', () => {
    expect(normalizeUz("o'zbek g'alaba ma'lumot O‘zbekiston")).toBe('oʻzbek gʻalaba maʼlumot Oʻzbekiston');
  });
});
