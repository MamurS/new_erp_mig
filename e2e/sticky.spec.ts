/*
 * Pinned table headers in every portal, as in GitHub and Notion: the portal content area under the top
 * bar is the only vertical scroll container; the page title and filters scroll away, the table header
 * stops at the bottom edge of the top bar and stays there to the very end of the page, and the
 * pagination (and totals row) stays at the bottom of the screen while the table is on screen.
 * Long tables: MIG clients, assistance cases, a clinic registry, HR employees.
 */
import { expect, test, type Locator, type Page } from '@playwright/test';
import type { Role } from '../src/shared/types';
import { loginStaff } from './helpers';

interface Case {
  portal: string;
  role: Exclude<Role, 'insured'>;
  open: (page: Page) => Promise<void>;
  /** Accessible name of a sortable header button. */
  sortBy: RegExp;
  /** Viewport height that makes this page longer than the screen. */
  height: number;
}

const CASES: Case[] = [
  { portal: 'staff · clients', role: 'underwriter', open: (page) => page.goto('/staff/clients').then(() => undefined), sortBy: /^Клиент/, height: 640 },
  { portal: 'assist · cases', role: 'asst_operator', open: (page) => page.goto('/assist/cases').then(() => undefined), sortBy: /^Создано/, height: 420 },
  {
    portal: 'clinic · registry',
    role: 'clinic_admin',
    open: async (page) => {
      await page.goto('/clinic/registries');
      // A sent registry: a draft has the «add a line» form under the table.
      await page.locator('tbody tr[data-row]').filter({ hasNotText: 'Черновик' }).first().click();
      await expect(page).toHaveURL(/\/clinic\/registries\/[0-9a-f-]{36}/);
    },
    sortBy: /^Дата/,
    height: 360,
  },
  { portal: 'hr · employees', role: 'hr', open: (page) => page.goto('/hr').then(() => undefined), sortBy: /^Сотрудник/, height: 640 },
];

const area = (page: Page) => page.locator('[data-content-scroll]');
const top = (l: Locator) => l.evaluate((el) => el.getBoundingClientRect().top);
const bottom = (l: Locator) => l.evaluate((el) => el.getBoundingClientRect().bottom);

/** The longest table on the page (its wrapper). */
async function mainTable(page: Page): Promise<Locator> {
  const tables = area(page).locator('[data-table-scroll]');
  await expect(tables.first()).toBeVisible();
  // Real rows, not the loading skeleton.
  await expect(area(page).locator('[data-table-scroll] tbody tr[data-row]').nth(3)).toBeAttached();
  const n = await tables.count();
  let best = 0;
  let bestH = -1;
  for (let i = 0; i < n; i++) {
    const h = await tables.nth(i).evaluate((el) => el.getBoundingClientRect().height);
    if (h > bestH) [best, bestH] = [i, h];
  }
  return tables.nth(best);
}

async function scrollTo(page: Page, y: number | 'end'): Promise<void> {
  await area(page).evaluate((el, to) => el.scrollTo(0, to === 'end' ? el.scrollHeight : to), y);
  // Let sticky layout and the scroll listener settle.
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
}

async function expectHeaderAtBar(page: Page, table: Locator, barBottom: number, head = table.locator('thead th').first()): Promise<void> {
  expect(Math.abs((await top(head)) - barBottom), 'header top = top bar bottom').toBeLessThanOrEqual(1);
  await expect(table).toHaveAttribute('data-scrolled', '');
  // Nothing covers the header: the topmost element at its centre is a header cell, not a row.
  const box = (await head.boundingBox())!;
  const hit = await page.evaluate(
    ([x, y]) => {
      const el = document.elementFromPoint(x!, y!);
      return { head: !!el?.closest('thead th'), row: !!el?.closest('tbody tr') };
    },
    [box.x + Math.min(box.width / 2, 40), box.y + box.height / 2],
  );
  expect(hit).toEqual({ head: true, row: false });
}

/** While the table is on screen, its pagination bar (and totals row) is fully on screen. */
async function expectFooterVisible(page: Page, table: Locator): Promise<void> {
  const viewport = page.viewportSize()!.height;
  // The table has not reached the screen yet (a tall page head): nothing to pin.
  if ((await top(table)) + 80 >= viewport) return;
  const holder = table.locator('xpath=..');
  const pager = holder.getByTestId('table-pager');
  // Sticky positioning moves the totals cells, not the tfoot box.
  const totals = table.getByTestId('table-totals').locator('td').first();
  for (const l of [pager, totals]) {
    if (!(await l.count())) continue;
    expect(await bottom(l), 'footer bottom within the screen').toBeLessThanOrEqual(viewport + 0.5);
    expect(await top(l)).toBeGreaterThanOrEqual(0);
  }
}

/** Elements in the portal's main column that scroll vertically. */
function verticalScrollers(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const column = document.querySelector('[data-content-scroll]')!.parentElement!;
    const out: string[] = [];
    for (const el of [column, ...column.querySelectorAll<HTMLElement>('*')]) {
      const y = getComputedStyle(el).overflowY;
      if ((y === 'auto' || y === 'scroll') && el.scrollHeight > el.clientHeight + 1) out.push(el.getAttribute('data-content-scroll') !== null ? 'content' : el.tagName + '.' + el.className);
    }
    if (document.scrollingElement && document.scrollingElement.scrollHeight > document.scrollingElement.clientHeight + 1) out.push('document');
    return out;
  });
}

for (const c of CASES) {
  test(`${c.portal}: one scroll container; the header scrolls with the page, then stays under the top bar to the very end; sorting works pinned`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: c.height });
    await loginStaff(page, c.role);
    await c.open(page);
    const table = await mainTable(page);
    const head = table.locator('thead th').first();
    const title = page.getByRole('heading', { level: 1 }).first();
    const barBottom = await bottom(page.getByTestId('topbar'));

    // No own vertical scrolling of the table; exactly one vertical scroll container: the content area.
    expect(await table.evaluate((el) => el.scrollHeight === el.clientHeight)).toBe(true);
    expect(await verticalScrollers(page)).toEqual(['content']);

    // At rest: the header stands below the title and the filters, the table is not marked pinned.
    const start = await top(head);
    expect(start).toBeGreaterThan(await bottom(title));
    expect(start).toBeGreaterThan(barBottom + 20);
    await expect(table).not.toHaveAttribute('data-scrolled', '');
    await expectFooterVisible(page, table);

    // 100 px down: the header moved up together with the page.
    await scrollTo(page, 100);
    expect(Math.abs((await top(head)) - (start - 100))).toBeLessThanOrEqual(1);
    await expectFooterVisible(page, table);

    // Past the filters: the header top equals the top bar bottom.
    const tableOffset = await table.evaluate((el) => el.getBoundingClientRect().top - document.querySelector('[data-content-scroll]')!.getBoundingClientRect().top + document.querySelector('[data-content-scroll]')!.scrollTop);
    await scrollTo(page, tableOffset + 120);
    await expectHeaderAtBar(page, table, barBottom);
    await expectFooterVisible(page, table);

    // The very end of the page: still under the top bar, the page title is gone.
    await scrollTo(page, 'end');
    await expectHeaderAtBar(page, table, barBottom);
    expect(await bottom(title)).toBeLessThanOrEqual(barBottom);
    await expectFooterVisible(page, table);
    expect(await table.evaluate((el) => el.scrollHeight === el.clientHeight)).toBe(true);

    // Sorting by a click on the pinned header.
    const th = table.locator('thead th').filter({ has: page.getByRole('button', { name: c.sortBy }) });
    const sortButton = th.getByRole('button', { name: c.sortBy });
    const before = await th.getAttribute('aria-sort');
    await sortButton.click();
    await expect(th).toHaveAttribute('aria-sort', /ascending|descending/);
    expect(await th.getAttribute('aria-sort')).not.toBe(before);
  });
}

test('narrow screen: the header is pinned under the top bar and a wide table is reachable by scrolling the content area sideways', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 700 });
  await loginStaff(page, 'underwriter');
  await page.goto('/staff/clients');
  const table = await mainTable(page);
  const barBottom = await bottom(page.getByTestId('topbar'));
  expect(await verticalScrollers(page)).toEqual(['content']);
  const offset = await table.evaluate((el) => el.getBoundingClientRect().top - document.querySelector('[data-content-scroll]')!.getBoundingClientRect().top);
  await scrollTo(page, offset + 120);
  await expectHeaderAtBar(page, table, barBottom);
  // The table is wider than the screen: the content area scrolls sideways, the table wrapper does not.
  const wide = await area(page).evaluate((el) => el.scrollWidth > el.clientWidth);
  expect(wide).toBe(true);
  expect(await table.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  const lastHead = table.locator('thead th').last();
  await area(page).evaluate((el) => el.scrollTo({ left: el.scrollWidth }));
  const box = (await lastHead.boundingBox())!;
  expect(box.x + box.width).toBeLessThanOrEqual(390);
  await expectHeaderAtBar(page, table, barBottom, lastHead);
});

test('with and without the demo banner the header stops right under the top bar', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 640 });
  await loginStaff(page, 'hr');
  await page.goto('/hr');
  await expect(page.getByRole('region', { name: 'Демо-режим' })).toBeVisible();
  let table = await mainTable(page);
  let barBottom = await bottom(page.getByTestId('topbar'));
  expect(Math.round(barBottom)).toBe(36 + 52);
  await scrollTo(page, 'end');
  await expectHeaderAtBar(page, table, barBottom);

  // Without the banner (as in a build without VITE_DEMO_MODE) the offset is the top bar alone.
  await page.evaluate(() => {
    document.documentElement.style.removeProperty('--banner-h');
    const b = document.querySelector<HTMLElement>('[role="region"][aria-label="Демо-режим"]');
    if (b) b.style.display = 'none';
  });
  table = await mainTable(page);
  barBottom = await bottom(page.getByTestId('topbar'));
  expect(Math.round(barBottom)).toBe(52);
  await scrollTo(page, 'end');
  await expectHeaderAtBar(page, table, barBottom);
  expect(await verticalScrollers(page)).toEqual(['content']);
});

test('a pinned header stays below menus; print does not pin it and does not clip the page', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 640 });
  await loginStaff(page, 'underwriter');
  await page.goto('/staff/clients');
  const table = await mainTable(page);
  await scrollTo(page, 'end');
  await page.getByTestId('sidebar').getByRole('button', { name: 'Меню пользователя' }).click();
  await expect(page.getByRole('menuitem', { name: 'Профиль' })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.emulateMedia({ media: 'print' });
  expect(await table.locator('thead th').first().evaluate((el) => getComputedStyle(el).position)).toBe('static');
  expect(await area(page).evaluate((el) => getComputedStyle(el).overflowY)).toBe('visible');
  await page.emulateMedia({ media: 'screen' });
});

test('a new page opens at the top of the content area', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 640 });
  await loginStaff(page, 'underwriter');
  await page.goto('/staff/clients');
  await mainTable(page);
  await scrollTo(page, 'end');
  expect(await area(page).evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  await page.getByTestId('sidebar').getByRole('link', { name: 'Полисы' }).click();
  await expect(page).toHaveURL(/\/staff\/policies/);
  await expect.poll(() => area(page).evaluate((el) => el.scrollTop)).toBe(0);
});

/*
 * A wide table never spills over its neighbours: every block on the way from the content area to the
 * table is at least as wide as the table, so sibling blocks (a side column, a summary) are pushed aside
 * and the content area scrolls sideways instead. Checked on every section of the side menu.
 */
for (const role of ['underwriter', 'accountant', 'claims_officer', 'asst_operator', 'clinic_admin', 'hr'] as const) {
  test(`${role}: no table overlaps a neighbouring block on any section`, async ({ page }) => {
    test.slow();
    await page.setViewportSize({ width: 1280, height: 800 });
    await loginStaff(page, role);
    const paths = await page.getByTestId('sidebar').getByRole('link').evaluateAll((as) => [...new Set(as.map((a) => (a as HTMLAnchorElement).pathname))]);
    for (const path of paths) {
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      const overlaps = await page.evaluate(() => {
        const area = document.querySelector('[data-content-scroll]');
        const out: string[] = [];
        const visible = (r: DOMRect) => r.width > 0 && r.height > 0;
        for (const table of document.querySelectorAll<HTMLElement>('[data-content-scroll] [data-table-scroll]')) {
          for (let el: HTMLElement = table; el.parentElement && el.parentElement !== area; el = el.parentElement) {
            const r = el.getBoundingClientRect();
            for (const sib of el.parentElement.children) {
              if (sib === el || !(sib instanceof HTMLElement) || ['absolute', 'fixed', 'sticky'].includes(getComputedStyle(sib).position)) continue;
              const s = sib.getBoundingClientRect();
              const w = Math.min(r.right, s.right) - Math.max(r.left, s.left);
              const h = Math.min(r.bottom, s.bottom) - Math.max(r.top, s.top);
              if (visible(r) && visible(s) && w > 1 && h > 1) out.push(`${el.tagName}.${el.className} × ${sib.tagName}.${sib.className}`.slice(0, 200));
            }
          }
        }
        return out;
      });
      expect(overlaps, path).toEqual([]);
    }
  });
}
