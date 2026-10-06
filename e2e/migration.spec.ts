/*
 * Transfer of the existing portfolio (/staff/admin/migration): the demo batch file by file with the
 * validation report, rows with errors excluded and never written, four-eyes, reconciliation, the
 * insured person's remaining limit in the app, search by the old number, rollback and its rules.
 */
import { expect, test, type Page } from '@playwright/test';
import { join } from 'node:path';
import { acceptConsent, api, CODE, failOnDialog, loginStaff } from './helpers';

const FIXTURES = join(process.cwd(), 'e2e/fixtures/migration');
const STEPS = [
  { step: 'clients', label: 'Клиенты', summary: 'Строк 6 · без ошибок 5 · с ошибками 1', errors: 1 },
  { step: 'contracts', label: 'Договоры', summary: 'Строк 5 · без ошибок 5 · с ошибками 0', errors: 0 },
  // A row per person: 204 employees (4 with errors) and 204 family members.
  { step: 'insured', label: 'Застрахованные', summary: 'Строк 408 · без ошибок 404 · с ошибками 4', errors: 4 },
  { step: 'limits', label: 'Использованные лимиты', summary: 'Строк 40 · без ошибок 40 · с ошибками 0', errors: 0 },
  { step: 'claims', label: 'Открытые убытки', summary: 'Строк 11 · без ошибок 10 · с ошибками 1', errors: 1 },
  { step: 'invoices', label: 'Неоплаченные счета', summary: 'Строк 3 · без ошибок 3 · с ошибками 0', errors: 0 },
] as const;
const DATE = '2026-10-01';
const STAFF = /\/staff$/;

/** Switches the role in the same tab (the same in-page mock DB) through the demo banner. */
async function switchTo(page: Page, label: string): Promise<void> {
  await page.getByRole('button', { name: 'Войти как…' }).click();
  await page.getByRole('menuitem', { name: new RegExp(`^${label} — [a-z0-9.+-]+@`) }).click();
  await expect(page.getByText(`Вы вошли как «${label}»`).last()).toBeVisible();
  await expect(page).toHaveURL(STAFF);
}

async function newBatch(page: Page): Promise<string> {
  await page.getByRole('link', { name: 'Перенос портфеля' }).click();
  await expect(page.getByRole('heading', { name: 'Перенос действующего портфеля', level: 1 })).toBeVisible();
  await page.getByRole('button', { name: 'Новый пакет' }).click();
  const dialog = page.getByRole('dialog', { name: 'Новый пакет' });
  await dialog.getByLabel('Дата переноса').fill(DATE);
  await dialog.getByRole('button', { name: 'Создать пакет' }).click();
  await expect(page).toHaveURL(/\/staff\/admin\/migration\/[0-9a-f-]{36}$/);
  return page.url();
}

/** The whole demo batch through the screens: upload, report, explicit exclusion, confirm, send. */
async function prepareDemoBatch(page: Page): Promise<string> {
  const url = await newBatch(page);
  for (const s of STEPS) {
    await page.getByLabel(`Файл: ${s.label}`).setInputFiles(join(FIXTURES, `migration-${s.step}-demo.csv`));
    await expect(page.getByTestId(`summary-${s.step}`)).toContainText(s.summary);
    await expect(page.getByTestId(`summary-${s.step}`)).toContainText('в систему ничего не записано');
    const confirm = page.getByRole('button', { name: 'Подтвердить шаг' });
    if (s.errors) {
      await expect(confirm).toBeDisabled();
      await page.getByRole('checkbox', { name: `Исключить строки с ошибками (${s.errors}) — они не будут записаны` }).click();
    }
    await confirm.click();
    await expect(page.getByTestId(`step-${s.step}`)).toContainText('Подтверждён');
  }
  await page.getByRole('button', { name: 'Отправить на подтверждение' }).click();
  await expect(page.getByTestId('batch-pending')).toContainText('Нужен второй администратор');
  await expect(page.getByRole('button', { name: 'Применить пакет' })).toHaveCount(0);
  return url;
}

async function approve(page: Page, url: string): Promise<void> {
  await switchTo(page, 'Второй администратор');
  await page.goto(url);
  await page.getByRole('button', { name: 'Применить пакет' }).click();
  await page.getByRole('dialog', { name: 'Применить пакет' }).getByRole('button', { name: 'Применить пакет' }).click();
  await expect(page.getByTestId('batch-outcome')).toContainText('подтвердил Nazarov Sardor Ravshanovich');
}

test('migration: the demo batch is transferred, reconciled, found by the old number and seen by the insured person', async ({ page }) => {
  test.setTimeout(240_000);
  failOnDialog(page);
  await loginStaff(page, 'admin');
  const url = await (async () => {
    await page.getByRole('link', { name: 'Перенос портфеля' }).click();
    // Demo build: the files of the previous system can be downloaded from the page.
    await expect(page.getByTestId('migration-samples')).toBeVisible();
    return prepareDemoBatch(page);
  })();

  // The validation report shows errors by row and column.
  await expect(page.getByTestId('issues-clients')).toContainText('ИНН — 9 цифр');
  await expect(page.getByTestId('issues-insured')).toContainText('ПИНФЛ — 14 цифр');
  await expect(page.getByTestId('issues-insured')).toContainText('Договор с этим старым номером не найден');
  await expect(page.getByTestId('issues-claims')).toContainText('Переносятся только открытые убытки');
  // Premiums: a person without an individual premium in a contract without premiums by type is an error;
  // a contract whose insured premiums do not add up is a warning and a highlighted row before applying.
  await expect(page.getByTestId('issues-insured')).toContainText('Нет премии: укажите premium в строке или в договоре premium_employee для сотрудника и premium_family для члена семьи');
  await expect(page.getByTestId('issues-insured')).toContainText('Договор MIG-2026/0504: сумма премий застрахованных 221 400 000 не равна премии договора 223 900 000');
  await expect(page.getByTestId('premium-MIG-2026/0504')).toHaveAttribute('data-match', 'false');
  await expect(page.getByTestId('premium-MIG-2026/0503')).toHaveAttribute('data-match', 'true');
  // Nothing is written before the second administrator applies the batch.
  expect(((await api(page, 'GET', '/clients?q=409100001')).data as { total: number }).total).toBe(0);

  await approve(page, url);
  // Reconciliation: contracts and premiums match the files; the excluded rows show as highlighted mismatches.
  await expect(page.getByTestId('recon-contracts')).toHaveAttribute('data-match', 'true');
  await expect(page.getByTestId('recon-premium')).toHaveAttribute('data-match', 'true');
  await expect(page.getByTestId('recon-limitsUsed')).toHaveAttribute('data-match', 'true');
  await expect(page.getByTestId('recon-invoices')).toHaveAttribute('data-match', 'true');
  await expect(page.getByTestId('recon-clients')).toHaveAttribute('data-match', 'false');
  await expect(page.getByTestId('recon-clients')).toContainText('Расхождение');
  await expect(page.getByTestId('recon-insured')).toHaveAttribute('data-match', 'false');
  await expect(page.getByTestId('migrated-contracts')).toContainText('MIG-2026/0501');
  // Per contract: the sum of the transferred persons' premiums against the contract premium (±1 сум).
  await expect(page.getByTestId('premium-MIG-2026/0504')).toHaveAttribute('data-match', 'false');
  await expect(page.getByTestId('premium-MIG-2026/0504')).toContainText('Расхождение');
  await expect(page.getByTestId('premium-MIG-2026/0504')).toHaveClass(/bg-danger-soft/);
  for (const n of ['0501', '0502', '0505']) await expect(page.getByTestId(`premium-MIG-2026/${n}`)).toHaveAttribute('data-match', 'true');
  // Every person of MIG-2026/0503 (40 employees and 51 family members) has an individual premium: 91 of 91, and they add up.
  await expect(page.getByTestId('premium-MIG-2026/0503')).toHaveAttribute('data-match', 'true');
  await expect(page.getByTestId('premium-MIG-2026/0503')).toContainText('Сходится');
  await expect(page.getByTestId('premium-MIG-2026/0503').getByRole('cell').nth(4)).toHaveText('91');

  // Rows with errors were not written; the valid ones were.
  expect(((await api(page, 'GET', '/clients?q=409100001')).data as { total: number }).total).toBe(1);
  expect(((await api(page, 'GET', '/clients?q=Andijon%20Mebel%20Savdo')).data as { total: number }).total).toBe(0);

  // The client card carries the mark of the transfer.
  const client = ((await api(page, 'GET', '/clients?q=409100001')).data as { items: { id: string }[] }).items[0]!;
  await page.goto(`/staff/clients/${client.id}`);
  await expect(page.getByTestId('migrated-mark')).toContainText('Перенесено из старой системы');
  await expect(page.getByTestId('migrated-mark')).toContainText('Aliyev Temur Farhodovich');

  // A transferred contract is found by its old number in the contracts list and in the command palette.
  await switchTo(page, 'Андеррайтер');
  await page.getByRole('link', { name: 'Договоры', exact: true }).click();
  await page.getByRole('searchbox', { name: 'Номер договора, старый номер МИГ или клиент' }).fill('MIG-2026/0501');
  await expect(page.getByRole('row').filter({ hasText: 'Старый № MIG-2026/0501' })).toHaveCount(1);
  await expect(page.getByRole('row').filter({ hasText: 'MIG-2026/0502' })).toHaveCount(0);
  await page.getByRole('row').filter({ hasText: 'Старый № MIG-2026/0501' }).click();
  await expect(page.getByTestId('migrated-mark')).toContainText('Старый № MIG-2026/0501');
  await expect(page.getByText('Действует').first()).toBeVisible();
  await expect(page.getByTestId('migrated-scan')).toContainText('Скан ещё не приложен');
  await page.keyboard.press('Control+k');
  await page.getByPlaceholder(/номер полиса/).fill('MIG-2026/0502');
  await page.getByRole('option', { name: /MIG-2026\/0502/ }).click();
  await expect(page.getByTestId('migrated-mark')).toContainText('Старый № MIG-2026/0502');

  // The insured person of the batch signs in: remaining limit = plan limit − used before the transfer.
  await page.evaluate(() => sessionStorage.removeItem('mig.session'));
  await page.goto('/app/login');
  await page.getByLabel(/Номер телефона/).fill('770000001');
  await page.getByRole('button', { name: 'Получить код' }).click();
  await expect(page).toHaveURL(/\/app\/login\/code/);
  await page.getByLabel('Цифра 1').fill(CODE);
  await acceptConsent(page);
  const limits = (await api(page, 'GET', '/me/limits')).data as { category: string; limit: number; used: number }[];
  const outpatient = limits.find((l) => l.category === 'outpatient')!;
  expect(outpatient.limit - outpatient.used).toBe(8_000_000);
  expect(outpatient.used).toBe(2_500_000);
  await expect(page.getByText(/ещё 8\s000\s000/).first()).toBeVisible();
});

test('migration: a batch is rolled back while untouched; a new action on its data blocks the rollback', async ({ page }) => {
  test.setTimeout(240_000);
  failOnDialog(page);
  await loginStaff(page, 'admin');

  // A contract entered manually becomes a one-row batch; the same checks as a CSV row.
  const clients = (await api(page, 'GET', '/clients?pageSize=100')).data as { items: { id: string; inn: string; activePolicyId?: string; status: string }[] };
  const free = clients.items.find((c) => !c.activePolicyId)!;
  await page.getByRole('link', { name: 'Перенос портфеля' }).click();
  await page.getByRole('button', { name: 'Ввести договор вручную' }).click();
  const dialog = page.getByRole('dialog', { name: 'Договор вручную' });
  await dialog.getByLabel('Дата переноса').fill(DATE);
  await dialog.getByLabel('Старый номер МИГ').fill('MIG-2025/0042');
  await dialog.getByLabel('ИНН клиента').fill('409999999');
  await dialog.getByLabel('Начало').fill('2026-02-01');
  await dialog.getByLabel('Окончание').fill('2027-01-31');
  await dialog.getByLabel('Премия, сум').fill('45000000');
  await dialog.getByRole('button', { name: 'Отправить на подтверждение' }).click();
  await expect(dialog.getByText('Клиент с этим ИНН не найден ни в файле клиентов, ни в системе')).toBeVisible();
  await dialog.getByLabel('ИНН клиента').fill(free.inn);
  await dialog.getByRole('button', { name: 'Отправить на подтверждение' }).click();
  await expect(page).toHaveURL(/\/staff\/admin\/migration\/[0-9a-f-]{36}$/);
  const manualUrl = page.url();
  await expect(page.getByTestId('batch-pending')).toBeVisible();
  await approve(page, manualUrl);
  const applied = ((await api(page, 'GET', `/clients/${free.id}`)).data as { activePolicyId?: string; migration?: unknown });
  expect(applied.activePolicyId).toBeTruthy();
  await page.getByRole('button', { name: 'Откатить пакет' }).click();
  const rb = page.getByRole('dialog', { name: 'Откатить пакет целиком' });
  await rb.getByLabel('Причина').fill('Введён по ошибке');
  await rb.getByRole('button', { name: 'Откатить пакет' }).click();
  await expect(page.getByTestId('batch-outcome')).toContainText('Откачен');
  await expect(page.getByTestId('recon-contracts')).toHaveAttribute('data-match', 'false');
  expect(((await api(page, 'GET', `/clients/${free.id}`)).data as { activePolicyId?: string }).activePolicyId).toBeUndefined();

  // The demo batch: applied by the second administrator, then a claims officer changes a reserve.
  await switchTo(page, 'Администратор');
  const url = await prepareDemoBatch(page);
  await approve(page, url);
  await expect(page.getByRole('button', { name: 'Откатить пакет' })).toBeVisible();
  await switchTo(page, 'Специалист по убыткам');
  const claims = (await api(page, 'GET', '/claims?q=CL-2026-7701')).data as { items: { id: string; externalNumber?: string }[] };
  expect(claims.items.map((c) => c.externalNumber)).toEqual(['CL-2026-7701']);
  expect((await api(page, 'PATCH', `/claims/${claims.items[0]!.id}/reserve`, { amount: 100_000, reason: 'Уточнение по документам' })).status).toBe(200);
  // The paid claim of the file (a row with an error) is not in the system.
  expect(((await api(page, 'GET', '/claims?q=CL-2026-7799')).data as { total: number }).total).toBe(0);

  await switchTo(page, 'Второй администратор');
  await page.goto(url);
  await expect(page.getByTestId('rollback-blocked')).toContainText('Откат невозможен: с перенесёнными данными уже работали');
  await expect(page.getByTestId('rollback-blockers')).toContainText('Изменён резерв');
  await expect(page.getByTestId('rollback-blockers')).toContainText('Hasanov Bobur Ilhomovich');
  await expect(page.getByRole('button', { name: 'Откатить пакет' })).toHaveCount(0);
  await expect(page.getByTestId('recon-reserves')).toHaveAttribute('data-match', 'false');
  // The server refuses too.
  const id = url.split('/').pop()!;
  const refused = await api(page, 'POST', `/admin/migration/batches/${id}/rollback`, { reason: 'Попытка отката' });
  expect(refused.status).toBe(409);
});

test('migration: only administrators reach the section and its API', async ({ page }) => {
  await loginStaff(page, 'operator');
  await expect(page.getByRole('link', { name: 'Перенос портфеля' })).toHaveCount(0);
  expect((await api(page, 'GET', '/admin/migration/batches')).status).toBe(403);
  expect((await api(page, 'POST', '/admin/migration/batches', { migrationDate: DATE })).status).toBe(403);
});
