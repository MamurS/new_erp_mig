/*
 * Side columns (src/shared/ui/side-column.tsx, sticky-sections.tsx): a column next to the main content
 * is a sibling of the portal content area — it stays in place while the main area scrolls, spans from
 * the top bar to the bottom of the window and scrolls by itself; the headings of its sections pin under
 * its shared header in turn (the next one pushes the previous one up). Below 1280 px the information
 * columns go under the main content and scroll with the page.
 */
import { expect, test, type Locator, type Page } from './test';
import { api, loginStaff } from './helpers';

const area = (page: Page) => page.locator('[data-content-scroll]');
const box = async (l: Locator) => (await l.boundingBox())!;
const settle = (page: Page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
const scrollTop = (l: Locator) => l.evaluate((el) => el.scrollTop);
const barBottom = async (page: Page) => {
  const b = await box(page.getByTestId('topbar'));
  return b.y + b.height;
};

/** The box once it stops moving (a card that opens slides in; measuring mid-animation gives a stale origin). */
async function stableBox(l: Locator): Promise<Awaited<ReturnType<typeof box>>> {
  let prev = await box(l);
  for (let i = 0; i < 30; i++) {
    await settle(l.page());
    const next = await box(l);
    if (JSON.stringify(next) === JSON.stringify(prev)) return next;
    prev = next;
  }
  return prev;
}

async function scrollTo(l: Locator, y: number | 'end'): Promise<void> {
  await l.evaluate((el, to) => el.scrollTo({ top: to === 'end' ? el.scrollHeight : to }), y);
  await settle(l.page());
}

for (const role of ['underwriter', 'accountant'] as const) {
  test(`dashboard (${role}): after scrolling the queue to the end «Требует внимания» and «Интеграции» stay under the top bar`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 640 });
    await loginStaff(page, role);
    await page.goto('/staff');
    const side = page.getByTestId('dashboard-side');
    const attention = page.getByTestId('dashboard-attention');
    const integrations = page.getByTestId('dashboard-integrations');
    await expect(attention).toBeVisible();
    await expect(integrations).toBeVisible();
    // Both blocks have loaded (no skeletons): their size no longer changes.
    await expect(attention.getByRole('status')).toHaveCount(0);
    await expect(integrations.getByRole('status')).toHaveCount(0);
    await expect(attention.locator('a, p').first()).toBeVisible();
    await expect(integrations.locator('li, p').first()).toBeVisible();
    await expect(area(page).locator('tbody tr').nth(5)).toBeVisible();
    // A sibling of the content area, from the bottom of the top bar to the bottom of the window.
    expect(await side.evaluate((el) => el.closest('[data-content-scroll]') === null)).toBe(true);
    const bar = await barBottom(page);
    const col = await box(side);
    expect(Math.abs(col.y - bar)).toBeLessThanOrEqual(1);
    expect(Math.abs(col.y + col.height - 640)).toBeLessThanOrEqual(1);

    const a0 = await box(attention);
    const i0 = await box(integrations);
    await scrollTo(area(page), 'end');
    expect(await scrollTop(area(page))).toBeGreaterThan(100);
    expect(await box(attention)).toEqual(a0);
    expect(await box(integrations)).toEqual(i0);
    expect(a0.y).toBeGreaterThanOrEqual(bar - 1);
    await expect(attention.getByRole('heading', { name: 'Требует внимания' })).toBeInViewport();
    await expect(integrations.getByRole('heading', { name: 'Интеграции' })).toBeInViewport();
  });
}

test('client card with a long «Активность»: the header is pinned, «Активность» rides under it, «Контакт HR» is gone; the table does not move', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 640 });
  await loginStaff(page, 'underwriter');
  await page.goto('/staff/clients');
  await page.getByPlaceholder('Название или ИНН').fill('Toshkent Agrologistika');
  const row = area(page).locator('tbody tr[data-row]').filter({ hasText: 'Toshkent Agrologistika' });
  await expect(row).toHaveCount(1);
  await row.click();
  const panel = page.getByTestId('detail-panel');
  await expect(page.getByTestId('detail-panel-title')).toHaveText('Toshkent Agrologistika');
  const activity = page.getByTestId('client-panel-activity');
  await expect(activity.locator('li')).toHaveCount(await activity.locator('li').count());
  expect(await activity.locator('li').count()).toBeGreaterThanOrEqual(40);

  const body = page.getByTestId('detail-panel-body');
  const header = page.getByTestId('detail-panel-header');
  const hr = page.getByTestId('client-panel-hr');
  const head = (s: Locator) => s.locator('[data-section-head]');
  const tableTop = await scrollTop(area(page));
  const h0 = await stableBox(header);

  // Scroll the card until «Активность» reaches the header, then on into the middle of the list.
  const actTop = await activity.evaluate((el) => {
    const scroller = el.closest('[data-column-scroll]')!;
    return el.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
  });
  await scrollTo(body, actTop - h0.height + 400);

  expect(await box(header)).toEqual(h0);
  await expect(page.getByTestId('detail-panel-title')).toBeInViewport();
  const a = await box(head(activity));
  expect(Math.abs(a.y - (h0.y + h0.height))).toBeLessThanOrEqual(1);
  await expect(head(activity)).toHaveAttribute('data-stuck', '');
  const hrHead = await box(head(hr));
  expect(hrHead.y + hrHead.height).toBeLessThanOrEqual(h0.y + h0.height + 1);
  // The card scrolls by itself: the table under it stays where it was.
  expect(await scrollTop(area(page))).toBe(tableTop);
  expect(await panel.evaluate((el) => el.closest('[data-content-scroll]') === null)).toBe(true);
});

test('claim card: the section headings of the data column pin in turn, the next pushes the previous up', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 520 });
  await loginStaff(page, 'claims_officer');
  // A claim with a long data column: fiscal data of the receipt and attachments.
  const list = (await api(page, 'GET', '/claims?pageSize=100')).data as { items: { id: string }[] };
  let id = '';
  for (const it of list.items) {
    const d = (await api(page, 'GET', `/claims/${it.id}`)).data as { attachments: unknown[]; receiptFiscal?: unknown };
    if (d.attachments.length > 0 && d.receiptFiscal) {
      id = it.id;
      break;
    }
  }
  expect(id).not.toBe('');
  await page.goto(`/staff/claims/${id}`);
  const column = page.getByTestId('claim-data-column');
  const scroller = page.getByTestId('claim-data-column-scroll');
  await expect(column.getByRole('heading', { name: 'Данные', exact: true })).toBeVisible();
  const heads = column.locator('[data-section-head]');
  expect(await heads.count()).toBeGreaterThanOrEqual(2);
  expect(await scroller.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
  const top = (await box(scroller)).y;
  const first = heads.first();
  const last = heads.last();

  // A little: the first heading is pinned at the top of the column.
  await scrollTo(scroller, 40);
  expect(Math.abs((await box(first)).y - top)).toBeLessThanOrEqual(1);
  await expect(first).toHaveAttribute('data-stuck', '');
  await expect(last).not.toHaveAttribute('data-stuck', '');

  // To the end: the last heading took the place, the first one was pushed up out of the column.
  await scrollTo(scroller, 'end');
  const f = await box(first);
  expect(f.y + f.height).toBeLessThanOrEqual(top + 1);
  // The column is beside the content area: the main area has not moved.
  expect(await scrollTop(area(page))).toBe(0);
  expect(await column.evaluate((el) => el.closest('[data-content-scroll]') === null)).toBe(true);
});

test('narrow screen: the dashboard blocks go under the queue and scroll with the page', async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 700 });
  await loginStaff(page, 'underwriter');
  await page.goto('/staff');
  const side = page.getByTestId('dashboard-side');
  await expect(side).toHaveAttribute('data-mode', 'inline');
  expect(await side.evaluate((el) => el.closest('[data-content-scroll]') !== null)).toBe(true);
  const queue = area(page).getByRole('heading', { name: 'Очередь' }).locator('xpath=ancestor::section[1]');
  await expect(queue.locator('tbody tr').first()).toBeVisible();
  const q = await box(queue);
  const s = await box(side);
  expect(s.y).toBeGreaterThanOrEqual(q.y + q.height);
  const attention = page.getByTestId('dashboard-attention');
  await attention.scrollIntoViewIfNeeded();
  await settle(page);
  expect(await scrollTop(area(page))).toBeGreaterThan(0);
  await expect(attention).toBeInViewport();
});
