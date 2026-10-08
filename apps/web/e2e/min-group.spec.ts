/*
 * Corporate clients only and the minimal group size (DECISIONS «Только корпоративные клиенты и минимальная
 * численность»): an ИП lead is not saved; a quote of 6 employees is not approved by the underwriter but is by
 * the head of underwriting with a comment; a contract below the minimum without an exception is not signed;
 * HR is warned about an exclusion below the minimum and a task reaches the underwriter.
 */
import { expect, test, type Page } from './test';
import { api, CODE, loginStaff, PASSWORD } from './helpers';

interface Deal {
  id: string;
  stage: string;
  clientName: string;
  kpId?: string;
  type: string;
}

/** Another person in the same browser (the mock database lives in the page): sign out, sign in. */
async function relogin(page: Page, login: (p: Page) => Promise<void>): Promise<void> {
  await page.evaluate(() => sessionStorage.removeItem('mig.session'));
  await login(page);
}

async function loginEmail(page: Page, email: string, home: RegExp): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Пароль').fill(PASSWORD);
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await page.getByLabel('Цифра 1').fill(CODE);
  await expect(page).toHaveURL(home);
}

test('an ИП lead is not saved: the form is refused with an explanation; a small headcount only warns', async ({ page }) => {
  await loginStaff(page, 'sales_manager');
  await page.goto('/staff/deals');
  await page.getByRole('button', { name: 'Новый лид' }).click();
  const lead = page.getByRole('dialog', { name: 'Новый лид' });
  await lead.getByLabel('Форма').selectOption('sole_proprietor');
  await expect(lead.getByText(/Форма ИП не допускается: ДМС оформляется только для компаний/)).toBeVisible();
  await lead.getByLabel('Численность, примерно').fill('6');
  await expect(lead.getByTestId('headcount-warning')).toContainText('Меньше минимальной численности (10)');
  await lead.getByLabel('Название').fill('Kichik Biznes');
  await lead.getByLabel('ИНН').fill('512340099');
  await lead.getByRole('button', { name: 'Создать лид' }).click();
  await expect(lead).toBeVisible();
  await expect(page).toHaveURL(/\/staff\/deals$/);
  const deals = (await api(page, 'GET', '/deals')).data as Deal[];
  expect(deals.some((d) => d.clientName === 'Kichik Biznes')).toBe(false);
});

test('a quote of 6 employees: the underwriter cannot approve it, the head approves it as an exception with a comment', async ({ page }) => {
  test.setTimeout(120_000);
  await loginStaff(page, 'underwriter');
  const deals = (await api(page, 'GET', '/deals')).data as Deal[];
  const deal = deals.find((d) => d.clientName === 'Navoiy Mebel')!;
  const quote = ((await api(page, 'GET', `/deals/${deal.id}`)).data as { quote: { id: string } }).quote;
  const quoteUrl = `/staff/quotes/${quote.id}`;
  await page.goto(quoteUrl);
  const plaque = page.getByTestId('quote-min-group');
  await expect(plaque).toHaveAttribute('data-below', 'true');
  await expect(plaque).toContainText('Сотрудников 6 из минимума 10');
  await expect(page.getByTestId('quote-authority')).toContainText('численность ниже минимальной: 6 из 10');
  // No discount, still not «Утвердить»: only for approval.
  await page.getByRole('button', { name: 'Отправить на согласование' }).click();
  await expect(page.getByText('На согласовании').first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Согласовать' })).toHaveCount(0);

  await relogin(page, (p) => loginEmail(p, 'underwriter-head@demo.mig.uz', /\/staff$/));
  await page.goto(quoteUrl);
  await page.getByRole('button', { name: 'Согласовать' }).click();
  const dialog = page.getByRole('dialog', { name: 'Согласовать котировку' });
  await expect(dialog).toContainText('Численность ниже минимальной (6 из 10)');
  await dialog.getByRole('button', { name: 'Согласовать' }).click();
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Почему делается исключение').fill('Компания растёт: через квартал 12 сотрудников');
  await dialog.getByRole('button', { name: 'Согласовать' }).click();
  await expect(page.getByText('Утверждена').first()).toBeVisible();
  await expect(page.getByTestId('quote-exception')).toContainText('Компания растёт: через квартал 12 сотрудников');
});

test('a contract whose appendix 2 is below the minimum, without an exception, is not signed', async ({ page }) => {
  test.setTimeout(120_000);
  await loginStaff(page, 'sales_manager');
  const deals = (await api(page, 'GET', '/deals')).data as Deal[];
  const deal = deals.find((d) => d.stage === 'kp_sent' && d.kpId && d.type === 'new')!;
  expect((await api(page, 'POST', `/kp/${deal.kpId}/accept`)).status).toBe(200);
  const c = (await api(page, 'POST', '/contracts', { dealId: deal.id })).data as { id: string };
  await page.goto(`/staff/contracts/${c.id}`);
  const list = ['fullName,birthDate,pinfl,phone,position,relation,principal_pinfl,student', 'Testov Test Testovich,15.03.1990,31503900000301,+998935550301,Engineer,employee,,', 'Testova Testa Testovna,01.07.1988,40107880000302,+998935550302,Accountant,employee,,'].join('\n');
  await page.getByLabel('Файл приложения 2').setInputFiles({ name: 'list.csv', mimeType: 'text/csv', buffer: Buffer.from(list, 'utf8') });
  const plaque = page.getByTestId('contract-min-group');
  await expect(plaque).toContainText('В приложении 2 2 из минимума 10, исключение в котировке не утверждено — подписать договор нельзя.');
  expect((await api(page, 'POST', `/contracts/${c.id}/submit-legal`)).status).toBe(200);
  expect((await api(page, 'POST', `/contracts/${c.id}/send`)).status).toBe(200);

  await relogin(page, (p) => loginEmail(p, 'underwriter-head@demo.mig.uz', /\/staff$/));
  await page.goto(`/staff/contracts/${c.id}`);
  await page.getByRole('button', { name: 'Подписать ЭЦП за МИГ' }).click();
  const key = page.getByRole('dialog', { name: 'Выберите ключ ЭЦП' });
  await key.getByLabel('Пароль ключа').fill('demo');
  await key.getByRole('button', { name: 'Подписать' }).click();
  await expect(page.getByText(/меньше минимума \(2 из 10\).*подписать нельзя/).first()).toBeVisible();
  expect(((await api(page, 'GET', `/contracts/${c.id}`)).data as { status: string }).status).toBe('sent');
});

test('HR: an exclusion below the minimum is warned about, allowed, and the underwriter gets a task', async ({ page }) => {
  test.setTimeout(150_000);
  await loginStaff(page, 'hr');
  const group = ((await api(page, 'GET', '/hr/overview')).data as { group: { employees: number } }).group;

  // MIG sets the minimum to the current group (four eyes: one administrator proposes, the other confirms).
  await relogin(page, (p) => loginStaff(p, 'admin'));
  const change = (await api(page, 'POST', '/params/changes', { key: 'minGroupSize', value: group.employees, reason: 'Проверка минимальной численности' })).data as { id: string };
  await relogin(page, (p) => loginEmail(p, 'admin2@demo.mig.uz', /\/staff/));
  expect((await api(page, 'POST', `/params/changes/${change.id}/approve`)).status).toBe(200);

  await relogin(page, (p) => loginStaff(p, 'hr'));
  await page.goto('/hr');
  const row = page.getByRole('row').filter({ has: page.getByRole('button', { name: 'Действия с сотрудником' }) }).first();
  await row.getByRole('button', { name: 'Действия с сотрудником' }).click();
  await page.getByRole('menuitem', { name: 'Исключить с даты…' }).click();
  await expect(page.getByTestId('exclude-below-min')).toContainText(`По условиям договора минимальная численность — ${group.employees}.`);
  await page.getByRole('button', { name: 'Отправить заявку' }).click();
  await expect(page.getByText('Заявка на исключение отправлена в МИГ')).toBeVisible();

  await relogin(page, (p) => loginStaff(p, 'underwriter'));
  await page.getByRole('tab', { name: /Задачи от коллег/ }).click();
  const task = page.locator('tbody tr').filter({ hasText: 'Численность ниже минимальной после исключения' });
  await expect(task).toHaveCount(1);
  await task.click();
  await expect(page).toHaveURL(/\/staff\/clients\/[0-9a-f-]{36}$/);
});
