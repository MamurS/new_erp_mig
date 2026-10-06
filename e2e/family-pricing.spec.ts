/*
 * Premium of a family member included during the term follows the contract terms (pricingBasis). On the demo
 * company's flat_by_type contract a child costs premium_family × remaining days / term days, and the endorsement
 * line says «по типу: premium_family …».
 */
import { expect, test, type Page } from '@playwright/test';
import { api, loginStaff } from './helpers';

/** Switches the role in the same tab (the same in-page mock DB) through the demo banner. */
async function switchTo(page: Page, label: string, home: RegExp): Promise<void> {
  await page.getByRole('button', { name: 'Войти как…' }).click();
  await page.getByRole('menuitem', { name: new RegExp(`^${label} — [a-z0-9.+-]+@`) }).click();
  await expect(page.getByText(`Вы вошли как «${label}»`).last()).toBeVisible();
  await expect(page).toHaveURL(home);
}

const DAY = 86_400_000;
const days = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / DAY) + 1;
const group = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

test('flat_by_type: a child included mid-term costs premium_family × remaining days / term days', async ({ page }) => {
  test.setTimeout(120_000);
  await loginStaff(page, 'hr');
  // HR adds a child of the demo employee through the API of the HR cabinet.
  const employees = (await api(page, 'GET', '/hr/employees')).data as { id: string; fullName: string }[];
  const employee = employees.find((e) => e.fullName.startsWith('Karimov Aziz'))!;
  expect(employee).toBeTruthy();
  const startDate = new Date(Date.now() + 2 * DAY).toISOString().slice(0, 10);
  const added = await api(page, 'POST', '/hr/family', { employeeId: employee.id, fullName: 'Karimova Shahlo Azizovna', birthDate: '2019-04-20', pinfl: '62004190000123', relation: 'child', startDate });
  expect(added.status).toBe(200);
  const change = added.data as { id: string };

  // The underwriter approves the change request with the existing flow.
  await switchTo(page, 'Андеррайтер', /\/staff$/);
  expect((await api(page, 'POST', '/policy-changes/decision', { ids: [change.id], decision: 'approve' })).status).toBe(200);

  // The manager forms the endorsement of the month.
  await switchTo(page, 'Менеджер по продажам', /\/staff$/);
  await page.goto('/staff/endorsements');
  await page.getByTestId('pending-requests').getByRole('button', { name: 'Сформировать ДС' }).first().click();
  await expect(page).toHaveURL(/\/staff\/endorsements\/[0-9a-f-]{36}$/);
  const id = page.url().split('/').pop()!;
  const e = (await api(page, 'GET', `/endorsements/${id}`)).data as { contractId: string; lines: { description: string; days: number; amount: number }[] };
  const contract = (await api(page, 'GET', `/contracts/${e.contractId}`)).data as { params: { startDate: string; endDate: string; premiumFamily: number; pricingBasis: string } };
  expect(contract.params.pricingBasis).toBe('flat_by_type');

  // Expected from the contract data: premium_family × remaining days / term days.
  const remaining = days(startDate, contract.params.endDate);
  const term = days(contract.params.startDate, contract.params.endDate);
  const expected = Math.round((contract.params.premiumFamily * remaining) / term);
  const line = e.lines.find((l) => l.description.includes('Karimova S.'))!;
  expect(line).toBeTruthy();
  expect(line.days).toBe(remaining);
  expect(line.amount).toBe(expected);
  await expect(page.getByTestId('endorsement-lines')).toContainText(`по типу: premium_family ${group(contract.params.premiumFamily)} × ${remaining} / ${term} = ${group(expected)}`);
});
