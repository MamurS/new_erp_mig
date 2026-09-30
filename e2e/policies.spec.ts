/* Policy issuance and changes of the insured list — POLICY_SPEC §10, e2e scenarios 1–4. */
import { expect, test, type Page } from '@playwright/test';
import { api, CODE, loginStaff, PASSWORD } from './helpers';

async function switchTo(page: Page, role: RegExp, home: RegExp): Promise<void> {
  await page.getByRole('button', { name: 'Войти как…' }).click();
  await page.getByRole('menuitem', { name: role }).click();
  await expect(page).toHaveURL(home);
}
const asUnderwriter = (page: Page) => switchTo(page, /^Андеррайтер/, /\/staff$/);
const asHr = (page: Page) => switchTo(page, /^HR клиента/, /\/hr$/);

const iso = (d: Date) => d.toISOString().slice(0, 10);
const ru = (isoDate: string) => isoDate.split('-').reverse().join('.');
const tomorrow = () => iso(new Date(Date.now() + 5 * 3600_000 + 86_400_000));

test('1. Underwriter issues a policy from a CSV of 3 employees and invites HR, who sees the employees', async ({ page }) => {
  await loginStaff(page, 'underwriter');
  const clients = (await api(page, 'GET', '/clients?status=negotiation&pageSize=50')).data as { items: { id: string; activePolicyId?: string; name: string }[] };
  const client = clients.items.find((c) => !c.activePolicyId && !/[<>]/.test(c.name))!;
  expect(client).toBeTruthy();

  await page.goto(`/staff/clients/${client.id}`);
  await page.getByRole('button', { name: 'Оформить полис' }).click();
  await expect(page).toHaveURL(new RegExp(`/staff/clients/${client.id}/policies/new$`));
  await page.getByRole('radio', { name: /^Стандарт\+/ }).click();
  await page.getByRole('button', { name: 'Далее' }).click();

  const csv = [
    'fullName,birthDate,pinfl,phone,position,familyMembers',
    'Алиев Тимур Рашидович,15.03.1990,31503900000011,+998901112233,Инженер,2',
    'Каримова Нигора Алишеровна,01.07.1988,30107880000022,901112244,Бухгалтер,0',
    'Сидоров Пётр Ильич,20.11.1979,32011790000033,901112255,Директор,1',
  ].join('\n');
  await page.getByLabel('Файл со списком застрахованных').setInputFiles({ name: 'staff.csv', mimeType: 'text/csv', buffer: Buffer.from(csv, 'utf8') });
  await expect(page.getByTestId('policy-list-preview')).toContainText('корректных: 3');
  await expect(page.getByTestId('policy-list-preview')).toContainText('членов семьи: 3');
  await page.getByRole('button', { name: 'Далее' }).click();

  await expect(page.getByTestId('policy-summary')).toContainText('Стандарт+');
  await page.getByLabel('ФИО HR').fill('Новая Эйчар Тестовна');
  await page.getByLabel('Email HR').fill('hr@new-policy.uz');
  await page.getByRole('button', { name: 'Оформить полис' }).click();
  await expect(page).toHaveURL(/\/staff\/policies\/[0-9a-f-]{36}$/);
  await expect(page.getByText(/Полис ДМС-\d{4}-\d{6} оформлен/)).toBeVisible();
  const policyId = page.url().split('/').pop()!;
  const policy = (await api(page, 'GET', `/policies/${policyId}`)).data as { insuredCount: number; familyCount: number; premium: number };
  expect(policy).toMatchObject({ insuredCount: 3, familyCount: 3, premium: 3 * 5_200_000 + 3 * 4_160_000 });
  await expect(page.getByRole('table', { name: 'Застрахованные по полису' }).getByRole('row')).toHaveCount(4);

  // The invited HR logs in and sees the three employees.
  await page.getByRole('button', { name: 'Профиль и выход' }).click();
  await page.getByRole('menuitem', { name: 'Выйти' }).click();
  await page.goto('/login');
  await page.getByLabel('Email').fill('hr@new-policy.uz');
  await page.getByLabel('Пароль').fill(PASSWORD);
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await page.getByLabel('Цифра 1').fill(CODE);
  await expect(page).toHaveURL(/\/hr$/);
  for (const name of ['Алиев Тимур Рашидович', 'Каримова Нигора Алишеровна', 'Сидоров Пётр Ильич']) await expect(page.getByText(name)).toBeVisible();
});

test('2. HR adds an employee → pending; the underwriter approves; HR sees them active, premium and endorsement follow', async ({ page }) => {
  await loginStaff(page, 'hr');
  await page.goto('/hr/employees/new');
  await page.getByLabel('ФИО').fill('Заявкин Заяв Заявович');
  await page.getByLabel('Дата рождения').fill('15031990');
  await page.getByLabel('ПИНФЛ').fill('31503909876501');
  await page.getByLabel('Телефон').fill('901234501');
  await page.getByLabel('Должность').fill('Инженер');
  await page.getByLabel('Дата начала страхования').fill(ru(tomorrow()).replace(/\./g, ''));
  await page.getByRole('button', { name: 'Добавить сотрудника' }).click();
  await expect(page.getByText('Заявка отправлена в МИГ — сотрудник появится в полисе после подтверждения')).toBeVisible();
  await page.goto('/hr?filter=requests');
  await expect(page.getByRole('row').filter({ hasText: 'Заявкин Заяв Заявович' })).toContainText('Ждёт подтверждения МИГ');

  await asUnderwriter(page);
  const pending = (await api(page, 'GET', '/policy-changes?status=pending')).data as { fullName: string; policyId: string; premiumDelta: number }[];
  const req = pending.find((c) => c.fullName === 'Заявкин Заяв Заявович')!;
  const before = ((await api(page, 'GET', `/policies/${req.policyId}`)).data as { premium: number }).premium;
  await page.goto('/staff/policy-changes');
  await page.getByRole('button', { name: 'Подтвердить: Заявкин Заяв Заявович' }).click();
  await expect(page.getByText(/Подтверждено заявок: 1/)).toBeVisible();
  const after = (await api(page, 'GET', `/policies/${req.policyId}`)).data as { premium: number; documents: { title: string }[] };
  expect(after.premium).toBe(before + req.premiumDelta);
  expect(req.premiumDelta).toBeGreaterThan(0);

  await asHr(page);
  await page.goto('/hr?q=Заявкин');
  const row = page.getByRole('row').filter({ hasText: 'Заявкин Заяв Заявович' });
  await expect(row).toContainText('Приглашён');
  await page.goto('/hr/documents');
  await expect(page.getByText(/Дополнительное соглашение № \d+ к полису ДМС-.*прикреплено 1/).first()).toBeVisible();
});

test('3. HR requests an exclusion, the underwriter rejects it with a reason, HR sees the reason and the employee stays active', async ({ page }) => {
  await loginStaff(page, 'hr');
  await page.goto('/hr?filter=not_in_app');
  const row = page.getByRole('row').filter({ has: page.getByRole('button', { name: 'Действия с сотрудником' }) }).first();
  const name = (await row.locator('p.font-semibold').first().innerText()).trim();
  await row.getByRole('button', { name: 'Действия с сотрудником' }).click();
  await page.getByRole('menuitem', { name: 'Исключить с даты…' }).click();
  await page.getByRole('button', { name: 'Отправить заявку' }).click();
  await expect(page.getByText('Заявка на исключение отправлена в МИГ')).toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: name }).getByTestId('pending-exclusion')).toBeVisible();

  await asUnderwriter(page);
  await page.goto('/staff/policy-changes');
  await page.getByRole('button', { name: `Отклонить: ${name}` }).click();
  const dialog = page.getByRole('dialog', { name: 'Отклонить заявку' });
  await dialog.getByLabel('Причина').fill('Нет приказа об увольнении');
  await dialog.getByRole('button', { name: 'Отклонить' }).click();
  await expect(page.getByText('Отклонено заявок: 1')).toBeVisible();

  await asHr(page);
  await page.goto(`/hr?q=${encodeURIComponent(name.split(' ')[0]!)}`);
  const again = page.getByRole('row').filter({ hasText: name });
  await expect(again.getByTestId('exclusion-rejected')).toContainText('Нет приказа об увольнении');
  await expect(again.getByTestId('pending-exclusion')).toHaveCount(0);
});

test('4. The operator sees the queue but cannot decide: no buttons, and the API answers 403', async ({ page }) => {
  await loginStaff(page, 'operator');
  await page.goto('/staff/policy-changes');
  await expect(page.getByRole('table', { name: 'Заявки на изменение состава' })).toBeVisible();
  await expect(page.getByRole('row').nth(1)).toBeVisible();
  await expect(page.getByRole('button', { name: /^Подтвердить/ })).toHaveCount(0);
  const pending = (await api(page, 'GET', '/policy-changes?status=pending')).data as { id: string }[];
  expect(pending.length).toBeGreaterThan(0);
  expect((await api(page, 'POST', '/policy-changes/decision', { ids: [pending[0]!.id], decision: 'approve' })).status).toBe(403);
});
