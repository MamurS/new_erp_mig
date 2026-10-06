/* Contract lifecycle and claims settlement — LIFECYCLE_SPEC §17, e2e scenarios 1–8. */
import { expect, test, type Page } from '@playwright/test';
import { acceptConsent, api, CODE, loginStaff, PASSWORD } from './helpers';

/** Switches the role in the same tab (the same in-page mock DB) through the demo banner. */
async function switchTo(page: Page, label: string, home: RegExp): Promise<void> {
  await page.getByRole('button', { name: 'Войти как…' }).click();
  // The label followed by the login: «Администратор» must not match «Администратор клиники».
  await page.getByRole('menuitem', { name: new RegExp(`^${label} — [a-z0-9.+-]+@`) }).click();
  await expect(page.getByText(`Вы вошли как «${label}»`).last()).toBeVisible();
  await expect(page).toHaveURL(home);
}
const STAFF = /\/staff$/;
const as = {
  sales: (p: Page) => switchTo(p, 'Менеджер по продажам', STAFF),
  underwriter: (p: Page) => switchTo(p, 'Андеррайтер', STAFF),
  uwHead: (p: Page) => switchTo(p, 'Руководитель андеррайтинга', STAFF),
  legal: (p: Page) => switchTo(p, 'Юрист', STAFF),
  accountant: (p: Page) => switchTo(p, 'Бухгалтер', STAFF),
  claims: (p: Page) => switchTo(p, 'Специалист по убыткам', STAFF),
  claimsHead: (p: Page) => switchTo(p, 'Руководитель урегулирования убытков', STAFF),
  hr: (p: Page) => switchTo(p, 'HR клиента', /\/hr$/),
};

async function asInsured(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Войти как…' }).click();
  await page.getByRole('menuitem', { name: /^Застрахованный/ }).click();
  const consent = page.getByRole('checkbox', { name: /согласен/ });
  await expect(consent.or(page.getByRole('link', { name: /Карточка для клиники/ }))).toBeVisible();
  if (await consent.isVisible()) await acceptConsent(page);
}

/** Logs out of the current portal and logs in with an email that is not in «Войти как…». */
async function loginByEmail(page: Page, email: string, home: RegExp): Promise<void> {
  await page.evaluate(() => sessionStorage.removeItem('mig.session'));
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Пароль').fill(PASSWORD);
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await page.getByLabel('Цифра 1').fill(CODE);
  await expect(page).toHaveURL(home);
}

const today = () => new Date(Date.now() + 5 * 3600_000).toISOString().slice(0, 10);
const plusDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const ru = (iso: string) => iso.split('-').reverse().join('.');
const csvFile = (name: string, text: string) => ({ name, mimeType: 'text/csv', buffer: Buffer.from(text, 'utf8') });

/** Puts a deal's KP-accepted contract into «sent» through the API (setup for the signing scenarios). */
async function sentContract(page: Page): Promise<{ id: string; number: string }> {
  const deals = (await api(page, 'GET', '/deals')).data as { id: string; stage: string; kpId?: string; type: string }[];
  const deal = deals.find((d) => d.stage === 'kp_sent' && d.kpId && d.type === 'new')!;
  expect(deal, 'a seeded deal with a sent KP').toBeTruthy();
  expect((await api(page, 'POST', `/kp/${deal.kpId}/accept`)).status).toBe(200);
  const c = (await api(page, 'POST', '/contracts', { dealId: deal.id })).data as { id: string; number: string };
  expect((await api(page, 'POST', `/contracts/${c.id}/submit-legal`)).status).toBe(200);
  expect((await api(page, 'POST', `/contracts/${c.id}/send`)).status).toBe(200);
  return c;
}

/** A small JPEG drawn in the page: the same bytes give the same image hash (duplicate receipt). */
async function receiptJpeg(page: Page, text: string): Promise<Buffer> {
  const b64 = await page.evaluate(async (t) => {
    const c = document.createElement('canvas');
    c.width = 320;
    c.height = 480;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, 320, 480);
    ctx.fillStyle = '#000';
    ctx.font = '20px sans-serif';
    ctx.fillText(t, 20, 60);
    const blob = await new Promise<Blob>((r) => c.toBlob((b) => r(b!), 'image/jpeg', 0.9));
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let s = '';
    for (const x of bytes) s += String.fromCharCode(x);
    return btoa(s);
  }, text);
  return Buffer.from(b64, 'base64');
}

async function sendReceipt(page: Page, file: Buffer): Promise<string> {
  await page.goto('/app/claims/new');
  await page.getByTestId('receipt-input').setInputFiles({ name: 'receipt.jpg', mimeType: 'image/jpeg', buffer: file });
  await expect(page.getByText('Чек распознан')).toBeVisible();
  await page.getByRole('button', { name: 'Лекарства' }).click();
  await page.getByRole('button', { name: 'Продолжить' }).click();
  await page.getByRole('button', { name: 'Отправить' }).click();
  await expect(page).toHaveURL(/\/app\/claims\/[0-9a-f-]{36}$/);
  return page.url().split('/').pop()!;
}

test('1. New client end to end: lead → census → quote above authority → KP accepted → contract with a changed clause → E-IMZO both sides → payment → policy, certificates, app', async ({ page }) => {
  test.setTimeout(300_000);
  const start = today();
  const end = plusDays(start, 364);
  await loginStaff(page, 'sales_manager');

  // Lead
  await page.goto('/staff/deals');
  await expect(page.getByTestId('deals-board')).toBeVisible();
  await page.getByRole('button', { name: 'Новый лид' }).click();
  const lead = page.getByRole('dialog', { name: 'Новый лид' });
  await lead.getByLabel('Название').fill('Полный Путь');
  await lead.getByLabel('ИНН').fill('309876543');
  await lead.getByLabel('Численность, примерно').fill('12');
  await lead.getByLabel('Банк').fill('АКБ «Тест-Банк»');
  await lead.getByLabel('Расчётный счёт').fill('20208000900123456001');
  await lead.getByLabel('МФО').fill('00440');
  await lead.getByLabel('Руководитель').fill('Директоров Директор Директорович');
  await lead.getByLabel('Желаемое начало (ДД.ММ.ГГГГ)').fill(ru(start));
  await lead.getByLabel('Контактное лицо').fill('Кадрова Анна');
  await lead.getByLabel('Телефон контакта').fill('+998 90 765 43 21');
  await lead.getByLabel('Email контакта').fill('hr@full-path.uz');
  await lead.getByRole('button', { name: 'Создать лид' }).click();
  await expect(page).toHaveURL(/\/staff\/deals\/[0-9a-f-]{36}$/);
  const dealId = page.url().split('/').pop()!;

  // Census: anonymous; PII columns are dropped with a warning
  await page.getByRole('button', { name: 'Загрузить данные для оценки' }).click();
  const census = ['fio,gender,birthYear,relation', ...Array.from({ length: 10 }, (_, i) => `Человек ${i},${i % 2 ? 'f' : 'm'},${1975 + i * 3},${i < 8 ? 'employee' : 'child'}`)].join('\n');
  await page.getByLabel('Файл с данными для оценки').setInputFiles(csvFile('census.csv', census));
  await expect(page.getByTestId('census-dropped')).toContainText('fio');
  await expect(page.getByTestId('census-stats')).toContainText('10');

  // Quote: −15% is above the underwriter's 10% → the head of underwriting approves
  await as.underwriter(page);
  await page.goto(`/staff/deals/${dealId}`);
  await page.getByRole('button', { name: 'Рассчитать котировку' }).click();
  await expect(page).toHaveURL(/\/staff\/quotes\/[0-9a-f-]{36}$/);
  const quoteUrl = page.url();
  await page.getByRole('button', { name: 'Добавить' }).click();
  const adj = page.getByTestId('quote-adjustment');
  await adj.getByLabel('Название').fill('Скидка за переход');
  await adj.getByLabel('%').fill('-15');
  await adj.getByLabel('Комментарий').fill('Клиент уходит от другого страховщика');
  await expect(page.getByTestId('quote-authority')).toContainText('выше ваших полномочий');
  await page.getByRole('button', { name: 'Отправить на согласование' }).click();
  await expect(page.getByText('На согласовании').first()).toBeVisible();

  await as.uwHead(page);
  await page.goto(quoteUrl);
  await page.getByRole('button', { name: 'Согласовать' }).click();
  await page.getByRole('dialog', { name: 'Согласовать котировку' }).getByRole('button', { name: 'Согласовать' }).click();
  await expect(page.getByText('Утверждена').first()).toBeVisible();

  // KP from the approved quote; the client's HR accepts it
  await as.sales(page);
  await page.goto(`/staff/deals/${dealId}`);
  await page.getByRole('button', { name: 'Отправить КП' }).click();
  await expect(page.getByText('КП у клиента')).toBeVisible();
  const kpId = ((await api(page, 'GET', `/deals/${dealId}`)).data as { kp: { id: string } }).kp.id;

  await loginByEmail(page, 'hr@full-path.uz', /\/hr$/);
  await page.goto(`/hr/kp/${kpId}`);
  await page.getByTestId('kp-respond').getByRole('button', { name: 'Принять' }).click();
  await expect(page.getByText('КП принято').first()).toBeVisible();

  // Contract: dates, a changed clause, Appendix 2; the lawyer approves
  await as.sales(page);
  await page.goto(`/staff/deals/${dealId}`);
  await page.getByRole('button', { name: 'Подготовить договор' }).click();
  await expect(page).toHaveURL(/\/staff\/contracts\/[0-9a-f-]{36}$/);
  const contractUrl = page.url();
  const contractId = contractUrl.split('/').pop()!;
  await page.getByLabel('Начало').fill(start);
  await page.getByLabel('Окончание').fill(end);
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(page.getByText('Параметры сохранены')).toBeVisible();
  await page.getByRole('button', { name: 'Изменить формулировку пункта 4.4' }).click();
  const clause = page.getByRole('dialog', { name: /Пункт 4\.4/ });
  await clause.getByLabel('Формулировка').fill('Период ожидания для плановой стоматологии — 30 дней с даты включения.');
  await clause.getByRole('button', { name: 'Сохранить формулировку' }).click();
  await expect(page.getByTestId('clause-4.4')).toContainText('Исходный текст');
  // Appendix 2: a row per person, the family member with the relation and the employee's PINFL.
  const list = [
    'fullName,birthDate,pinfl,phone,position,relation,principal_pinfl',
    'Путев Первый Петрович,15.03.1990,31503901234567,+998907770011,Инженер,,',
    'Путева Вторая Ивановна,01.07.1988,30107881234568,+998907770012,Бухгалтер,,',
    'Путев Младший Первович,12.12.2015,31212151234569,,,child,31503901234567',
  ].join('\n');
  await page.getByLabel('Файл приложения 2').setInputFiles(csvFile('list.csv', list));
  await expect(page.getByText('Приложение 2 загружено')).toBeVisible();
  await page.getByRole('button', { name: 'Отправить на согласование' }).click();
  await expect(page.getByText('У юриста').first()).toBeVisible();

  await as.legal(page);
  await page.goto(contractUrl);
  await page.getByRole('button', { name: 'Согласовать' }).click();
  await page.getByRole('dialog', { name: 'Согласовать договор' }).getByRole('button', { name: 'Согласовать' }).click();
  await expect(page.getByText('Согласован').first()).toBeVisible();

  await as.sales(page);
  await page.goto(contractUrl);
  await page.getByRole('button', { name: 'Отправить клиенту' }).click();
  await expect(page.getByText('Отправлен клиенту').first()).toBeVisible();

  // Signing: MIG's signatory and the client's HR, both with E-IMZO
  await as.uwHead(page);
  await page.goto(contractUrl);
  await page.getByRole('button', { name: 'Подписать ЭЦП за МИГ' }).click();
  const key = page.getByRole('dialog', { name: 'Выберите ключ ЭЦП' });
  await key.getByLabel('Пароль ключа').fill('demo');
  await key.getByRole('button', { name: 'Подписать' }).click();
  await expect(page.getByTestId('sign-mig')).toContainText('Подписано');

  await loginByEmail(page, 'hr@full-path.uz', /\/hr$/);
  await page.goto(`/hr/contracts/${contractId}`);
  await page.getByRole('button', { name: 'Подписать ЭЦП' }).click();
  const hrKey = page.getByRole('dialog', { name: 'Выберите ключ ЭЦП' });
  await hrKey.getByLabel('Пароль ключа').fill('demo');
  await hrKey.getByRole('button', { name: 'Подписать' }).click();
  await expect(page.getByTestId('sign-client')).toContainText('Подписано');

  // Payment of the first installment → the contract comes into force
  await as.accountant(page);
  await page.goto('/staff/invoices?status=unpaid,overdue');
  const row = page.getByRole('row').filter({ hasText: 'Полный Путь' }).first();
  await row.getByRole('button', { name: 'Оплата' }).click();
  await page.getByRole('dialog', { name: /Оплата по счёту/ }).getByRole('button', { name: 'Отметить оплату' }).click();
  await expect(page.getByText('Оплата отмечена')).toBeVisible();
  const contract = (await api(page, 'GET', `/contracts/${contractId}`)).data as { status: string; policyId?: string };
  expect(contract.status).toBe('active');
  const certs = (await api(page, 'GET', `/policies/${contract.policyId}/certificates`)).data as { certificateNumber: string; fullName: string }[];
  // A certificate for every person of Appendix 2, the child included.
  expect(certs).toHaveLength(3);
  expect(certs[0]!.certificateNumber).toMatch(/^SERT-\d{4}-\d{6}-0001$/);

  // The insured person logs in with the phone from Appendix 2 and sees the certificate
  await page.evaluate(() => sessionStorage.removeItem('mig.session'));
  await page.goto('/app/login');
  await page.getByLabel(/Номер телефона/).fill('907770011');
  await page.getByRole('button', { name: 'Получить код' }).click();
  await page.getByLabel('Цифра 1').fill(CODE);
  await acceptConsent(page);
  await page.goto('/app/profile');
  await page.getByRole('link', { name: 'Мой сертификат' }).click();
  await expect(page.getByTestId('my-certificate-number')).toHaveText(certs.find((c) => c.fullName.startsWith('Путев Первый'))!.certificateNumber);
});

test('2. Paper: print, «Подписано МИГ», the client scan is verified, the contract is signed, the original is received', async ({ page }) => {
  test.setTimeout(120_000);
  await loginStaff(page, 'sales_manager');
  const c = await sentContract(page);

  await as.uwHead(page);
  await page.goto(`/staff/contracts/${c.id}`);
  await expect(page.getByRole('button', { name: 'Распечатать два экземпляра' })).toBeVisible();
  await page.getByRole('button', { name: 'Подписано МИГ' }).click();
  await expect(page.getByTestId('sign-mig')).toContainText('Бумага');
  await expect(page.getByTestId('paper-original')).toBeVisible();

  await as.sales(page);
  await page.goto(`/staff/contracts/${c.id}`);
  await page.getByRole('button', { name: 'Отправлено клиенту' }).click();
  await expect(page.getByTestId('paper-original')).toContainText('Экземпляр МИГ отправлен клиенту: ' + ru(today()));
  const scan = await receiptJpeg(page, 'SIGNED CONTRACT');
  await page.getByLabel('Файл скана подписанного документа').setInputFiles({ name: 'scan.jpg', mimeType: 'image/jpeg', buffer: scan });
  await expect(page.getByTestId('sign-client')).toContainText('Скан на проверке');
  await page.getByRole('button', { name: 'Скан проверен' }).click();
  await expect(page.getByTestId('sign-client')).toContainText('Подписано');
  await expect(page.getByText('Подписан').first()).toBeVisible();
  await page.getByRole('button', { name: 'Оригинал клиента получен' }).click();
  await expect(page.getByTestId('paper-original')).toContainText('Оригинал клиента получен: ' + ru(today()));
});

test('3. EDO: sending through the operator, the signing event arrives, the contract is signed', async ({ page }) => {
  await loginStaff(page, 'sales_manager');
  const c = await sentContract(page);
  await as.uwHead(page);
  await page.goto(`/staff/contracts/${c.id}`);
  await page.getByRole('button', { name: 'Отправить через ЭДО' }).click();
  const dialog = page.getByRole('dialog', { name: 'Отправить через ЭДО' });
  await dialog.getByLabel('Оператор ЭДО').selectOption('Didox');
  await dialog.getByRole('button', { name: 'Отправить' }).click();
  await expect(page.getByTestId('sign-client')).toContainText('Ждём ЭДО');
  // The demo operator answers in 3 seconds; the page polls.
  await expect(page.getByTestId('sign-client')).toContainText('Подписано', { timeout: 15_000 });
  await expect(page.getByTestId('sign-client')).toContainText('Didox');
  await expect(page.getByText('Подписан').first()).toBeVisible();
});

test('4. HR adds and excludes employees → monthly endorsement with the formulas → signed by scan → invoice or refund', async ({ page }) => {
  test.setTimeout(180_000);
  await loginStaff(page, 'hr');
  const startDate = plusDays(today(), 1);
  await page.goto('/hr/employees/new');
  await page.getByLabel('ФИО').fill('Новиков Новый Новикович');
  await page.getByLabel('Дата рождения').fill('15031991');
  await page.getByLabel('ПИНФЛ').fill('31503917654321');
  await page.getByLabel('Телефон').fill('901239876');
  await page.getByLabel('Должность').fill('Аналитик');
  await page.getByLabel('Дата начала страхования').fill(ru(startDate).replace(/\./g, ''));
  await page.getByRole('button', { name: 'Добавить сотрудника' }).click();
  await expect(page.getByText(/Заявка отправлена в МИГ/)).toBeVisible();
  await page.goto('/hr?filter=not_in_app');
  const row = page.getByRole('row').filter({ has: page.getByRole('button', { name: 'Действия с сотрудником' }) }).first();
  const leaver = (await row.locator('p.font-semibold').first().innerText()).trim();
  await row.getByRole('button', { name: 'Действия с сотрудником' }).click();
  await page.getByRole('menuitem', { name: 'Исключить с даты…' }).click();
  await page.getByRole('button', { name: 'Отправить заявку' }).click();
  await expect(page.getByText('Заявка на исключение отправлена в МИГ')).toBeVisible();

  // The underwriter approves both requests (POLICY_SPEC): they become change requests of the contract.
  await as.underwriter(page);
  await page.goto('/staff/policy-changes');
  for (const name of ['Новиков Новый Новикович', leaver]) {
    await page.getByRole('button', { name: `Действия: ${name}` }).click();
    await page.getByRole('menuitem', { name: 'Подтвердить' }).click();
    await expect(page.getByText(/Подтверждено заявок: 1/).last()).toBeVisible();
  }

  // The manager forms the endorsement of the month: every line follows its formula.
  await as.sales(page);
  await page.goto('/staff/endorsements');
  await page.getByTestId('pending-requests').getByRole('button', { name: 'Сформировать ДС' }).first().click();
  await expect(page).toHaveURL(/\/staff\/endorsements\/[0-9a-f-]{36}$/);
  const endorsementId = page.url().split('/').pop()!;
  const e = (await api(page, 'GET', `/endorsements/${endorsementId}`)).data as { contractId: string; total: number; lines: { description: string; days: number; amount: number; formula: string }[] };
  const contract = (await api(page, 'GET', `/contracts/${e.contractId}`)).data as { params: { startDate: string; endDate: string; premiumEmployee: number } };
  const term = Math.round((Date.parse(contract.params.endDate) - Date.parse(contract.params.startDate)) / 86_400_000) + 1;
  const added = e.lines.find((l) => l.description.includes('Новиков'))!;
  expect(added.amount).toBe(Math.round((contract.params.premiumEmployee * added.days) / term));
  expect(added.days).toBe(Math.round((Date.parse(contract.params.endDate) - Date.parse(startDate)) / 86_400_000) + 1);
  expect(e.lines.some((l) => l.description.startsWith('Исключение') && l.amount <= 0)).toBe(true);
  expect(e.total).toBe(e.lines.reduce((s, l) => s + l.amount, 0));
  // The line names the contract's pricing rule (the demo contract prices inclusions by type).
  const g = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  await expect(page.getByTestId('endorsement-lines')).toContainText(`по типу: premium_employee ${g(contract.params.premiumEmployee)} × ${added.days} / ${term} = ${g(added.amount)}`);

  await page.getByRole('button', { name: 'Отправить на согласование' }).click();
  await expect(page.getByText('Согласовано').first()).toBeVisible();
  await page.getByRole('button', { name: 'Отправить клиенту' }).click();
  await expect(page.getByText('Отправлено клиенту').first()).toBeVisible();

  // Scans of both sides, verified by the manager
  for (const [side, id] of [['МИГ', 'sign-mig'], ['клиента', 'sign-client']] as const) {
    await page.getByLabel('Чей скан').selectOption({ label: side });
    await page.getByLabel('Файл скана подписанного документа').setInputFiles({ name: 'scan.jpg', mimeType: 'image/jpeg', buffer: await receiptJpeg(page, `SCAN ${side}`) });
    await expect(page.getByTestId(id)).toContainText('Скан на проверке');
    await page.getByRole('button', { name: 'Скан проверен' }).click();
    await expect(page.getByTestId(id)).toContainText('Подписано');
  }
  await expect(page.getByTestId('endorsement-result')).toBeVisible();
  const invoices = (await api(page, 'GET', `/invoices?contractId=${e.contractId}`)).data as { endorsementId?: string; amount: number }[];
  if (e.total > 0) expect(invoices.find((i) => i.endorsementId === endorsementId)?.amount).toBe(e.total);
  else await expect(page.getByTestId('endorsement-result')).toContainText('Документ на возврат');

  // The new employee is covered from the date of the HR request
  await as.hr(page);
  const employees = (await api(page, 'GET', '/hr/employees?q=Новиков&pageSize=10')).data as { items: { fullName: string; insuredFrom: string; status: string }[] };
  expect(employees.items.find((x) => x.fullName === 'Новиков Новый Новикович')).toMatchObject({ insuredFrom: startDate, status: 'active' });
});

test('5. Above authority goes to the head; refusal needs a clause; the insured sees the reason and appeals', async ({ page }) => {
  test.setTimeout(180_000);
  // (a) approval above claims@'s authority waits for claims-head@
  await loginStaff(page, 'claims_officer');
  const big = ((await api(page, 'GET', '/claims?tab=review&pageSize=100')).data as { items: { id: string; number: string; amountClaimed: number }[] }).items.find((c) => c.amountClaimed > 5_000_000)!;
  expect(big).toBeTruthy();
  await page.goto(`/staff/claims/${big.id}`);
  const form = page.getByTestId('decision-form');
  await form.getByLabel('Одобрено полностью').check();
  await expect(form).toContainText('решение уйдёт на согласование');
  await form.getByRole('button', { name: 'Отправить на согласование' }).click();
  await expect(page.getByTestId('pending-decision')).toBeVisible();

  await as.claimsHead(page);
  await page.goto('/staff/claims?tab=above');
  await page.getByRole('row').filter({ hasText: big.number }).click();
  await expect(page).toHaveURL(new RegExp(`/staff/claims/${big.id}$`));
  await page.getByTestId('pending-decision').getByRole('button', { name: 'Согласовать' }).click();
  await expect(page.getByTestId('claim-decision')).toContainText('Одобрено полностью');
  await expect(page.getByTestId('claim-decision')).toContainText('согласовал');

  // (b) the insured sends a receipt; the officer cannot refuse without a clause
  await asInsured(page);
  const claimId = await sendReceipt(page, await receiptJpeg(page, `RECEIPT ${Date.now()}`));
  await as.claims(page);
  await page.goto(`/staff/claims/${claimId}`);
  const f = page.getByTestId('decision-form');
  await f.getByLabel('Отказано').check();
  await f.getByLabel('Причина простым языком').fill('Препарат не входит в программу страхования');
  await f.getByRole('button', { name: 'Принять решение' }).click();
  await expect(f).toContainText('укажите пункт договора');
  await expect(page.getByTestId('claim-decision')).toHaveCount(0);
  await f.getByLabel('Пункт договора').selectOption({ label: 'п. 4.3 договора «Исключения из страхового покрытия»' });
  await f.getByRole('button', { name: 'Принять решение' }).click();
  await expect(page.getByTestId('claim-decision')).toContainText('Основание: п. 4.3 договора');

  // (c) the insured sees the reason and the clause and appeals
  await asInsured(page);
  await page.goto(`/app/claims/${claimId}`);
  await expect(page.getByText('Препарат не входит в программу страхования')).toBeVisible();
  await expect(page.getByTestId('claim-clause')).toContainText('п. 4.3');
  await page.getByRole('button', { name: 'Оспорить решение' }).click();
  await page.getByLabel('С чем вы не согласны').fill('Врач назначил этот препарат по основному диагнозу');
  await page.getByRole('button', { name: 'Отправить' }).click();
  await expect(page.getByTestId('appeal-status')).toContainText('Апелляция на рассмотрении');

  await as.claims(page);
  const res = await api(page, 'GET', '/claims?tab=appeals&pageSize=100');
  expect(res.status, JSON.stringify(res.data).slice(0, 300)).toBe(200);
  const appeals = res.data as { items: { id: string; number: string }[] };
  const mine = appeals.items.find((c) => c.id === claimId)!;
  expect(mine).toBeTruthy();
  await page.goto('/staff/claims?tab=appeals');
  await expect(page.getByRole('row').filter({ hasText: mine.number })).toBeVisible();
});

test('6. Duplicate receipt: the second identical receipt is flagged; the flag is dismissed only with a comment', async ({ page }) => {
  test.setTimeout(120_000);
  await loginStaff(page, 'claims_officer');
  await asInsured(page);
  const file = await receiptJpeg(page, `DUP ${Date.now()}`);
  await sendReceipt(page, file);
  const second = await sendReceipt(page, file);

  await as.claims(page);
  await page.goto(`/staff/claims/${second}`);
  const flag = page.getByTestId('flag').filter({ hasText: 'Повтор чека' });
  await expect(flag).toBeVisible();
  // The server recognized fiscal data from the photo: the match is by the fiscal sign (or amount, date and point).
  await expect(flag).toContainText(/Фискальный номер чека совпадает|Та же сумма, дата и точка продажи/);
  await expect(flag).toContainText('изображение чека тоже совпадает');
  await expect(page.getByTestId('receipt-fiscal')).toContainText(/ИНН точки продажи\s*\d{9}/);
  await flag.getByRole('button', { name: 'Снять флаг' }).click();
  const dialog = page.getByRole('dialog', { name: 'Снять флаг' });
  await dialog.getByRole('button', { name: 'Снять флаг' }).click();
  await expect(dialog.getByText('Комментарий обязателен: минимум 5 символов')).toBeVisible();
  await dialog.getByLabel('Комментарий').fill('Это второй экземпляр того же чека: выплата одна');
  await dialog.getByRole('button', { name: 'Снять флаг' }).click();
  await expect(flag).toContainText('Снят');
  await expect(flag).toContainText('Это второй экземпляр того же чека');
});

test('7. The reserves report on a date equals the sum of open reserves', async ({ page }) => {
  await loginStaff(page, 'claims_officer');
  let sum = 0;
  let seen = 0;
  for (let p = 1; ; p++) {
    const list = (await api(page, 'GET', `/claims?pageSize=100&page=${p}`)).data as { items: { reserve?: number }[]; total: number };
    sum += list.items.reduce((s, c) => s + (c.reserve ?? 0), 0);
    seen += list.items.length;
    if (!list.items.length || seen >= list.total) break;
  }
  expect(sum).toBeGreaterThan(0);
  const res = await api(page, 'GET', `/reports/reserves?date=${today()}`);
  expect(res.status, JSON.stringify(res.data)).toBe(200);
  const report = res.data as { total: number; byClient: { reserve: number }[] };
  expect(report.total).toBe(sum);
  expect(report.byClient.reduce((s, r) => s + r.reserve, 0)).toBe(sum);
  await page.goto('/staff/reports/reserves');
  await expect(page.getByTestId('reserve-total')).toHaveText(new RegExp(String(sum).replace(/\B(?=(\d{3})+(?!\d))/g, '\\s')));
});

test('8. Rights: the manager cannot approve a quote or sign for MIG; the lawyer sees no claims', async ({ page }) => {
  await loginStaff(page, 'sales_manager');
  const deals = (await api(page, 'GET', '/deals')).data as { quoteId?: string; quoteStatus?: string }[];
  const pending = deals.find((d) => d.quoteStatus === 'pending_approval')!;
  await page.goto(`/staff/quotes/${pending.quoteId}`);
  await expect(page.getByText('На согласовании').first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Согласовать' })).toHaveCount(0);
  expect((await api(page, 'POST', `/quotes/${pending.quoteId}/approve`, {})).status).toBe(403);

  const contracts = (await api(page, 'GET', '/contracts?status=signing')).data as { id: string; signing: { mig?: unknown } }[];
  const c = contracts[0]!;
  await page.goto(`/staff/contracts/${c.id}`);
  await expect(page.getByTestId('sign-mig')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Подписать ЭЦП за МИГ' })).toHaveCount(0);
  expect((await api(page, 'POST', `/contracts/${c.id}/sign`, { side: 'mig', method: 'paper' })).status).toBe(403);

  await as.legal(page);
  await page.goto('/staff/claims');
  await expect(page).toHaveURL(/\/403$/);
  expect((await api(page, 'GET', '/claims')).status).toBe(403);
});
