/*
 * Latin names and legal forms: names of legal entities carry no form and are the same in every
 * language, the form is a separate chip in a «Форма» column (header filter, server sort), document
 * numbers are ASCII, and search finds a Latin name by its Russian spelling.
 */
import { expect, test, type Locator, type Page } from '@playwright/test';
import { api, loginStaff } from './helpers';

type Lang = 'ru' | 'uz-Latn' | 'en';
const LANG_NAME: Record<Lang, string> = { ru: 'Русский', 'uz-Latn': 'Oʻzbekcha', en: 'English' };
const USER_MENU: Record<Lang, string> = { ru: 'Меню пользователя', 'uz-Latn': 'Foydalanuvchi menyusi', en: 'User menu' };

/** Order of src/shared/config/legalForms.ts LEGAL_FORMS: the server sort follows it. */
const FORM_ORDER = ['llc', 'jsc', 'private_enterprise', 'jv_llc', 'sole_proprietor', 'state_unitary', 'family_enterprise', 'farm', 'branch', 'rep_office', 'other'];
/** Short label of a limited liability company in each language. */
const LLC: Record<Lang, string> = { ru: 'ООО', 'uz-Latn': 'MChJ', en: 'LLC' };
const CYRILLIC = /[Ѐ-ӿ]/;
const nameCollator = new Intl.Collator('en', { sensitivity: 'base', ignorePunctuation: true });

const rows = (page: Page): Locator => page.locator('tbody tr[data-row]');

async function headers(page: Page): Promise<string[]> {
  return (await page.locator('thead th').allInnerTexts()).map((s) => s.trim());
}

async function chipCodes(page: Page): Promise<string[]> {
  return rows(page).evaluateAll((trs) => trs.map((tr) => tr.querySelector('[data-testid="legal-form"]')?.getAttribute('data-code') ?? ''));
}

async function cellTexts(page: Page, col: number, inner = ''): Promise<string[]> {
  return rows(page)
    .locator(`td:nth-child(${col + 1}) ${inner}`.trim())
    .allInnerTexts()
    .then((a) => a.map((s) => s.trim()));
}

/** Switches the interface language through the side panel's user menu. */
async function setLanguage(page: Page, lang: Lang): Promise<void> {
  const from = ((await page.locator('html').getAttribute('lang')) ?? 'ru') as Lang;
  await page.getByTestId('sidebar').getByRole('button', { name: USER_MENU[from] }).click();
  await page.getByRole('menuitemradio', { name: LANG_NAME[lang] }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', lang);
}

/** «Форма» is right after the name column; returns the index of the name column. */
async function expectFormAfter(page: Page, nameHeader: string): Promise<number> {
  const h = await headers(page);
  const i = h.indexOf(nameHeader);
  expect(i, h.join(' | ')).toBeGreaterThanOrEqual(0);
  expect(h[i + 1]).toBe('Форма');
  return i;
}

async function checkFormFilterAndSort(page: Page, path: string, nameHeader: string): Promise<void> {
  await page.goto(path);
  await expect(rows(page).first()).toBeVisible();
  const nameCol = await expectFormAfter(page, nameHeader);
  const formHeader = page.locator('thead th').nth(nameCol + 1);

  // Header filter: «АО» only.
  await formHeader.getByRole('button', { name: 'Фильтр: Форма' }).click();
  await page.getByRole('menuitemcheckbox', { name: 'АО', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(page).toHaveURL(/[?&]form=jsc(&|$)/);
  await expect(rows(page).first()).toBeVisible();
  await expect.poll(async () => [...new Set(await chipCodes(page))]).toEqual(['jsc']);
  await expect.poll(async () => [...new Set(await rows(page).getByTestId('legal-form').allInnerTexts())]).toEqual(['АО']);

  // Reset the filter: back to every form.
  await formHeader.getByRole('button', { name: 'Фильтр: Форма' }).click();
  await page.getByRole('menuitem', { name: /Сбросить/ }).click();
  await page.keyboard.press('Escape');
  await expect(page).not.toHaveURL(/[?&]form=/);
  await expect.poll(async () => new Set(await chipCodes(page)).size).toBeGreaterThan(1);

  // Sort by form: the order of LEGAL_FORMS, then reversed.
  const sortButton = formHeader.getByRole('button', { name: 'Форма', exact: true });
  await sortButton.click();
  await expect(formHeader).toHaveAttribute('aria-sort', 'ascending');
  await expect(page).toHaveURL(/[?&]sort=legalForm(%3A|:)asc/);
  const isSorted = (codes: string[], dir: 1 | -1) =>
    codes.every((c, i) => i === 0 || dir * (FORM_ORDER.indexOf(c) - FORM_ORDER.indexOf(codes[i - 1]!)) >= 0);
  await expect.poll(async () => {
    const codes = await chipCodes(page);
    return codes.length > 1 && isSorted(codes, 1) && codes[0] === 'llc';
  }).toBe(true);
  await sortButton.click();
  await expect(formHeader).toHaveAttribute('aria-sort', 'descending');
  await expect.poll(async () => {
    const codes = await chipCodes(page);
    return codes.length > 1 && isSorted(codes, -1) && codes[0] !== 'llc';
  }).toBe(true);
}

test.describe('«Форма» column', () => {
  test('clients: after the name, header filter by АО, server sort by form, name sort ignores case', async ({ page }) => {
    await loginStaff(page, 'underwriter');
    // A client typed in lower case must sort among the «A…» names, not after «Z…».
    const created = await api(page, 'POST', '/clients', { legalForm: 'jsc', name: 'aaa kichik harf', inn: '312345678', status: 'draft' });
    expect(created.status).toBeLessThan(300);

    await checkFormFilterAndSort(page, '/staff/clients', 'Клиент');

    await page.goto('/staff/clients?sort=name:asc');
    await expect(rows(page).first()).toBeVisible();
    const nameHeader = page.locator('thead th').first();
    await expect(nameHeader).toHaveAttribute('aria-sort', 'ascending');
    const asc = await cellTexts(page, 0, '.font-medium');
    expect(asc).toEqual([...asc].sort(nameCollator.compare));
    // A code-point sort would put the lower-case name after every capitalised one.
    const at = asc.indexOf('aaa kichik harf');
    expect(at, asc.join(', ')).toBeGreaterThanOrEqual(0);
    expect(asc.slice(at + 1).some((n) => /^[A-Z]/.test(n))).toBe(true);

    await nameHeader.getByRole('button', { name: 'Клиент', exact: true }).click();
    await expect(nameHeader).toHaveAttribute('aria-sort', 'descending');
    await expect(page).toHaveURL(/[?&]sort=name(%3A|:)desc/);
    await expect.poll(async () => (await cellTexts(page, 0, '.font-medium'))[0]).not.toBe(asc[0]);
    const desc = await cellTexts(page, 0, '.font-medium');
    expect(desc).toEqual([...desc].sort((a, b) => nameCollator.compare(b, a)));
    expect(desc).not.toContain('aaa kichik harf');
  });

  test('contracts: after the client, header filter by АО, server sort by form', async ({ page }) => {
    await loginStaff(page, 'underwriter');
    await checkFormFilterAndSort(page, '/staff/contracts', 'Клиент');
  });
});

test.describe('Search across scripts', () => {
  test('«Ташкент» and «toshkent» find «Toshkent Agrologistika» in the clients list and the command palette', async ({ page }) => {
    await loginStaff(page, 'underwriter');
    await page.goto('/staff/clients');
    await expect(rows(page).first()).toBeVisible();
    const search = page.getByPlaceholder('Название или ИНН');
    for (const term of ['Ташкент', 'toshkent', 'Toshkent']) {
      await search.fill(term);
      await expect(rows(page).filter({ hasText: 'Toshkent Agrologistika' })).toHaveCount(1);
      await expect.poll(async () => (await cellTexts(page, 0, '.font-medium')).every((n) => /toshkent/i.test(n))).toBe(true);
    }
    await search.fill('');

    await page.locator('body').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('Control+k');
    const palette = page.getByRole('dialog');
    await expect(palette).toBeVisible();
    await palette.getByRole('combobox').fill('Ташкент');
    await expect(palette.getByRole('option', { name: /^Toshkent Agrologistika/ })).toBeVisible();
  });
});

test.describe('Languages and scripts', () => {
  test('names and numbers are the same in ru, uz-Latn and en; only the form chip changes', async ({ page }) => {
    await loginStaff(page, 'underwriter');

    const snapshot = async (path: string, nameCol: number, numCol: number | null, nameInner: string) => {
      await page.goto(path);
      await expect(rows(page).first()).toBeVisible();
      return {
        names: await cellTexts(page, nameCol, nameInner),
        numbers: numCol === null ? [] : await cellTexts(page, numCol, '.num'),
        chips: await rows(page).getByTestId('legal-form').allInnerTexts(),
        codes: await chipCodes(page),
      };
    };
    const pages = [
      { path: '/staff/clients?sort=name:asc', nameCol: 0, numCol: null, nameInner: '.font-medium' },
      { path: '/staff/endorsements?sort=number:asc', nameCol: 1, numCol: 0, nameInner: '' },
    ];

    const base = [];
    for (const p of pages) base.push(await snapshot(p.path, p.nameCol, p.numCol, p.nameInner));
    expect(base[1]!.numbers.some((n) => /^DS-\d+\/DMS-D-/.test(n)), base[1]!.numbers.join(', ')).toBe(true);

    for (const lang of ['uz-Latn', 'en', 'ru'] as const) {
      await setLanguage(page, lang);
      for (const [i, p] of pages.entries()) {
        const s = await snapshot(p.path, p.nameCol, p.numCol, p.nameInner);
        const b = base[i]!;
        expect(s.names, `${lang} ${p.path}`).toEqual(b.names);
        expect(s.numbers, `${lang} ${p.path}`).toEqual(b.numbers);
        expect(s.codes, `${lang} ${p.path}`).toEqual(b.codes);
        const llc = s.codes.flatMap((c, j) => (c === 'llc' ? [s.chips[j]] : []));
        expect(llc.length, p.path).toBeGreaterThan(0);
        expect(new Set(llc), `${lang} ${p.path}`).toEqual(new Set([LLC[lang]]));
      }
    }
  });

  test('no Cyrillic in names and numbers of clients and endorsements in ru', async ({ page }) => {
    await loginStaff(page, 'underwriter');

    await page.goto('/staff/clients');
    await expect(rows(page).first()).toBeVisible();
    const names = await cellTexts(page, 0, '.font-medium');
    expect(names.length).toBeGreaterThan(5);
    for (const n of names) expect(n).not.toMatch(CYRILLIC);
    // The chip is where the Russian abbreviation lives.
    await expect(rows(page).getByTestId('legal-form').filter({ hasText: /^ООО$/ }).first()).toBeVisible();

    await page.goto('/staff/endorsements');
    await expect(rows(page).first()).toBeVisible();
    const numbers = await cellTexts(page, 0, '.num');
    const clients = await cellTexts(page, 1);
    expect(numbers.length).toBeGreaterThan(0);
    for (const n of numbers) {
      expect(n).not.toMatch(CYRILLIC);
      expect(n).toMatch(/^[\x20-\x7E]+$/);
    }
    for (const c of clients) expect(c).not.toMatch(CYRILLIC);
  });
});
