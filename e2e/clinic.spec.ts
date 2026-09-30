/* Clinic portal and integration API — CLINIC_SPEC §11, e2e scenarios 1–10. */
import { expect, test, type Page } from '@playwright/test';
import { acceptConsent, api, failOnDialog, loginInsured, loginStaff } from './helpers';

/** Switch the role in the same tab (and the same in-page mock DB) through the demo banner. */
async function switchTo(page: Page, role: RegExp, home: RegExp): Promise<void> {
  await page.getByRole('button', { name: 'Войти как…' }).click();
  await page.getByRole('menuitem', { name: role }).click();
  await expect(page).toHaveURL(home);
}
const AS = {
  registrar: [/^Регистратор клиники/, /\/clinic$/],
  clinicAdmin: [/^Администратор клиники/, /\/clinic$/],
  doctor: [/^Врач-эксперт/, /\/staff$/],
  operator: [/^Оператор ДМС/, /\/staff$/],
  accountant: [/^Бухгалтер/, /\/staff$/],
} as const satisfies Record<string, readonly [RegExp, RegExp]>;
const as = (page: Page, who: keyof typeof AS) => switchTo(page, AS[who][0], AS[who][1]);

/** Opens a visit for the demo insured person in the clinic of the current (clinic) user. */
async function openVisit(page: Page): Promise<string> {
  const code = ((await api(page, 'POST', '/__demo/mis-card')).data as { shortCode: string }).shortCode;
  const r = await api(page, 'POST', '/clinic/check', { qrToken: code });
  expect(r.status).toBe(200);
  return (r.data as { visitId: string }).visitId;
}

function dateTime(iso: string): string {
  const [d, t] = iso.split('T') as [string, string];
  const [y, m, day] = d.split('-');
  return `${day}.${m}.${y}, ${t.slice(0, 5)}`;
}

test('1. Registrar checks the app code, requests a guarantee letter, the doctor approves it', async ({ page }) => {
  failOnDialog(page);
  await loginInsured(page);
  await page.goto('/app/card');
  const code = (await page.getByTestId('card-short-code').innerText()).trim();
  expect(code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);

  await as(page, 'registrar');
  await page.goto('/clinic/check');
  await page.getByLabel('Сканер штрихкодов или код из 8 символов').fill(code);
  await page.getByRole('button', { name: 'Проверить код' }).click();
  const result = page.getByTestId('coverage-result');
  await expect(result).toBeVisible();
  await expect(result.getByTestId('coverage-table')).toBeVisible();
  // Minimal data: statuses only, no limit amounts and no PINFL.
  await expect(result).not.toContainText(/UZS|сум/);
  expect(await result.innerText()).not.toMatch(/\d{14}/);

  await result.getByRole('button', { name: 'Запросить гарантийное письмо' }).click();
  const dialog = page.getByRole('dialog', { name: 'Запросить гарантийное письмо' });
  await dialog.getByLabel('Услуга из прайса').selectOption('DG-310');
  await dialog.getByLabel('Код МКБ-10').fill('G43.9');
  await dialog.getByLabel('Комментарий врача').fill('Мигрень, показано МРТ');
  await dialog.getByRole('button', { name: 'Отправить запрос' }).click();
  const toast = page.getByText(/Гарантийное письмо ГП-\d{4}-\d{6} запрошено/);
  await expect(toast).toBeVisible();
  const number = /ГП-\d{4}-\d{6}/.exec(await toast.innerText())![0];
  await expect(page).toHaveURL(/\/clinic\/guarantees$/);

  await as(page, 'doctor');
  await page.goto('/staff/guarantees');
  await page.getByRole('row').filter({ hasText: number }).click();
  const decision = page.getByRole('dialog', { name: `Гарантийное письмо ${number}` });
  await decision.getByRole('button', { name: 'Одобрить' }).click();
  await expect(page.getByText('Письмо одобрено')).toBeVisible();

  await as(page, 'registrar');
  await page.goto('/clinic/guarantees');
  await expect(page.getByRole('row').filter({ hasText: number })).toContainText('Одобрено');
});

test('2. Insured books in the demo clinic, registrar confirms, the app shows «Подтвердила клиника»', async ({ page }) => {
  await loginStaff(page, 'clinic_registrar');
  const clinicId = await page.evaluate(() => (JSON.parse(sessionStorage.getItem('mig.session')!) as { user: { clinicId: string } }).user.clinicId);
  await page.getByRole('button', { name: 'Войти как…' }).click();
  await page.getByRole('menuitem', { name: /^Застрахованный/ }).click();
  await acceptConsent(page);

  const tomorrow = new Date(Date.now() + 86_400_000 + 5 * 3600_000).toISOString().slice(0, 10);
  const slots = (await api(page, 'GET', `/clinics/${clinicId}/slots?date=${tomorrow}`)).data as { startsAt: string }[];
  expect(slots.length).toBeGreaterThan(0);
  const startsAt = slots[0]!.startsAt;
  expect([200, 201]).toContain((await api(page, 'POST', '/me/appointments', { clinicId, specialty: 'therapist', startsAt })).status);

  await as(page, 'registrar');
  await page.goto('/clinic/appointments');
  const row = page.getByRole('row').filter({ hasText: dateTime(startsAt) }).filter({ has: page.getByRole('button', { name: /^Подтвердить/ }) });
  await row.first().getByRole('button', { name: /^Подтвердить/ }).click();
  await expect(page.getByText(/подтвержден/i).first()).toBeVisible();

  await page.getByRole('button', { name: 'Войти как…' }).click();
  await page.getByRole('menuitem', { name: /^Застрахованный/ }).click();
  await expect(page).toHaveURL(/\/app$/);
  await page.goto('/app/appointments');
  await expect(page.getByTestId('appt-confirmed-by').filter({ hasText: 'Подтвердила клиника' }).first()).toBeVisible();
});

test('3. CSV registry: upload, submit, reject, dispute, accept, pay — the clinic sees «Оплачен»', async ({ page }) => {
  await loginStaff(page, 'clinic_admin');
  const visitId = await openVisit(page);
  const prices = (await api(page, 'GET', '/clinic/price-list')).data as { code: string; price: number; requiresGuarantee: boolean; name: string }[];
  const simple = prices.filter((p) => !p.requiresGuarantee && !/[<>"]/.test(p.name)).slice(0, 2);
  const today = new Date(Date.now() + 5 * 3600_000).toISOString().slice(0, 10);
  const csv = ['visit_id,service_date,service_code,icd10,quantity,price,guarantee_number', ...simple.map((p) => `${visitId},${today},${p.code},J06.9,1,${p.price},`)].join('\n');

  await page.goto('/clinic/registries');
  await page.getByRole('button', { name: 'Загрузить CSV' }).click();
  await page.getByLabel('Файл реестра CSV').setInputFiles({ name: 'registry.csv', mimeType: 'text/csv', buffer: Buffer.from(csv, 'utf8') });
  await expect(page.getByTestId('registry-import-preview')).toContainText('корректных: 2');
  await page.getByRole('button', { name: 'Создать реестр (2)' }).click();
  await expect(page).toHaveURL(/\/clinic\/registries\/[0-9a-f-]{36}$/);
  const registryId = page.url().split('/').pop()!;
  await page.getByRole('button', { name: 'Отправить в МИГ' }).click();
  await expect(page.getByTestId('registry-status')).toContainText('Отправлен');

  await as(page, 'operator');
  await page.goto(`/staff/registries/${registryId}`);
  await page.getByRole('button', { name: `Отклонить строку ${simple[0]!.name}` }).click();
  const reject = page.getByRole('dialog', { name: 'Отклонить строку' });
  await reject.getByLabel('Причина').fill('Нет записи в медкарте');
  await reject.getByRole('button', { name: 'Отклонить' }).click();
  await page.getByRole('button', { name: `Принять строку ${simple[1]!.name}` }).click();
  await expect(page.getByTestId('registry-status')).toContainText('Принят частично');

  await as(page, 'clinicAdmin');
  await page.goto(`/clinic/registries/${registryId}`);
  await page.getByRole('button', { name: 'Оспорить' }).click();
  const dispute = page.getByRole('dialog', { name: 'Оспорить отклонение' });
  await dispute.getByLabel('Комментарий для МИГ').fill('Запись в медкарте есть, прикладываем выписку');
  await dispute.getByRole('button', { name: 'Оспорить' }).click();
  await expect(page.getByText('Строка оспорена')).toBeVisible();

  await as(page, 'operator');
  await page.goto(`/staff/registries/${registryId}`);
  await page.getByRole('button', { name: `Принять строку ${simple[0]!.name}` }).click();
  // Exact text: «Принят частично» must turn into «Принят» before the role switch.
  await expect(page.getByTestId('registry-status')).toHaveText('Принят');

  await as(page, 'accountant');
  await page.goto(`/staff/registries/${registryId}`);
  await page.getByRole('button', { name: /^Оплатить/ }).click();
  await page.getByRole('dialog', { name: 'Оплатить реестр?' }).getByRole('button', { name: 'Оплатить' }).click();
  await expect(page.getByTestId('registry-status')).toContainText('Оплачен');

  await as(page, 'clinicAdmin');
  await page.goto(`/clinic/registries/${registryId}`);
  await expect(page.getByTestId('registry-status')).toContainText('Оплачен');
});

test('4. Isolation: no visit → 404, foreign letter → 404, registrar has no integration or staff pages', async ({ page }) => {
  await loginStaff(page, 'operator');
  const all = (await api(page, 'GET', '/guarantees')).data as { id: string; clinicId: string }[];
  await as(page, 'registrar');
  const clinicId = await page.evaluate(() => (JSON.parse(sessionStorage.getItem('mig.session')!) as { user: { clinicId: string } }).user.clinicId);
  const foreign = all.find((g) => g.clinicId !== clinicId)!;
  expect(foreign).toBeTruthy();
  expect((await api(page, 'GET', `/clinic/guarantees/${foreign.id}`)).status).toBe(404);
  expect((await api(page, 'GET', '/clinic/visits/00000000-0000-4000-8000-000000000000/coverage')).status).toBe(404);
  expect((await api(page, 'GET', '/insured?pageSize=5')).status).toBe(403);

  await page.goto('/clinic/integration');
  await expect(page).toHaveURL(/\/403$/);
  await page.goto('/staff/clients');
  await expect(page).toHaveURL(/\/403$/);
  await expect(page.getByRole('heading', { name: 'Нет доступа' })).toBeVisible();
});

test('5. Integration: key shown once, sandbox token and patient check, request log, revoked key → 401', async ({ page }) => {
  await loginStaff(page, 'clinic_admin');
  await page.goto('/clinic/integration?tab=keys');
  await page.getByRole('button', { name: 'Создать ключ' }).click();
  const create = page.getByRole('dialog', { name: 'Новый ключ API' });
  await create.getByLabel('Название').fill('МИС e2e');
  await create.getByRole('button', { name: 'Создать ключ' }).click();
  const clientId = (await page.getByTestId('new-client-id').innerText()).trim();
  const secret = (await page.getByTestId('new-client-secret').innerText()).trim();
  await expect(page.getByText('Сохраните секрет сейчас, потом его нельзя будет посмотреть')).toBeVisible();
  await page.getByRole('button', { name: 'Я сохранил секрет' }).click();
  // Shown once: the list keeps only the last four characters.
  await expect(page.getByText(secret)).toHaveCount(0);

  await page.getByRole('tab', { name: 'Песочница' }).click();
  await page.getByLabel('Ключ', { exact: true }).selectOption(clientId);
  await page.getByLabel('client_secret').fill(secret);
  await page.getByRole('button', { name: 'Получить токен' }).click();
  await expect(page.getByText('Токен получен', { exact: true })).toBeVisible();
  const code = ((await api(page, 'POST', '/__demo/mis-card')).data as { shortCode: string }).shortCode;
  await page.getByLabel('Тело запроса (JSON)').fill(JSON.stringify({ qrToken: code }));
  await page.getByRole('button', { name: 'Отправить' }).click();
  await expect(page.getByTestId('sandbox-status')).toHaveText('200');
  await expect(page.getByTestId('sandbox-result')).toContainText('visitId');

  // Revoke the key (same tab, the sandbox keeps its token) and repeat the call.
  const keys = (await api(page, 'GET', '/clinic/integration/keys')).data as { id: string; clientId: string }[];
  const key = keys.find((k) => k.clientId === clientId)!;
  expect((await api(page, 'POST', `/clinic/integration/keys/${key.id}/revoke`)).status).toBe(200);
  await page.getByRole('button', { name: 'Отправить' }).click();
  await expect(page.getByTestId('sandbox-status')).toHaveText('401');

  await page.getByRole('tab', { name: 'Журнал запросов' }).click();
  const logRow = page.getByRole('row').filter({ hasText: clientId }).filter({ hasText: '/coverage/check' });
  await expect(logRow.first()).toBeVisible();
  // Only the path template is logged — never the code or the token.
  expect(await page.content()).not.toContain(code);
});

test('6. MIS simulator sends a registry over the API, MIG operator sees it with source API', async ({ page }) => {
  await loginStaff(page, 'clinic_admin');
  await page.goto('/clinic/integration');
  await page.getByRole('button', { name: 'Отправить реестр (20 строк)' }).click();
  await expect(page.getByTestId('mis-log')).toContainText('Реестр отправлен: 20 строк');

  await as(page, 'operator');
  await page.goto('/staff/registries');
  const row = page.getByRole('row').filter({ hasText: 'API' });
  await expect(row.first()).toBeVisible();
  await row.first().click();
  await expect(page.getByText('источник: API МИС')).toBeVisible();
});

test('7. A card code works once: the second check fails', async ({ page }) => {
  await loginInsured(page);
  const code = ((await api(page, 'GET', '/me/card-token')).data as { shortCode: string }).shortCode;
  await as(page, 'registrar');
  await page.goto('/clinic/check');
  const input = page.getByLabel('Сканер штрихкодов или код из 8 символов');
  await input.fill(code);
  await page.getByRole('button', { name: 'Проверить код' }).click();
  await expect(page.getByTestId('coverage-result')).toBeVisible();
  await page.goto('/clinic/check');
  await input.fill(code);
  await page.getByRole('button', { name: 'Проверить код' }).click();
  await expect(page.getByTestId('check-error')).toContainText('Код устарел');
});

test('8. The 11th failed policy + PINFL check is blocked', async ({ page }) => {
  await loginStaff(page, 'clinic_registrar');
  for (let k = 0; k < 10; k++) {
    const r = await api(page, 'POST', '/clinic/check', { policyNumber: 'ДМС-2026-999999', pinfl: String(30000000000000 + k) });
    expect(r.status).toBe(404);
  }
  await page.goto('/clinic/check');
  await page.getByLabel('Номер полиса').fill('ДМС-2026-999999');
  await page.getByLabel('ПИНФЛ').fill('31234567890123');
  await page.getByRole('button', { name: 'Проверить полис' }).click();
  await expect(page.getByTestId('check-error')).toContainText('заблокированы на 15 минут');
});

test('9. A webhook to a failing address goes to retrying; «Повторить» works', async ({ page }) => {
  await loginStaff(page, 'clinic_admin');
  await page.goto('/clinic/integration?tab=webhooks');
  await page.getByRole('button', { name: 'Добавить вебхук' }).click();
  const dlg = page.getByRole('dialog', { name: 'Новый вебхук' });
  await dlg.getByLabel('Адрес получателя').fill('https://mis.clinic.uz/fail-hook');
  await dlg.getByRole('button', { name: 'Создать вебхук' }).click();
  await expect(page.getByTestId('new-webhook-secret')).toBeVisible();
  await page.getByRole('button', { name: 'Я сохранил секрет' }).click();

  const hook = page.getByRole('listitem').filter({ hasText: 'https://mis.clinic.uz/fail-hook' });
  await hook.getByRole('button', { name: 'Отправить тестовое событие' }).click();
  await expect(page.getByText('Тестовое событие отправлено')).toBeVisible();
  // Newest delivery first: event, time, response code, attempts, status.
  const newest = page.getByRole('table', { name: 'Журнал доставок вебхуков' }).getByRole('row').nth(1);
  await expect(newest.getByRole('cell').nth(2)).toHaveText('500');
  await expect(newest.getByRole('cell').nth(3)).toHaveText('1');
  await expect(newest).toContainText('Повтор');
  await newest.getByRole('button', { name: 'Повторить' }).click();
  await expect(page.getByText('Повторная доставка выполнена')).toBeVisible();
  await expect(newest.getByRole('cell').nth(3)).toHaveText('2');
});

test('10. Four-eyes: a letter above the threshold is not approved by one doctor', async ({ page }) => {
  await loginStaff(page, 'clinic_admin');
  const visitId = await openVisit(page);
  const created = await api(page, 'POST', '/clinic/guarantees', { visitId, serviceCode: 'IP-604', icd10: 'K80.2', estimatedCost: 26_000_000, comment: 'Плановая операция' });
  expect([200, 201]).toContain(created.status);
  const number = (created.data as { number: string }).number;

  await as(page, 'doctor');
  await page.goto('/staff/guarantees');
  await page.getByRole('row').filter({ hasText: number }).click();
  let dlg = page.getByRole('dialog', { name: `Гарантийное письмо ${number}` });
  await dlg.getByRole('button', { name: 'Одобрить' }).click();
  await expect(page.getByText(/нужно одобрение второго врача-эксперта/).first()).toBeVisible();
  const row = page.getByRole('row').filter({ hasText: number });
  await expect(row).toContainText('Запрошено');
  await expect(row).toContainText('1 из 2 одобрений');

  // The same doctor cannot give the second approval — neither in the UI nor via the API.
  await row.click();
  dlg = page.getByRole('dialog', { name: `Гарантийное письмо ${number}` });
  await expect(dlg.getByTestId('four-eyes-note')).toContainText('Вы уже одобрили');
  await expect(dlg.getByRole('button', { name: 'Одобрить' })).toBeDisabled();
  const id = ((await api(page, 'GET', '/guarantees?status=requested')).data as { id: string; number: string }[]).find((g) => g.number === number)!.id;
  const again = await api(page, 'POST', `/guarantees/${id}/decision`, { action: 'approve', amount: 26_000_000, validUntil: '2026-12-31' });
  expect(again.status).toBe(409);
});
