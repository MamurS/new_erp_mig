/* The staff dashboard by role: every role sees its own queue and its own KPIs; nobody sees work it has no rights for. */
import { expect, test } from '@playwright/test';
import type { StaffRole } from '../src/shared/types';
import { api, loginStaff } from './helpers';

const ROLE_VIEW: Record<StaffRole, { kpi: string; tabs: string[] }> = {
  operator: { kpi: 'Ассистансы с нарушением SLA', tabs: ['SLA ассистансов', 'Жалобы', 'Записи'] },
  underwriter: { kpi: 'Котировки на моё согласование', tabs: ['Котировки', 'Продления', 'Доп. соглашения', 'Лимиты', 'Убыточность'] },
  sales_manager: { kpi: 'Лиды без активности', tabs: ['Лиды', 'КП', 'Договоры'] },
  claims_officer: { kpi: 'Новые убытки', tabs: ['Убытки', 'Апелляции', 'Флаги'] },
  doctor_expert: { kpi: 'Запрошенные заключения', tabs: ['Эскалации ГП', 'Заключения', 'Выборка'] },
  accountant: { kpi: 'Ручная разноска', tabs: ['Разноска', 'Выплаты', 'Счета ассистансов'] },
  legal: { kpi: 'Договоры на согласовании', tabs: ['Договоры', 'Доп. соглашения', 'Сканы'] },
  admin: { kpi: 'Параметры на подтверждение', tabs: ['Параметры', 'Полномочия', 'Интеграции'] },
};

for (const [role, view] of Object.entries(ROLE_VIEW) as [StaffRole, (typeof ROLE_VIEW)[StaffRole]][]) {
  test(`${role}: own queue and own KPIs on the dashboard`, async ({ page }) => {
    await loginStaff(page, role);
    const main = page.getByRole('main');
    await expect(main.getByRole('link', { name: new RegExp(`^${view.kpi}`) })).toBeVisible();
    const tabs = page.getByTestId('queue-tabs');
    for (const t of view.tabs) await expect(tabs.getByRole('tab', { name: new RegExp(`^${t}\\s*\\d+$`) })).toBeVisible();
    await expect(page.getByRole('table', { name: 'Очередь задач' }).locator('tbody tr[data-row]').first()).toBeVisible();
  });
}

test('underwriter: more than one kind of work, no claims anywhere in the queue', async ({ page }) => {
  await loginStaff(page, 'underwriter');
  const tabs = page.getByTestId('queue-tabs').getByRole('tab');
  await expect(tabs.nth(2)).toBeVisible();
  expect(await tabs.count()).toBeGreaterThan(3);
  await expect(page.getByTestId('queue-tabs').getByRole('tab', { name: /^Убытки/ })).toHaveCount(0);
  const table = page.getByRole('table', { name: 'Очередь задач' });
  await expect(table.locator('tbody tr[data-row]').first()).toBeVisible();
  if (await page.getByRole('button', { name: /^Показать все/ }).isVisible()) await page.getByRole('button', { name: /^Показать все/ }).click();
  await expect(table.getByText('Убыток', { exact: true })).toHaveCount(0);
  const kinds = new Set(await table.locator('tbody tr[data-row] td:first-child').allInnerTexts());
  expect(kinds.size).toBeGreaterThan(1);
  // The server refuses to hand claims to the underwriter even when asked directly.
  const claims = (await api(page, 'GET', '/queue?type=claim')).data as unknown[];
  expect(claims).toHaveLength(0);
  // A tab shows only its own kind.
  await page.getByTestId('queue-tabs').getByRole('tab', { name: /^Убыточность/ }).click();
  await expect(table.locator('tbody tr[data-row]').first()).toContainText('Убыточность');
  expect(new Set(await table.locator('tbody tr[data-row] td:first-child').allInnerTexts())).toEqual(new Set(['Убыточность']));
});
