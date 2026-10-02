/* «Параметры ДМС»: an admin proposes, an underwriter confirms (four-eyes), everyone reads, the audit keeps old and new value. */
import { expect, test, type Page } from '@playwright/test';
import { failOnDialog, loginStaff } from './helpers';

async function switchTo(page: Page, item: RegExp, label: string): Promise<void> {
  await page.getByRole('button', { name: 'Войти как…' }).click();
  await page.getByRole('menuitem', { name: item }).click();
  await expect(page.getByText(`Вы вошли как «${label}»`).last()).toBeVisible();
  await expect(page).toHaveURL(/\/staff$/);
}

async function openParameters(page: Page): Promise<void> {
  await page.getByRole('link', { name: 'Параметры ДМС' }).click();
  await expect(page.getByRole('heading', { name: 'Параметры ДМС', level: 1 })).toBeVisible();
}

test('parameters: admin proposes, underwriter confirms, operator only reads, audit shows old and new value', async ({ page }) => {
  failOnDialog(page);
  await loginStaff(page, 'admin');
  await openParameters(page);
  const row = page.getByTestId('param-qaSampleShare');
  await expect(row.getByTestId('param-value')).toHaveText('5%');
  await expect(row.getByText('демо-значение')).toBeVisible();

  await page.getByRole('button', { name: 'Изменить: Доля контрольной выборки' }).click();
  const dialog = page.getByRole('dialog', { name: 'Изменить параметр' });
  await dialog.getByLabel('Новое значение, %').fill('80');
  await dialog.getByLabel('Основание').fill('Решение правления № 12');
  await dialog.getByRole('button', { name: 'Отправить на подтверждение' }).click();
  await expect(dialog.getByText(/Допустимо от 1% до 50%/)).toBeVisible();
  await dialog.getByLabel('Новое значение, %').fill('8');
  await dialog.getByRole('button', { name: 'Отправить на подтверждение' }).click();
  await expect(page.getByText('Изменение отправлено на подтверждение').last()).toBeVisible();

  // Not applied yet; the author cannot confirm their own change.
  const pending = page.getByTestId('pending-params');
  await expect(pending).toContainText('Доля контрольной выборки: 5% → 8%');
  await expect(pending.getByText('Нужен второй сотрудник')).toBeVisible();
  await expect(pending.getByRole('button', { name: /^Подтвердить/ })).toHaveCount(0);
  await expect(row.getByTestId('param-value')).toHaveText('5%');
  await expect(row.getByText('на подтверждении')).toBeVisible();

  await switchTo(page, /^Андеррайтер/, 'Андеррайтер');
  await openParameters(page);
  await expect(page.getByRole('button', { name: /^Изменить:/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Подтвердить: Доля контрольной выборки' }).click();
  await expect(page.getByText('Изменение применено').last()).toBeVisible();
  const applied = page.getByTestId('param-qaSampleShare');
  await expect(applied.getByTestId('param-value')).toHaveText('8%');
  await expect(applied.getByText('демо-значение')).toHaveCount(0);
  await expect(page.getByTestId('params-history')).toContainText('Применено');

  // Read-only for other MIG roles.
  await switchTo(page, /^Куратор ДМС/, 'Куратор ДМС');
  await openParameters(page);
  await expect(page.getByTestId('param-qaSampleShare').getByTestId('param-value')).toHaveText('8%');
  await expect(page.getByRole('button', { name: /^Изменить:/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Подтвердить/ })).toHaveCount(0);

  await page.getByRole('button', { name: 'Войти как…' }).click();
  await page.getByRole('menuitem', { name: /^Администратор(?! клиники| ассистанса)/ }).click();
  await expect(page.getByText('Вы вошли как «Администратор»').last()).toBeVisible();
  await page.getByRole('link', { name: 'Журнал аудита' }).click();
  const entry = page.getByRole('row', { name: /Параметр ДМС изменён/ }).first();
  await expect(entry).toContainText('Доля контрольной выборки: 5% → 8%');
  await expect(entry).toContainText('Андеррайтер');
});
