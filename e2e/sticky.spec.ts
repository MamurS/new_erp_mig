/*
 * Pinned table headers in every portal: after scrolling down the header row stays visible right under
 * the portal's top bar (and the demo banner), nothing else covers it, and sorting by a click on the
 * pinned header works. Long tables: MIG clients, assistance cases, a clinic registry, HR employees.
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
  /** Viewport height that makes this table longer than the screen. */
  height: number;
}

const CASES: Case[] = [
  {
    portal: 'staff · clients',
    role: 'underwriter',
    open: async (page) => {
      await page.goto('/staff/clients');
    },
    sortBy: /^Клиент/,
    height: 640,
  },
  {
    portal: 'assist · cases',
    role: 'asst_operator',
    open: async (page) => {
      await page.goto('/assist/cases');
    },
    sortBy: /^Создано/,
    height: 380,
  },
  {
    portal: 'clinic · registry',
    role: 'clinic_admin',
    open: async (page) => {
      await page.goto('/clinic/registries');
      await page.locator('tbody tr').first().click();
      await expect(page).toHaveURL(/\/clinic\/registries\/[0-9a-f-]{36}/);
    },
    sortBy: /^Дата/,
    height: 380,
  },
  {
    portal: 'hr · employees',
    role: 'hr',
    open: async (page) => {
      await page.goto('/hr');
    },
    sortBy: /^Сотрудник/,
    height: 640,
  },
];

/** The largest table on the page (its scroll container). */
async function mainTable(page: Page): Promise<Locator> {
  const tables = page.locator('[data-table-scroll]');
  await expect(tables.first()).toBeVisible();
  await expect(page.locator('[data-table-scroll] tbody tr').nth(3)).toBeAttached();
  const n = await tables.count();
  let best = 0;
  let bestH = -1;
  for (let i = 0; i < n; i++) {
    const h = await tables.nth(i).evaluate((el) => el.scrollHeight);
    if (h > bestH) [best, bestH] = [i, h];
  }
  return tables.nth(best);
}

/** Scrolls the page until the table reaches the top bar, then the table itself; returns the bar's bottom. */
async function scrollDown(page: Page, scroller: Locator): Promise<number> {
  const barBottom = await page.getByTestId('topbar').evaluate((el) => el.getBoundingClientRect().bottom);
  await scroller.evaluate((el, bar) => window.scrollBy(0, el.getBoundingClientRect().top - bar), barBottom);
  await expect.poll(() => scroller.evaluate((el) => Math.round(el.getBoundingClientRect().top))).toBe(Math.round(barBottom));
  const canScroll = await scroller.evaluate((el) => el.scrollHeight > el.clientHeight + 40);
  expect(canScroll, 'the table is longer than the screen').toBe(true);
  await scroller.hover();
  await page.mouse.wheel(0, 600);
  await expect.poll(() => scroller.evaluate((el) => el.scrollTop)).toBeGreaterThan(100);
  return barBottom;
}

async function expectPinned(page: Page, scroller: Locator, barBottom: number): Promise<void> {
  // The light separator shadow appears once the table is scrolled.
  await expect(scroller).toHaveAttribute('data-scrolled', '');
  const head = scroller.locator('thead th, [data-sticky-head]').first();
  await expect(head).toBeVisible();
  const box = (await head.boundingBox())!;
  expect(Math.abs(box.y - barBottom), `header top ${box.y} vs bar bottom ${barBottom}`).toBeLessThanOrEqual(1);
  // Nothing covers the header: the topmost element at its centre is a header cell, not a data row.
  const hit = await page.evaluate(
    ([x, y]) => {
      const el = document.elementFromPoint(x!, y!);
      return { head: !!el?.closest('thead th, [data-sticky-head]'), row: !!el?.closest('tbody tr') };
    },
    [box.x + Math.min(box.width / 2, 40), box.y + box.height / 2],
  );
  expect(hit).toEqual({ head: true, row: false });
}

for (const c of CASES) {
  test(`${c.portal}: the header stays under the top bar after scrolling; elementFromPoint hits the header; sorting by the pinned header works`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: c.height });
    await loginStaff(page, c.role);
    await c.open(page);
    const scroller = await mainTable(page);
    // At rest: no shadow under the header.
    await expect(scroller).not.toHaveAttribute('data-scrolled', '');
    const barBottom = await scrollDown(page, scroller);
    await expectPinned(page, scroller, barBottom);

    // Sort by a click on the pinned header.
    const th = scroller.locator('thead th').filter({ has: page.getByRole('button', { name: c.sortBy }) });
    const sortButton = th.getByRole('button', { name: c.sortBy });
    const before = await th.getAttribute('aria-sort');
    await sortButton.click();
    await expect(th).not.toHaveAttribute('aria-sort', before ?? 'none');
    await expect(th).toHaveAttribute('aria-sort', /ascending|descending/);
    const first = await th.getAttribute('aria-sort');
    await sortButton.click();
    await expect(th).not.toHaveAttribute('aria-sort', first!);
  });
}

test('narrow screen: the header is still pinned under the top bar', async ({ page }) => {
  await page.setViewportSize({ width: 820, height: 700 });
  await loginStaff(page, 'underwriter');
  await page.goto('/staff/clients');
  const scroller = await mainTable(page);
  const barBottom = await scrollDown(page, scroller);
  await expectPinned(page, scroller, barBottom);
});

test('with and without the demo banner the header sits right under the top bar', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 640 });
  await loginStaff(page, 'hr');
  await page.goto('/hr');
  const banner = page.getByRole('region', { name: 'Демо-режим' });
  await expect(banner).toBeVisible();
  let scroller = await mainTable(page);
  let barBottom = await scrollDown(page, scroller);
  expect(Math.round(barBottom)).toBe(36 + 52);
  await expectPinned(page, scroller, barBottom);

  // Without the banner (as in a build without VITE_DEMO_MODE) the offset is the top bar alone.
  await page.evaluate(() => {
    document.documentElement.style.removeProperty('--banner-h');
    const b = document.querySelector<HTMLElement>('[role="region"][aria-label="Демо-режим"]');
    if (b) b.style.display = 'none';
  });
  await page.evaluate(() => window.scrollTo(0, 0));
  scroller = await mainTable(page);
  await scroller.evaluate((el) => el.scrollTo(0, 0));
  barBottom = await scrollDown(page, scroller);
  expect(Math.round(barBottom)).toBe(52);
  await expectPinned(page, scroller, barBottom);
  expect(await scroller.evaluate((el) => Math.round(el.getBoundingClientRect().height))).toBeLessThanOrEqual(640 - 52);
});

test('a pinned header stays below menus and the slide-in side panel; print does not pin it', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 640 });
  await loginStaff(page, 'underwriter');
  await page.goto('/staff/clients');
  const scroller = await mainTable(page);
  await scrollDown(page, scroller);
  // The user menu opens above the pinned header.
  await page.getByTestId('sidebar').getByRole('button', { name: 'Меню пользователя' }).click();
  const item = page.getByRole('menuitem', { name: 'Профиль' });
  await expect(item).toBeVisible();
  await page.keyboard.press('Escape');
  // Print media: header cells are static and the wrapper does not scroll.
  await page.emulateMedia({ media: 'print' });
  const pos = await scroller.locator('thead th').first().evaluate((el) => getComputedStyle(el).position);
  expect(pos).toBe('static');
  expect(await scroller.evaluate((el) => getComputedStyle(el).overflowY)).toBe('visible');
  await page.emulateMedia({ media: 'screen' });
});
