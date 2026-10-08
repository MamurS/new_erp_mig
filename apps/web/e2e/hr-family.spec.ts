/*
 * Family members in the HR cabinet (FAMILY_SPEC «Кто добавляет членов семьи»): HR adds a child → MIG approves →
 * endorsement line → the child is in the parent's app; app requests approved/rejected by HR; HR sees the family
 * without medical data; the age-limit task of the manager queue opens the insured card.
 */
import { expect, test, type Page } from '@playwright/test';
import { api, loginStaff } from './helpers';

/** Switches the account in the same tab (the same in-page mock DB) through the demo banner. */
async function switchTo(page: Page, item: RegExp, home: RegExp): Promise<void> {
  await page.getByRole('button', { name: 'Войти как…' }).click();
  await page.getByRole('menuitem', { name: item }).click();
  await expect(page).toHaveURL(home);
}
const asUnderwriter = (page: Page) => switchTo(page, /^Андеррайтер — /, /\/staff$/);
const asSales = (page: Page) => switchTo(page, /^Менеджер по продажам — /, /\/staff$/);
const asHr = (page: Page) => switchTo(page, /^HR клиента — /, /\/hr$/);
/** Pages (fresh mock DBs) where the demo employee already accepted the consent. */
const consented = new WeakSet<Page>();
/** The demo employee Karimov Aziz Bahromovich; the first sign-in of a fresh DB lands on the consent screen. */
async function asInsured(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Войти как…' }).click();
  await page.getByRole('menuitem', { name: /^Застрахованный — \+998 90 000 00 01/ }).click();
  if (!consented.has(page)) {
    await expect(page).toHaveURL(/\/app\/consent/);
    await page.getByRole('checkbox', { name: /согласен/ }).click();
    await page.getByRole('button', { name: 'Продолжить' }).click();
    consented.add(page);
  }
  await expect(page).toHaveURL(/\/app$/);
}

const EMPLOYEE = 'Karimov Aziz Bahromovich';

interface FamilyProfile {
  id: string;
  fullName: string;
  relation: string;
  certificateNumber?: string;
}

test('a. HR adds a child → the underwriter approves → endorsement line → the child is in the parent’s app', async ({ page }) => {
  const child = 'Karimova Lola Azizovna';
  await loginStaff(page, 'hr');
  await page.goto('/hr/family/new');
  await page.getByRole('textbox', { name: 'Сотрудник', exact: true }).fill('Karimov Aziz');
  await page.getByRole('listbox', { name: 'Сотрудники' }).getByRole('option', { name: new RegExp(`^${EMPLOYEE}`) }).click();
  await expect(page.getByTestId('picked-employee')).toContainText(EMPLOYEE);
  await page.getByLabel('Кем приходится сотруднику').selectOption({ label: 'Ребёнок' });
  await page.getByLabel('ФИО латиницей').fill(child);
  await page.getByLabel('Дата рождения').fill('15032021');
  await page.getByLabel('ПИНФЛ').fill('41503219876501');
  await page.getByRole('button', { name: 'Отправить заявку' }).click();
  await expect(page.getByText('Заявка отправлена в МИГ — член семьи появится в полисе после подтверждения')).toBeVisible();
  await expect(page).toHaveURL(/\/hr\/family$/);
  const pendingRow = page.getByRole('row').filter({ hasText: child });
  await expect(pendingRow).toContainText('Ждёт подтверждения МИГ');
  await expect(pendingRow).toContainText(EMPLOYEE);

  // MIG's underwriter approves the change request, as for an employee.
  await asUnderwriter(page);
  await page.goto('/staff/policy-changes');
  await page.getByRole('button', { name: `Действия: ${child}` }).click();
  await page.getByRole('menuitem', { name: 'Подтвердить' }).click();
  await expect(page.getByText(/Подтверждено заявок: 1/)).toBeVisible();

  // The contract's change request becomes a line of an endorsement (the amount is PRICING's own e2e).
  await asSales(page);
  const requests = (await api(page, 'GET', '/change-requests')).data as { id: string; contractId: string; status: string; description?: string; insuredId?: string }[];
  const cr = requests.find((r) => r.status === 'pending' && (r.description ?? '').includes('Karimova L.'));
  expect(cr, 'change request of the child').toBeTruthy();
  const created = await api(page, 'POST', '/endorsements', { contractId: cr!.contractId, changeRequestIds: [cr!.id] });
  expect(created.status).toBe(201);
  const [endorsement] = created.data as { id: string; changeRequestIds: string[]; lines: { description: string }[] }[];
  expect(endorsement!.changeRequestIds).toContain(cr!.id);
  expect(endorsement!.lines.some((l) => l.description.includes('Karimova L.'))).toBe(true);

  // The parent sees the child in the family, with an own certificate, and in the profile switcher.
  await asInsured(page);
  const family = (await api(page, 'GET', '/me/family')).data as FamilyProfile[];
  const lola = family.find((p) => p.fullName === child);
  expect(lola?.relation).toBe('child');
  expect(lola?.certificateNumber).toMatch(/^[A-Z0-9-]+$/);
  await expect(page.getByRole('radiogroup', { name: 'Профиль' }).getByRole('radio', { name: /Lola/ })).toBeVisible();
});

test('b. app requests: HR approves one into a change request and rejects another with a reason', async ({ page }) => {
  await loginStaff(page, 'hr');
  await asInsured(page);
  const ask = (fullName: string, pinfl: string) =>
    api(page, 'POST', '/me/family/requests', { fullName, birthDate: '2023-05-10', pinfl, relation: 'child', consent: true });
  expect((await ask('Karimov Olim Azizovich', '41005239876501')).status).toBe(200);
  expect((await ask('Karimova Zarina Azizovna', '41005239876502')).status).toBe(200);

  await asHr(page);
  const navLink = page.getByTestId('sidebar').getByRole('link', { name: /^Заявки из приложения/ });
  await expect(navLink.getByTestId('nav-count')).toHaveText('2');
  await navLink.click();
  await expect(page).toHaveURL(/\/hr\/family\/requests$/);
  const list = page.getByTestId('family-requests');
  await expect(list).toContainText('Karimov Olim Azizovich');
  await expect(list).toContainText(`Просит ${EMPLOYEE}`);

  await page.getByRole('button', { name: 'Одобрить: Karimov Olim Azizovich' }).click();
  await page.getByRole('alertdialog').or(page.getByRole('dialog')).getByRole('button', { name: 'Одобрить', exact: true }).click();
  await expect(page.getByText('Заявка одобрена и отправлена в МИГ')).toBeVisible();

  await page.getByRole('button', { name: 'Отклонить: Karimova Zarina Azizovna' }).click();
  const dialog = page.getByRole('alertdialog').or(page.getByRole('dialog'));
  await dialog.getByRole('button', { name: 'Отклонить', exact: true }).click();
  await expect(dialog.getByText('Причина — не короче 5 символов').or(dialog.getByRole('alert'))).toBeVisible();
  await dialog.getByLabel('Причина').fill('Нет свидетельства о рождении');
  await dialog.getByRole('button', { name: 'Отклонить', exact: true }).click();
  await expect(page.getByText('Заявка отклонена — сотрудник увидит причину в приложении')).toBeVisible();
  await expect(navLink.getByTestId('nav-count')).toHaveCount(0);

  await page.getByRole('button', { name: /^Отклонены/ }).click();
  await expect(page.getByTestId('family-request-reason')).toContainText('Нет свидетельства о рождении');
  await page.getByRole('button', { name: /^Одобрены/ }).click();
  await expect(list).toContainText('Karimov Olim Azizovich');

  // The approved request is a change request for MIG: pending on «Семья».
  const decided = (await api(page, 'GET', '/hr/family-requests')).data as { fullName: string; status: string; policyChangeId?: string }[];
  expect(decided.find((r) => r.fullName === 'Karimov Olim Azizovich')).toMatchObject({ status: 'approved', policyChangeId: expect.any(String) });
  await page.goto('/hr/family');
  await expect(page.getByRole('row').filter({ hasText: 'Karimov Olim Azizovich' })).toContainText('Ждёт подтверждения МИГ');
  await expect(page.getByRole('row').filter({ hasText: 'Karimova Zarina Azizovna' })).toHaveCount(0);

  // The employee sees the reason in the app's list of own requests.
  await asInsured(page);
  const own = (await api(page, 'GET', '/me/family/requests')).data as { fullName: string; status: string; rejectionReason?: string }[];
  expect(own.find((r) => r.fullName === 'Karimova Zarina Azizovna')).toMatchObject({ status: 'rejected', rejectionReason: 'Нет свидетельства о рождении' });
});

test('c. HR sees the family as a list of people, with filters, without medical data', async ({ page }) => {
  await loginStaff(page, 'hr');
  await page.getByTestId('sidebar').getByRole('link', { name: /^Семья/ }).click();
  await expect(page).toHaveURL(/\/hr\/family$/);
  const table = page.getByRole('table', { name: 'Члены семьи сотрудников' });
  for (const name of ['Karimova Dilnoza Rustamovna', 'Karimov Temur Azizovich', 'Karimova Madina Azizovna']) {
    await expect(table.getByRole('row').filter({ hasText: name })).toContainText(EMPLOYEE);
  }
  await expect(table.getByRole('row').filter({ hasText: 'Karimov Temur Azizovich' })).toContainText('Ребёнок');
  await expect(table.getByRole('row').filter({ hasText: 'Karimov Temur Azizovich' })).toContainText(/••\.••\.\d{4}/);

  // Filters: relation, employee, search.
  await page.getByRole('button', { name: 'Супруг(а)', exact: true }).click();
  await expect(table.getByRole('row').filter({ hasText: 'Karimova Dilnoza Rustamovna' })).toBeVisible();
  await expect(table.getByRole('row').filter({ hasText: 'Karimov Temur Azizovich' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Все', exact: true }).click();
  await page.getByRole('combobox', { name: 'Сотрудник', exact: true }).selectOption({ label: EMPLOYEE });
  await page.getByPlaceholder('Имя, сотрудник или номер сертификата').fill('madina');
  await expect(table.locator('tbody tr')).toHaveCount(1);
  await expect(table).toContainText('Karimova Madina Azizovna');
  await page.getByPlaceholder('Имя, сотрудник или номер сертификата').fill('');

  // No medical data on the screen nor in the API answer: no claims, receipts, appointments, diagnoses.
  const text = await page.getByRole('main').innerText();
  for (const medical of ['Педиатр', 'Лекарства', '186 000', '420 000', 'Диагноз', 'Возмещение']) expect(text).not.toContain(medical);
  const rows = (await api(page, 'GET', '/hr/family')).data as Record<string, unknown>[];
  for (const r of rows) for (const key of Object.keys(r)) expect(['claims', 'appointments', 'diagnosis', 'limits', 'pinfl', 'phone']).not.toContain(key);

  // The employee's family on «Сотрудники»: a list of people.
  await page.goto(`/hr?q=${encodeURIComponent('Karimov Aziz')}`);
  await page.getByRole('row').filter({ hasText: EMPLOYEE }).getByRole('button', { name: 'Действия с сотрудником' }).click();
  await page.getByRole('menuitem', { name: 'Семья' }).click();
  const dialog = page.getByRole('dialog', { name: `Семья: ${EMPLOYEE}` });
  await expect(dialog.getByTestId('employee-family').getByRole('listitem')).toHaveCount(3);
  await dialog.getByRole('link', { name: 'Добавить члена семьи' }).click();
  await expect(page).toHaveURL(/\/hr\/family\/new\?employeeId=[0-9a-f-]{36}$/);
  await expect(page.getByTestId('picked-employee')).toContainText(EMPLOYEE);
});

test('d. the age-limit task of the manager queue opens the insured card with an explanation', async ({ page }) => {
  await loginStaff(page, 'underwriter');
  await page.getByTestId('queue-tabs').getByRole('tab', { name: /^Возраст детей/ }).click();
  const table = page.getByRole('table', { name: 'Очередь задач' });
  const row = table.locator('tbody tr[data-row]').first();
  await expect(row).toContainText('Предельный возраст');
  await row.getByRole('button', { name: 'Открыть' }).click();
  await expect(page).toHaveURL(/\/staff\/insured\/[0-9a-f-]{36}$/);
  const note = page.getByTestId('age-limit-note');
  await expect(note).toContainText('Ребёнок достиг предельного возраста');
  await expect(note).toContainText('исполнилось 18');
  await expect(page.getByTestId('insured-relation')).toContainText('Ребёнок');
});
