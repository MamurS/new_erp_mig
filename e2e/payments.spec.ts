/* Payment matching: the 1C statement by invoice number, then INN and exact amount; «Ручная разноска» for the rest. */
import { expect, test } from '@playwright/test';
import { api, loginStaff } from './helpers';

const today = () => new Date(Date.now() + 5 * 3600_000).toISOString().slice(0, 10);

test('1. A payment by a third party waits in «Ручная разноска» and is allocated only with a comment', async ({ page }) => {
  await loginStaff(page, 'accountant');
  await page.getByRole('link', { name: 'Ручная разноска' }).first().click();
  await expect(page).toHaveURL(/\/staff\/invoices\/queue$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Ручная разноска' })).toBeVisible();
  const row = page.getByRole('row').filter({ hasText: 'ООО «Демо Холдинг Групп»' });
  await expect(row).toContainText('Счёт указан, но плательщик — другой ИНН');
  await row.getByRole('button', { name: 'Разнести' }).click();

  const dialog = page.getByRole('dialog', { name: 'Разнести платёж' });
  const candidate = dialog.getByTestId('allocation-row');
  await expect(candidate).toHaveCount(1);
  await expect(candidate).toContainText('совпадение: номер в назначении');
  await expect(candidate).toContainText('другой ИНН');
  await expect(candidate.getByRole('checkbox')).toBeChecked();
  await dialog.getByRole('button', { name: /^Разнести/ }).click();
  await expect(dialog.getByText('Плательщик — другой ИНН: укажите комментарий (минимум 5 символов)')).toBeVisible();
  await dialog.getByLabel(/Комментарий/).fill('Оплата холдингом за дочернюю компанию по письму');
  await dialog.getByRole('button', { name: /^Разнести/ }).click();
  await expect(page.getByText('Платёж разнесён')).toBeVisible();
  await expect(row).toHaveCount(0);

  await page.getByLabel('Статус').selectOption('allocated');
  const done = page.getByRole('row').filter({ hasText: 'ООО «Демо Холдинг Групп»' });
  await expect(done).toContainText('«Оплата холдингом за дочернюю компанию по письму»');
});

test('2. The statement: the invoice number matches automatically, a partial payment without it goes to the queue and is split by the accountant', async ({ page }) => {
  await loginStaff(page, 'accountant');
  const invoices = (await api(page, 'GET', '/invoices?status=unpaid,overdue')).data as { id: string; number: string; amount: number; paid?: number; clientInn?: string; contractId?: string }[];
  const inv = invoices.find((i) => i.contractId && i.clientInn && i.amount - (i.paid ?? 0) > 2_000)!;
  expect(inv, 'an unpaid contract invoice').toBeTruthy();
  const rest = inv.amount - (inv.paid ?? 0);
  const csv = [
    'date,amount,inn,purpose,payer',
    `${today()},1000,${inv.clientInn},"Частичная оплата по счёту ${inv.number}",`,
    `${today()},${rest - 1000 - 1},${inv.clientInn},"Оплата ДМС",`,
  ].join('\n');
  await page.goto('/staff/invoices');
  await page.getByLabel('Файл выписки из 1С').setInputFiles({ name: 'statement.csv', mimeType: 'text/csv', buffer: Buffer.from(csv, 'utf8') });
  await expect(page.getByTestId('import-result')).toContainText('Сопоставлено: 1 · в ручную разноску: 1');
  await page.getByRole('link', { name: 'Перейти к ручной разноске' }).click();

  const row = page.getByRole('row').filter({ hasText: 'Оплата ДМС' });
  await expect(row).toContainText('Сумма не совпадает ни с одним счётом плательщика');
  await row.getByRole('button', { name: 'Разнести' }).click();
  const dialog = page.getByRole('dialog', { name: 'Разнести платёж' });
  const line = dialog.getByTestId('allocation-row').filter({ hasText: inv.number });
  await line.getByRole('checkbox').check();
  await expect(line.getByRole('textbox')).toHaveValue(String(rest - 1000 - 1));
  await dialog.getByRole('button', { name: /^Разнести/ }).click();
  await expect(page.getByText('Платёж разнесён')).toBeVisible();
  const after = (await api(page, 'GET', '/invoices?status=unpaid,overdue')).data as { id: string; paid?: number; amount: number }[];
  expect(after.find((i) => i.id === inv.id)?.paid).toBe(inv.amount - 1);
});
