/*
 * Empty sections with a next step (DECISIONS «Пустые состояния со следующим шагом»): the «Застрахованные» tab
 * of a lead explains the stage and offers the right action per role, «Попросить менеджера» puts a task into
 * the manager's queue with a link back, «Запросить у HR» reaches the HR cabinet («Задачи от МИГ») and the
 * upload there notifies the manager, the deal checklist blocks the next stage and names what is missing.
 */
import { expect, test, type Page } from './test';
import { api, CODE, loginStaff, PASSWORD } from './helpers';

interface Deal {
  id: string;
  number: string;
  stage: string;
  clientId: string;
  clientName: string;
  kpId?: string;
  type: string;
}

const csvFile = (name: string, text: string) => ({ name, mimeType: 'text/csv', buffer: Buffer.from(text, 'utf8') });
const LIST = ['fullName,birthDate,pinfl,phone,position,relation,principal_pinfl,student', 'Novyy Sotrudnik Pervyy,15.03.1990,31503900000101,+998935550101,Engineer,employee,,', 'Novaya Sotrudnitsa Vtoraya,01.07.1988,40107880000102,+998935550102,Accountant,employee,,'].join('\n');

/** A seeded lead whose client has no HR cabinet yet. */
async function lead(page: Page): Promise<Deal> {
  const deals = (await api(page, 'GET', '/deals')).data as Deal[];
  for (const d of deals.filter((x) => x.stage === 'lead')) {
    const card = (await api(page, 'GET', `/deals/${d.id}`)).data as { hasHr: boolean };
    if (!card.hasHr) return d;
  }
  throw new Error('no seeded lead without HR');
}

async function openInsuredTab(page: Page, clientId: string): Promise<void> {
  await page.goto(`/staff/clients/${clientId}`);
  await page.getByRole('tab', { name: 'Застрахованные' }).click();
  await expect(page.getByTestId('insured-next')).toBeVisible();
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

test('underwriter: «Застрахованные» of a lead explains the stage; «Попросить менеджера» puts a task into the manager’s queue with a link back', async ({ page }) => {
  test.setTimeout(120_000);
  await loginStaff(page, 'underwriter');
  const deal = await lead(page);
  await openInsuredTab(page, deal.clientId);
  const empty = page.getByTestId('insured-next');
  await expect(empty.getByTestId('empty-why')).toContainText('Застрахованные появятся после вступления договора в силу');
  await expect(empty.getByTestId('empty-why')).toContainText('на этапе «Лид»');
  await expect(empty.getByTestId('empty-next')).toContainText('Менеджер по продажам');
  await expect(empty.getByRole('link', { name: 'Открыть сделку' })).toHaveAttribute('href', `/staff/deals/${deal.id}/census`);
  await expect(empty.getByRole('link', { name: 'Подробнее в справке' })).toHaveAttribute('href', '/staff/help/new-client#census');
  await expect(empty.getByRole('link', { name: 'Загрузить данные для оценки' })).toHaveCount(0);

  await empty.getByRole('button', { name: 'Попросить менеджера' }).click();
  const dialog = page.getByRole('dialog', { name: 'Попросить менеджера' });
  await dialog.getByLabel('Комментарий').fill('Нужно для расчёта к пятнице');
  await dialog.getByRole('button', { name: 'Отправить запрос' }).click();
  await expect(page.getByText('Запрос отправлен')).toBeVisible();

  await relogin(page, (p) => loginStaff(p, 'sales_manager'));
  const sales = page;
  await sales.getByRole('tab', { name: /Задачи от коллег/ }).click();
  const row = sales.locator('tbody tr').filter({ hasText: deal.clientName });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText('Загрузить данные для оценки');
  await expect(row).toContainText('Просит: Sokolov');
  await row.click();
  await expect(sales).toHaveURL(new RegExp(`/staff/deals/${deal.id}/census\\?upload=1$`));
  await expect(sales.getByTestId('census-upload')).toHaveAttribute('data-focused', 'true');
});

test('manager on the same tab: «Загрузить данные для оценки» opens the upload in the deal; before the KP «Запросить у HR» is a ready letter', async ({ page }) => {
  await loginStaff(page, 'sales_manager');
  const deal = await lead(page);
  await openInsuredTab(page, deal.clientId);
  const empty = page.getByTestId('insured-next');
  await expect(empty.getByRole('button', { name: 'Попросить менеджера' })).toHaveCount(0);
  await expect(empty.getByRole('button', { name: 'Скачать шаблон' })).toBeVisible();

  await empty.getByRole('button', { name: 'Запросить у HR' }).click();
  const letter = page.getByRole('dialog', { name: 'Письмо клиенту' });
  await expect(letter.getByTestId('client-letter')).toContainText(deal.clientName);
  await expect(letter.getByRole('button', { name: 'Скачать шаблон CSV' })).toBeVisible();
  await page.keyboard.press('Escape');

  await empty.getByRole('link', { name: 'Загрузить данные для оценки' }).click();
  await expect(page).toHaveURL(new RegExp(`/staff/deals/${deal.id}/census\\?upload=1$`));
  const picker = page.getByTestId('census-upload');
  await expect(picker).toHaveAttribute('data-focused', 'true');
  await expect(picker.getByLabel('Файл с данными для оценки')).toBeFocused();
});

test('contract stage: «Запросить у HR» → HR sees the task → uploads the list → the manager is notified, appendix 2 is filled', async ({ page }) => {
  test.setTimeout(150_000);
  await loginStaff(page, 'sales_manager');
  const deals = (await api(page, 'GET', '/deals')).data as Deal[];
  const deal = deals.find((d) => d.stage === 'kp_sent' && d.kpId && d.type === 'new')!;
  expect((await api(page, 'POST', `/kp/${deal.kpId}/accept`)).status).toBe(200);
  const contract = (await api(page, 'POST', '/contracts', { dealId: deal.id })).data as { id: string; number: string };
  const client = (await api(page, 'GET', `/clients/${deal.clientId}`)).data as { inn: string };

  await openInsuredTab(page, deal.clientId);
  const empty = page.getByTestId('insured-next');
  await expect(empty).toContainText(`Договор ${contract.number} в работе`);
  await expect(empty.getByRole('link', { name: 'Загрузить список застрахованных (приложение 2)' })).toHaveAttribute('href', `/staff/contracts/${contract.id}?upload=annex2`);
  await empty.getByRole('button', { name: 'Запросить у HR' }).click();
  const dialog = page.getByRole('dialog', { name: 'Запросить у HR клиента' });
  await dialog.getByLabel('Комментарий').fill('Список сотрудников до 15.10');
  await dialog.getByRole('button', { name: 'Отправить запрос' }).click();
  await expect(page.getByText('Задача отправлена в кабинет HR')).toBeVisible();

  await relogin(page, (p) => loginEmail(p, `hr@${client.inn}.example.uz`, /\/hr$/));
  const hr = page;
  const tasks = hr.getByTestId('hr-tasks');
  await expect(tasks.getByRole('heading', { name: 'Задачи от МИГ' })).toBeVisible();
  const task = tasks.getByTestId('hr-task');
  await expect(task).toContainText(`Загрузите список сотрудников для договора ${contract.number}`);
  await expect(task).toContainText('Список сотрудников до 15.10');
  await expect(task).toContainText(/до \d{2}\.\d{2}\.\d{4}/);
  await task.getByLabel('Выберите файл приложения 2').setInputFiles(csvFile('list.csv', LIST));
  await expect(hr.getByText('Список загружен. Менеджер МИГ получит уведомление.')).toBeVisible();
  await expect(hr.getByTestId('hr-tasks')).toHaveCount(0);

  await relogin(page, (p) => loginStaff(p, 'sales_manager'));
  await expect(page.getByTestId('notifications-count')).toHaveText('1');
  await page.getByTestId('notifications').click();
  const note = page.getByTestId('notification').first();
  await expect(note).toContainText('выполнил(а) ваш запрос');
  await note.click();
  await expect(page).toHaveURL(new RegExp(`/staff/contracts/${contract.id}$`));
  await expect(page.getByRole('heading', { name: 'Приложение 2 — застрахованные: 2' })).toBeVisible();
});

test('the deal checklist blocks the next stage until the item is done and names what is missing', async ({ page }) => {
  await loginStaff(page, 'sales_manager');
  const deal = await lead(page);
  await page.goto(`/staff/deals/${deal.id}`);
  const list = page.getByTestId('deal-checklist');
  await expect(list.getByRole('heading', { name: 'Что нужно для следующего этапа' })).toBeVisible();
  const census = list.getByTestId('check-census');
  await expect(census).toHaveAttribute('data-state', 'todo');
  await expect(census).toContainText('Не готово · Отвечает: Менеджер по продажам');
  await expect(page.getByTestId('missing-note')).toHaveText('Не хватает: Данные для оценки');

  // The underwriter cannot calculate the quote yet: the button is blocked with the same reason.
  await relogin(page, (p) => loginStaff(p, 'underwriter'));
  await page.goto(`/staff/deals/${deal.id}`);
  await expect(page.getByRole('button', { name: 'Рассчитать котировку' })).toBeDisabled();
  await expect(page.getByTestId('missing-note')).toHaveText('Не хватает: Данные для оценки');
  await expect(page.getByTestId('check-census').getByRole('link', { name: 'Загрузить данные для оценки' })).toBeVisible();

  // A contract without appendix 2 cannot go to approval.
  await relogin(page, (p) => loginStaff(p, 'sales_manager'));
  const deals = (await api(page, 'GET', '/deals')).data as Deal[];
  const sent = deals.find((d) => d.stage === 'kp_sent' && d.kpId && d.type === 'new')!;
  expect((await api(page, 'POST', `/kp/${sent.kpId}/accept`)).status).toBe(200);
  const contract = (await api(page, 'POST', '/contracts', { dealId: sent.id })).data as { id: string };
  await page.goto(`/staff/deals/${sent.id}`);
  await expect(page.getByTestId('check-annex2')).toHaveAttribute('data-state', 'todo');
  await expect(page.getByTestId('missing-note')).toContainText('Приложение 2 — список застрахованных');
  await page.goto(`/staff/contracts/${contract.id}`);
  await expect(page.getByRole('button', { name: 'Отправить на согласование' })).toBeDisabled();
  await expect(page.getByTestId('missing-note')).toContainText('Приложение 2');
  await page.getByTestId('annex2-next').getByLabel('Файл приложения 2').setInputFiles(csvFile('list.csv', LIST));
  await expect(page.getByRole('button', { name: 'Отправить на согласование' })).toBeEnabled();
  await expect(page.getByTestId('missing-note')).toHaveCount(0);
});
