/*
 * Requests between people, the full cycle (DECISIONS «Запросы между сотрудниками: полный цикл»), in one tab
 * through «Войти как…» (the mock database lives in the page):
 * - the underwriter asks the manager from the empty «Застрахованные» of a lead → the manager has it in the
 *   bell and in the dashboard queue → the underwriter has it in «Мои запросы», the plaque replaces the button,
 *   the same request cannot be sent twice; the manager uploads the assessment data → it closes by itself →
 *   the underwriter is notified «выполнил(а)»;
 * - «Отклонить» with a comment is seen by the author;
 * - past the deadline it is red for both, «Напомнить» notifies the manager again.
 */
import { expect, fastForward, test, type Page } from './test';
import { api, loginStaff } from './helpers';

interface Deal {
  id: string;
  number: string;
  stage: string;
  clientId: string;
  clientName: string;
}

const CENSUS = ['gender,birthYear,relation', ...Array.from({ length: 12 }, (_, k) => `${k % 2 ? 'f' : 'm'},${1975 + k * 2},employee`)].join('\n');

/** Switches the role in the same tab through the demo banner. */
async function switchTo(page: Page, label: string): Promise<void> {
  await page.getByRole('button', { name: 'Войти как…' }).click();
  await page.getByRole('menuitem', { name: new RegExp(`^${label} — [a-z0-9.+-]+@`) }).click();
  await expect(page.getByText(`Вы вошли как «${label}»`).last()).toBeVisible();
  await expect(page).toHaveURL(/\/staff$/);
}

/** A seeded lead whose client has no HR cabinet yet. */
async function lead(page: Page): Promise<Deal> {
  const deals = (await api(page, 'GET', '/deals')).data as Deal[];
  for (const d of deals.filter((x) => x.stage === 'lead')) {
    const card = (await api(page, 'GET', `/deals/${d.id}`)).data as { hasHr: boolean };
    if (!card.hasHr) return d;
  }
  throw new Error('no seeded lead without HR');
}

/** The underwriter asks the manager from the empty «Застрахованные» tab of the lead. */
async function askManager(page: Page, deal: Deal, comment: string): Promise<void> {
  await page.goto(`/staff/clients/${deal.clientId}`);
  await page.getByRole('tab', { name: 'Застрахованные' }).click();
  const empty = page.getByTestId('insured-next');
  await empty.getByRole('button', { name: 'Попросить менеджера' }).click();
  const dialog = page.getByRole('dialog', { name: 'Попросить менеджера' });
  await dialog.getByLabel('Комментарий').fill(comment);
  await dialog.getByRole('button', { name: 'Отправить запрос' }).click();
  await expect(page.getByText('Запрос отправлен').first()).toBeVisible();
}

async function openMyRequests(page: Page) {
  await page.goto('/staff');
  await page.getByTestId('queue-tabs').getByRole('tab', { name: /Мои запросы/ }).click();
  return page.getByTestId('my-requests');
}

async function bell(page: Page) {
  await page.getByTestId('notifications').click();
  return page.getByTestId('notification');
}

test('the request from the empty «Застрахованные» reaches the manager’s bell and queue, the author’s «Мои запросы» and plaque; it closes itself on the upload', async ({ page }) => {
  test.setTimeout(150_000);
  await loginStaff(page, 'underwriter');
  const deal = await lead(page);
  await askManager(page, deal, 'Нужно к пятнице');

  // The plaque replaces the button; the same request cannot be sent again.
  const plaque = page.getByTestId('insured-next').getByTestId('request-plaque');
  await expect(plaque).toContainText('Запрос «Загрузить данные для оценки» отправлен');
  await expect(plaque).toContainText('Karimov Aziz Shuhratovich, ожидает');
  await expect(page.getByTestId('insured-next').getByRole('button', { name: 'Попросить менеджера' })).toHaveCount(0);
  const again = await api(page, 'POST', '/tasks', { toRole: 'sales_manager', action: 'census_upload', subjectType: 'deal', subjectId: deal.id });
  expect(again.status).toBe(409);
  // «Активность» of the deal.
  await page.goto(`/staff/deals/${deal.id}`);
  await expect(page.getByTestId('deal-events')).toContainText('Запрос «Загрузить данные для оценки» отправлен: Karimov Aziz Shuhratovich');

  const mine = await openMyRequests(page);
  const row = mine.locator('tbody tr').filter({ hasText: deal.clientName });
  await expect(row).toContainText('Загрузить данные для оценки');
  await expect(row).toContainText('Karimov Aziz Shuhratovich');
  await expect(row.getByTestId('my-request-status')).toHaveAttribute('data-status', 'open');

  // The manager: the bell and the queue of the dashboard.
  await switchTo(page, 'Менеджер по продажам');
  await expect(page.getByTestId('notifications-count')).toHaveText('1');
  const notes = await bell(page);
  await expect(notes.first()).toContainText(`Sokolov`);
  await expect(notes.first()).toContainText(`просит: Загрузить данные для оценки — ${deal.number}`);
  await page.keyboard.press('Escape');
  await page.getByTestId('queue-tabs').getByRole('tab', { name: /Задачи от коллег/ }).click();
  const queueRow = page.locator('tbody tr').filter({ hasText: deal.clientName });
  await expect(queueRow).toContainText('Загрузить данные для оценки');
  await queueRow.getByTestId('request-take').click();
  await expect(page.getByText('Запрос взят в работу').first()).toBeVisible();
  await expect(queueRow).toContainText('В работе');
  await expect(queueRow.getByTestId('request-done')).toBeVisible();

  // The action itself closes the request.
  await page.goto(`/staff/deals/${deal.id}/census`);
  await page.getByLabel('Файл с данными для оценки').setInputFiles({ name: 'census.csv', mimeType: 'text/csv', buffer: Buffer.from(CENSUS, 'utf8') });
  await expect(page.getByTestId('census-stats')).toBeVisible();

  await switchTo(page, 'Андеррайтер');
  const uwNotes = await bell(page);
  await expect(uwNotes.first()).toContainText(`Karimov Aziz Shuhratovich выполнил(а) ваш запрос: Загрузить данные для оценки — ${deal.number}`);
  await expect(page.getByText(/взял\(а\) в работу ваш запрос/)).toBeVisible();
  // «Отметить всё прочитанным» clears the counter.
  await page.getByTestId('notifications-read-all').click();
  await expect(page.getByTestId('notifications-count')).toHaveCount(0);
  const done = (await openMyRequests(page)).locator('tbody tr').filter({ hasText: deal.clientName });
  await expect(done.getByTestId('my-request-status')).toHaveAttribute('data-status', 'done');
  await expect(done).toContainText('выполнено');
});

test('«Отклонить» with a comment: the author sees why in the bell and in «Мои запросы»', async ({ page }) => {
  test.setTimeout(120_000);
  await loginStaff(page, 'underwriter');
  const deal = await lead(page);
  await askManager(page, deal, 'Нужно к пятнице');

  await switchTo(page, 'Менеджер по продажам');
  await page.getByTestId('queue-tabs').getByRole('tab', { name: /Задачи от коллег/ }).click();
  const queueRow = page.locator('tbody tr').filter({ hasText: deal.clientName });
  await queueRow.getByTestId('request-reject').click();
  const dialog = page.getByRole('dialog', { name: 'Отклонить запрос' });
  await dialog.getByRole('button', { name: 'Отклонить' }).click();
  await expect(dialog.getByText('Укажите причину')).toBeVisible();
  await dialog.getByLabel('Почему отклоняете').fill('Клиент пришлёт данные в понедельник');
  await dialog.getByRole('button', { name: 'Отклонить' }).click();
  await expect(page.getByText('Запрос отклонён').first()).toBeVisible();
  await expect(queueRow).toHaveCount(0);

  await switchTo(page, 'Андеррайтер');
  const notes = await bell(page);
  await expect(notes.first()).toContainText('отклонил(а) ваш запрос');
  await expect(notes.first()).toContainText('Клиент пришлёт данные в понедельник');
  await page.keyboard.press('Escape');
  const row = (await openMyRequests(page)).locator('tbody tr').filter({ hasText: deal.clientName });
  await expect(row.getByTestId('my-request-status')).toHaveAttribute('data-status', 'rejected');
  await expect(row).toContainText('Клиент пришлёт данные в понедельник');
});

test('past the deadline the request is red for both; «Напомнить» sends the manager a new notification', async ({ page }) => {
  test.setTimeout(150_000);
  await page.clock.install();
  await loginStaff(page, 'underwriter');
  const deal = await lead(page);
  await askManager(page, deal, 'Нужно к пятнице');
  const plaque = page.getByTestId('insured-next').getByTestId('request-plaque');
  await expect(plaque.getByTestId('request-remind')).toHaveCount(0);

  // Four days later («Срок ответа на запрос» — 2 working days): the session has expired, sign in again.
  await fastForward(page, 96 * 3_600_000);
  await page.evaluate(() => sessionStorage.removeItem('mig.session'));
  await loginStaff(page, 'underwriter');
  const row = (await openMyRequests(page)).locator('tbody tr').filter({ hasText: deal.clientName });
  await expect(row.getByTestId('my-request-status')).toHaveAttribute('data-overdue', 'true');
  await expect(row).toContainText('просрочен');
  await expect(page.getByTestId('notifications-count')).toBeVisible();
  const notes = await bell(page);
  await expect(notes.filter({ hasText: 'Просрочен запрос: Загрузить данные для оценки' })).toHaveCount(1);
  await page.keyboard.press('Escape');

  await page.goto(`/staff/clients/${deal.clientId}`);
  await page.getByRole('tab', { name: 'Застрахованные' }).click();
  await expect(plaque).toHaveAttribute('data-overdue', 'true');
  await plaque.getByTestId('request-remind').click();
  await expect(page.getByText('Напоминание отправлено').first()).toBeVisible();
  await expect(plaque).toContainText('напомнили');

  await switchTo(page, 'Менеджер по продажам');
  const salesNotes = await bell(page);
  await expect(salesNotes.filter({ hasText: 'напоминает о запросе: Загрузить данные для оценки' })).toHaveCount(1);
  await expect(salesNotes.filter({ hasText: 'Просрочен запрос' })).toHaveCount(1);
  await page.keyboard.press('Escape');
  await page.getByTestId('queue-tabs').getByRole('tab', { name: /Задачи от коллег/ }).click();
  await expect(page.locator('tbody tr').filter({ hasText: deal.clientName })).toContainText('Просрочен');
});
