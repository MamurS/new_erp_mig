/*
 * Split view (a list and the details card of the selected row): the card is a sibling of the portal
 * content area, not inside it — the pinned table header never covers it, it does not move while the
 * table scrolls, it scrolls by itself, ↑/↓ switch rows, Esc closes, its width is remembered, and on a
 * narrow screen it opens over the table with a backdrop. ?panel=id survives a reload and Back closes it.
 * Lists with a card (all in the MIG portal): clients, claims, deals (table and board). The other portals
 * have no split view: their rows open a page or a dialog.
 */
import { expect, test, type Locator, type Page } from '@playwright/test';
import type { Role } from '../src/shared/types';
import { loginStaff } from './helpers';

interface Case {
  name: string;
  role: Exclude<Role, 'insured'>;
  path: string;
  /** The text of a row that the card shows as its title. */
  titleCell: (row: Locator) => Locator;
  /** The full page of a row. */
  full: RegExp;
  /** A button of the card's footer besides «Открыть карточку». */
  extra?: string;
}

const CASES: Case[] = [
  { name: 'clients', role: 'underwriter', path: '/staff/clients', titleCell: (r) => r.locator('td').first().locator('.font-medium'), full: /\/staff\/clients\/[0-9a-f-]{36}$/, extra: 'Письмо HR' },
  { name: 'claims', role: 'claims_officer', path: '/staff/claims', titleCell: (r) => r.locator('td').first(), full: /\/staff\/claims\/[0-9a-f-]{36}$/, extra: 'Карточка застрахованного' },
  { name: 'deals', role: 'sales_manager', path: '/staff/deals?view=table', titleCell: (r) => r.locator('td').nth(1), full: /\/staff\/deals\/[0-9a-f-]{36}$/, extra: 'Карточка клиента' },
];

const area = (page: Page) => page.locator('[data-content-scroll]');
const panel = (page: Page) => page.getByTestId('detail-panel');
const title = (page: Page) => page.getByTestId('detail-panel-title');
const rows = (page: Page) => area(page).locator('tbody tr[data-row]');
const box = async (l: Locator) => (await l.boundingBox())!;
const scrollTop = (page: Page) => area(page).evaluate((el) => el.scrollTop);
const settle = (page: Page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
const listPath = (c: Case) => c.path.split('?')[0]!;
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

async function openList(page: Page, c: Case, size = { width: 1280, height: 640 }): Promise<void> {
  await page.setViewportSize(size);
  await loginStaff(page, c.role);
  await page.goto(c.path);
  await expect(rows(page).nth(5)).toBeVisible();
}

const rowTitle = async (c: Case, row: Locator) => (await c.titleCell(row).innerText()).trim();

/** Clicks the n-th row and waits until it is in the card. */
async function openRow(page: Page, c: Case, n: number): Promise<string> {
  const row = rows(page).nth(n);
  const name = await rowTitle(c, row);
  await row.click();
  await expect(panel(page)).toBeVisible();
  await expect(title(page)).toHaveText(name);
  return name;
}

async function scrollAreaTo(page: Page, y: number | 'end'): Promise<void> {
  await area(page).evaluate((el, to) => el.scrollTo(0, to === 'end' ? el.scrollHeight : to), y);
  await settle(page);
}

for (const c of CASES) {
  test.describe(`${c.name} · docked card`, () => {
    test('(a) nothing covers the card: points inside it hit the card, not the pinned table header', async ({ page }) => {
      await openList(page, c);
      await openRow(page, c, 1);
      await expect(panel(page)).toHaveAttribute('data-mode', 'docked');
      // The card is outside the content area: a sibling, not a descendant.
      expect(await panel(page).evaluate((el) => !el.closest('[data-content-scroll]'))).toBe(true);
      await scrollAreaTo(page, 400);
      const p = await box(panel(page));
      const content = await box(area(page));
      // The content area ends where the card begins: the table overlaps nothing.
      expect(Math.abs(content.x + content.width - p.x)).toBeLessThanOrEqual(1);
      const misses = await page.evaluate(
        ({ x, y, width, height }) => {
          const out: string[] = [];
          for (const fx of [0.02, 0.25, 0.5, 0.75, 0.98])
            for (const fy of [0.01, 0.05, 0.25, 0.5, 0.75, 0.95, 0.99]) {
              const el = document.elementFromPoint(x + width * fx, y + height * fy);
              if (!el?.closest('[data-testid="detail-panel"]') || el.closest('thead, [data-content-scroll]')) out.push(`${fx},${fy}:${el?.tagName}`);
            }
          return out;
        },
        p,
      );
      expect(misses).toEqual([]);
      // The pinned header is there, left of the card's edge.
      const head = await box(area(page).locator('thead th').first());
      const hit = await page.evaluate(([x, y]) => !!document.elementFromPoint(x!, y!)?.closest('thead th'), [head.x + 10, head.y + head.height / 2]);
      expect(hit).toBe(true);
    });

    test('(b) the card and its title do not move while the table scrolls to the very end; the card spans top bar → window bottom', async ({ page }) => {
      await openList(page, c);
      await openRow(page, c, 0);
      const before = await box(panel(page));
      const titleBefore = await box(title(page));
      const bar = await box(page.getByTestId('topbar'));
      expect(Math.abs(before.y - (bar.y + bar.height))).toBeLessThanOrEqual(1);
      expect(Math.abs(before.y + before.height - 640)).toBeLessThanOrEqual(1);
      await scrollAreaTo(page, 'end');
      expect(await scrollTop(page)).toBeGreaterThan(100);
      expect(await box(panel(page))).toEqual(before);
      expect(await box(title(page))).toEqual(titleBefore);
      await expect(title(page)).toBeInViewport();
      // The actions stay pinned at the bottom of the card.
      const footer = page.getByTestId('detail-panel-footer');
      const f = await box(footer);
      expect(Math.abs(f.y + f.height - (before.y + before.height))).toBeLessThanOrEqual(1);
      await expect(footer.getByRole('button', { name: 'Открыть карточку' })).toBeVisible();
      if (c.extra) await expect(footer.getByRole('button', { name: c.extra })).toBeVisible();
    });

    test('(c) scrolling inside the card does not scroll the table', async ({ page }) => {
      await openList(page, c, { width: 1280, height: 420 });
      await openRow(page, c, 0);
      await scrollAreaTo(page, 120);
      const body = page.getByTestId('detail-panel-body');
      await expect(body.locator('section').first()).toBeVisible();
      expect(await body.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
      const b = await box(body);
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
      await page.mouse.wheel(0, 600);
      await expect.poll(() => body.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
      await page.mouse.wheel(0, 2000);
      await settle(page);
      expect(await scrollTop(page)).toBe(120);
      await expect(title(page)).toBeInViewport();
    });

    test('(d) ↑/↓ switch rows in the card, the selected row is highlighted and kept in view; Enter opens the full card; Esc closes', async ({ page }) => {
      await openList(page, c);
      await openRow(page, c, 1);
      const head = area(page).locator('thead th').first();
      const pager = page.getByTestId('table-pager');
      const last = Math.min(18, (await rows(page).count()) - 1);
      for (let i = 2; i <= last; i++) {
        await page.keyboard.press('ArrowDown');
        const row = rows(page).nth(i);
        await expect(title(page)).toHaveText(await rowTitle(c, row));
        await expect(row).toHaveAttribute('aria-selected', 'true');
        await expect(rows(page).nth(i - 1)).not.toHaveAttribute('aria-selected', 'true');
        await settle(page);
        const r = await box(row);
        const h = await box(head);
        // Visible: below the pinned header, above the pinned pager (or the bottom of the content area).
        const floor = (await pager.count()) ? (await box(pager)).y : (await box(area(page))).y + (await area(page).evaluate((el) => el.clientHeight));
        expect(r.y, `row ${i}`).toBeGreaterThanOrEqual(h.y + h.height - 1);
        expect(r.y + r.height, `row ${i}`).toBeLessThanOrEqual(floor + 1);
      }
      expect(await scrollTop(page)).toBeGreaterThan(0);
      await page.keyboard.press('ArrowUp');
      await expect(title(page)).toHaveText(await rowTitle(c, rows(page).nth(last - 1)));
      // Only one history entry for the whole walk: Esc goes back to the list.
      await page.keyboard.press('Escape');
      await expect(panel(page)).toHaveCount(0);
      await expect(page).not.toHaveURL(/panel=/);
      await expect(page.locator('tbody tr[aria-selected="true"]')).toHaveCount(0);

      await openRow(page, c, 3);
      await page.keyboard.press('Enter');
      await expect(page).toHaveURL(c.full);
    });

    test('(e) the card is resized by dragging its left edge and from the keyboard; the width survives a reload', async ({ page }) => {
      await openList(page, c);
      await openRow(page, c, 0);
      const sep = page.getByTestId('detail-panel-resize');
      await expect(sep).toHaveAttribute('role', 'separator');
      await expect(sep).toHaveAttribute('aria-valuenow', '420');
      await expect(sep).toHaveAttribute('aria-valuemin', '360');
      await expect(sep).toHaveAttribute('aria-valuemax', '640');
      const s = await box(sep);
      const x0 = s.x + s.width / 2;
      await page.mouse.move(x0, s.y + 200);
      await page.mouse.down();
      await page.mouse.move(x0 - 50, s.y + 200, { steps: 4 });
      await page.mouse.move(x0 - 100, s.y + 200, { steps: 4 });
      await page.mouse.up();
      await expect(sep).toHaveAttribute('aria-valuenow', '520');
      expect(Math.round((await box(panel(page))).width)).toBe(520);
      // Clamped at 640.
      await page.mouse.move(x0 - 100, s.y + 200);
      await page.mouse.down();
      await page.mouse.move(x0 - 600, s.y + 200, { steps: 4 });
      await page.mouse.up();
      await expect(sep).toHaveAttribute('aria-valuenow', '640');
      await sep.focus();
      await page.keyboard.press('ArrowRight');
      await expect(sep).toHaveAttribute('aria-valuenow', '624');
      await page.keyboard.press('Home');
      await expect(sep).toHaveAttribute('aria-valuenow', '360');
      await page.keyboard.press('ArrowLeft');
      await expect(sep).toHaveAttribute('aria-valuenow', '376');
      await sep.dblclick();
      await expect(sep).toHaveAttribute('aria-valuenow', '420');
      await page.keyboard.press('ArrowLeft');
      await page.keyboard.press('ArrowLeft');
      await expect(sep).toHaveAttribute('aria-valuenow', '452');

      await page.reload();
      await expect(panel(page)).toBeVisible();
      await expect(page.getByTestId('detail-panel-resize')).toHaveAttribute('aria-valuenow', '452');
      expect(Math.round((await box(panel(page))).width)).toBe(452);
    });

    test('a direct ?panel= link opens the list with the card; Back closes a card opened from the list', async ({ page }) => {
      await openList(page, c);
      const name = await openRow(page, c, 2);
      await expect(page).toHaveURL(/[?&]panel=[0-9a-f-]{36}/);
      const url = page.url();
      // Switching rows replaces the entry: one Back closes the card, whichever row it shows.
      await rows(page).nth(4).click();
      await expect(title(page)).not.toHaveText(name);
      await page.goBack();
      await expect(panel(page)).toHaveCount(0);
      await expect(page).not.toHaveURL(/panel=/);
      await expect(page).toHaveURL(new RegExp(escape(listPath(c))));
      await page.goForward();
      await expect(panel(page)).toBeVisible();

      await page.goto(url);
      await expect(panel(page)).toBeVisible();
      await expect(title(page)).toHaveText(name);
      // Opened by a link: closing just drops the parameter.
      await page.getByTestId('detail-panel-close').click();
      await expect(panel(page)).toHaveCount(0);
      await expect(page).not.toHaveURL(/panel=/);
    });
  });

  test(`${c.name} · (f) at 1100 px the card opens over the table with a backdrop; the table under it does not scroll; Esc, backdrop and close button close it`, async ({ page }) => {
    await openList(page, c, { width: 1100, height: 640 });
    await scrollAreaTo(page, 300);
    const n = Math.min(8, (await rows(page).count()) - 3);
    const name = await openRow(page, c, n);
    await expect(panel(page)).toHaveAttribute('data-mode', 'overlay');
    await expect(page.getByTestId('detail-panel-backdrop')).toBeVisible();
    await expect(page.getByRole('dialog', { name })).toBeVisible();
    const before = await scrollTop(page);
    const p = await box(panel(page));
    expect(Math.round(p.x + p.width)).toBe(1100);
    // Wheel over the backdrop (the table under it) and over the card.
    await page.mouse.move(200, 400);
    await page.mouse.wheel(0, 800);
    await page.mouse.move(p.x + p.width / 2, p.y + p.height / 2);
    await page.mouse.wheel(0, 800);
    await settle(page);
    expect(await scrollTop(page)).toBe(before);
    // Focus stays inside the card.
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press('Tab');
      expect(await page.evaluate(() => !!document.activeElement?.closest('[data-testid="detail-panel"]'))).toBe(true);
    }
    await page.keyboard.press('Escape');
    await expect(panel(page)).toHaveCount(0);

    await openRow(page, c, n + 1);
    await page.mouse.click(100, 400);
    await expect(panel(page)).toHaveCount(0);

    const name2 = await openRow(page, c, n + 2);
    const url = page.url();
    await page.getByTestId('detail-panel-close').click();
    await expect(panel(page)).toHaveCount(0);
    // The table scrolls again (focus went back to the row, which may have brought it into view).
    await scrollAreaTo(page, 0);
    await page.mouse.move(400, 400);
    await page.mouse.wheel(0, 300);
    await expect.poll(() => scrollTop(page)).toBeGreaterThan(0);

    // Back closes the card; a direct link opens it over the table.
    await openRow(page, c, 1);
    await page.goBack();
    await expect(panel(page)).toHaveCount(0);
    await page.goto(url);
    await expect(panel(page)).toHaveAttribute('data-mode', 'overlay');
    await expect(title(page)).toHaveText(name2);
  });
}

test('clients: a dialog inside the card closes first on Esc; print leaves the card out', async ({ page }) => {
  await openList(page, CASES[0]!);
  await openRow(page, CASES[0]!, 0);
  await page.getByTestId('detail-panel-footer').getByRole('button', { name: 'Письмо HR' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(panel(page)).toBeVisible();
  await page.emulateMedia({ media: 'print' });
  await expect(panel(page)).toBeHidden();
  await page.emulateMedia({ media: 'screen' });
  await expect(panel(page)).toBeVisible();
});

test('deals board: a click on a deal opens its card beside the board, Enter on a deal opens the full card, Esc and Back close', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 640 });
  await loginStaff(page, 'sales_manager');
  await page.goto('/staff/deals');
  const tiles = page.getByTestId('deal-card');
  await expect(tiles.nth(3)).toBeVisible();
  const tile = tiles.nth(1);
  const client = (await tile.locator('.font-semibold').first().innerText()).trim();
  await tile.click();
  await expect(panel(page)).toBeVisible();
  await expect(title(page)).toHaveText(client);
  await expect(tile).toHaveAttribute('data-selected', '');
  await expect(page).toHaveURL(/\/staff\/deals\?panel=[0-9a-f-]{36}$/);
  expect(await panel(page).evaluate((el) => !el.closest('[data-content-scroll]'))).toBe(true);
  const url = page.url();
  // Another deal replaces the card; Back closes it.
  await tiles.nth(2).click();
  await expect(tiles.nth(2)).toHaveAttribute('data-selected', '');
  await page.goBack();
  await expect(panel(page)).toHaveCount(0);
  await expect(page).toHaveURL(/\/staff\/deals$/);
  // Direct link; Esc closes.
  await page.goto(url);
  await expect(title(page)).toHaveText(client);
  await page.keyboard.press('Escape');
  await expect(panel(page)).toHaveCount(0);
  // Enter on a focused deal follows its link to the full card.
  await tiles.nth(1).focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/staff\/deals\/[0-9a-f-]{36}$/);
});
