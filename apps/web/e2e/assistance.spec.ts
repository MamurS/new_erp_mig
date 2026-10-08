/* Assistance companies — ASSISTANCE_SPEC §14, e2e scenarios 1–8. */
import { expect, test, type Page } from '@playwright/test';
import { acceptConsent, api, failOnDialog, loginStaff, logoutFromSidebar } from './helpers';

/** Switch the role in the same tab (and the same in-page mock DB) through the demo banner. */
async function switchTo(page: Page, role: RegExp, home: RegExp): Promise<void> {
  await page.getByRole('button', { name: 'Войти как…' }).click();
  await page.getByRole('menuitem', { name: role }).click();
  // Roles of one portal share the home page: wait for the new session, not only for the URL.
  await expect(page.getByText(`Вы вошли как «${role.source.replace(/^\^/, '')}`).last()).toBeVisible();
  await expect(page).toHaveURL(home);
}
const AS = {
  asstOperator: [/^Оператор ассистанса/, /\/assist$/],
  asstDoctor: [/^Врач ассистанса/, /\/assist$/],
  asstBilling: [/^Финансист ассистанса/, /\/assist$/],
  asstAdmin: [/^Администратор ассистанса/, /\/assist$/],
  registrar: [/^Регистратор клиники/, /\/clinic$/],
  clinicAdmin: [/^Администратор клиники/, /\/clinic$/],
  doctor: [/^Врач-эксперт/, /\/staff$/],
  operator: [/^Куратор ДМС/, /\/staff$/],
  accountant: [/^Бухгалтер/, /\/staff$/],
  underwriter: [/^Андеррайтер/, /\/staff$/],
  // Rebills are reviewed by the claims officer since LIFECYCLE_SPEC §14.
  claims: [/^Специалист по убыткам/, /\/staff$/],
} as const satisfies Record<string, readonly [RegExp, RegExp]>;
const as = (page: Page, who: keyof typeof AS) => switchTo(page, AS[who][0], AS[who][1]);

async function asInsured(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Войти как…' }).click();
  await page.getByRole('menuitem', { name: /^Застрахованный/ }).click();
  // Consent is asked only on the first login of the demo insured person in this tab.
  const consent = page.getByRole('checkbox', { name: /согласен/ });
  const home = page.getByRole('link', { name: /Карточка для клиники/ });
  await expect(consent.or(home)).toBeVisible();
  if (await consent.isVisible()) await acceptConsent(page);
}

/** Logs out through the user menu and logs in with email + password + code (accounts outside «Войти как…»). */
async function loginByEmail(page: Page, email: string): Promise<void> {
  await logoutFromSidebar(page);
  await expect(page).toHaveURL(/\/login/);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Пароль').fill('Demo-2026!');
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await page.getByLabel('Цифра 1').fill('000000');
  // The login returns to the last page of the portal (`next`).
  await expect(page).toHaveURL(/\/assist(\/.*)?$/);
  await expect(page.getByTestId('sidebar').getByRole('button', { name: 'Меню пользователя' })).toBeVisible();
}

const pad = (n: number) => String(n).padStart(2, '0');
/** `YYYY-MM-DDTHH:mm` in Tashkent time, `days` from today. */
function localDateTime(days: number, h: number, m: number): string {
  const d = new Date(Date.now() + days * 86_400_000 + 5 * 3600_000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(h)}:${pad(m)}`;
}
const today = () => new Date(Date.now() + 5 * 3600_000).toISOString().slice(0, 10);

/** Opens a visit for a patient in the demo clinic: the demo insured (assistance 1) or a client of MIG. */
async function openVisit(page: Page, who: 'demo' | 'mig' = 'demo'): Promise<string> {
  const code = ((await api(page, 'POST', `/__demo/mis-card${who === 'mig' ? '?who=mig' : ''}`)).data as { shortCode: string }).shortCode;
  const r = await api(page, 'POST', '/clinic/check', { qrToken: code });
  expect(r.status).toBe(200);
  return (r.data as { visitId: string }).visitId;
}


test('1. Call: the operator finds the insured, creates a case and an appointment; the app shows it, the clinic confirms', async ({ page }) => {
  failOnDialog(page);
  await loginStaff(page, 'clinic_registrar');
  const clinicId = await page.evaluate(() => (JSON.parse(sessionStorage.getItem('mig.session')!) as { user: { clinicId: string } }).user.clinicId);
  // The name of the demo insured person, as the caller says it.
  await asInsured(page);
  const fullName = ((await api(page, 'GET', '/me')).data as { fullName: string }).fullName;

  await as(page, 'asstOperator');
  await page.goto('/assist/insured');
  await page.getByRole('searchbox', { name: 'Поиск застрахованного' }).fill(fullName.split(' ')[0]!);
  await page.getByRole('row', { name: new RegExp(fullName) }).first().click();
  await expect(page.getByRole('heading', { name: fullName })).toBeVisible();
  await expect(page.getByTestId('masked-pinfl')).toBeVisible();
  expect(await page.locator('main').innerText()).not.toMatch(/\d{14}/);

  await page.getByRole('button', { name: 'Новое обращение' }).click();
  await page.getByRole('dialog').getByLabel('Суть обращения').fill('Просит записать к терапевту');
  await page.getByRole('dialog').getByRole('button', { name: 'Создать обращение' }).click();
  await expect(page).toHaveURL(/\/assist\/cases\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { name: /Обращение OBR-\d{4}-\d{6}/ })).toBeVisible();

  await page.getByRole('button', { name: 'Записать к врачу' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Клиника').selectOption(clinicId);
  await dialog.getByLabel('Врач').selectOption('therapist');
  await dialog.getByLabel('Дата и время').fill(localDateTime(3, 17, 40));
  await dialog.getByRole('button', { name: 'Записать' }).click();
  await expect(page.getByText('Заявка отправлена в клинику')).toBeVisible();

  await asInsured(page);
  const mine = (await api(page, 'GET', '/me/appointments')).data as { id: string; clinicId: string; clinicName: string; status: string }[];
  const booked = mine.find((a) => a.clinicId === clinicId && a.status === 'requested');
  expect(booked, 'the insured sees the appointment').toBeTruthy();
  await page.goto('/app/appointments');
  await expect(page.getByText(booked!.clinicName).first()).toBeVisible();

  await as(page, 'registrar');
  expect((await api(page, 'POST', `/clinic/appointments/${booked!.id}/confirm`)).status).toBe(200);
  await asInsured(page);
  await page.goto('/app/appointments');
  await expect(page.getByTestId('appt-confirmed-by').filter({ hasText: 'Подтвердила клиника' }).first()).toBeVisible();
});

test('2. Guarantees: within authority the assistance doctor decides; above it escalates, the MIG doctor approves, the clinic sees it', async ({ page }) => {
  failOnDialog(page);
  await loginStaff(page, 'asst_doctor');
  await page.goto('/assist/guarantees');
  await expect(page.getByRole('heading', { name: 'Гарантийные письма' })).toBeVisible();
  // A seeded request within the authority limit.
  const within = ((await api(page, 'GET', '/assist/guarantees?status=requested')).data as { id: string; number: string; estimatedCost: number; escalated?: boolean }[]).find((g) => !g.escalated && g.estimatedCost <= 10_000_000)!;
  await page.getByRole('row', { name: new RegExp(within.number) }).click();
  await page.getByRole('button', { name: 'Одобрить' }).click();
  await expect(page.getByText('Письмо одобрено, лимит зарезервирован')).toBeVisible();

  // The clinic asks for an expensive service: above the authority of the assistance.
  await as(page, 'clinicAdmin');
  const visitId = await openVisit(page);
  const prices = (await api(page, 'GET', '/clinic/price-list')).data as { code: string; price: number; requiresGuarantee: boolean }[];
  const costly = prices.filter((p) => p.requiresGuarantee).sort((a, b) => b.price - a.price)[0]!;
  const g = (await api(page, 'POST', '/clinic/guarantees', { visitId, serviceCode: costly.code, icd10: 'K80.2', estimatedCost: 15_000_000 })).data as { id: string; number: string };

  await as(page, 'asstDoctor');
  await page.goto(`/assist/guarantees/${g.id}`);
  await expect(page.getByTestId('over-authority')).toBeVisible();
  await page.getByLabel('Заключение врача для МИГ').fill('Показана плановая операция, сумма выше полномочий ассистанса');
  await page.getByRole('button', { name: 'Передать в МИГ' }).click();
  await expect(page.getByText('Письмо передано на решение в МИГ')).toBeVisible();

  await as(page, 'doctor');
  await page.goto('/staff/guarantees');
  await page.getByRole('row', { name: new RegExp(g.number) }).click();
  await expect(page.getByTestId('assistance-opinion')).toContainText('Показана плановая операция');
  await page.getByRole('dialog').getByRole('button', { name: 'Одобрить' }).click();
  await expect(page.getByText('Письмо одобрено')).toBeVisible();

  await as(page, 'registrar');
  await page.goto('/clinic/guarantees');
  const row = page.getByRole('row', { name: new RegExp(g.number) });
  await expect(row).toContainText('Одобрено');
  await expect(row).toContainText('МИГ (эскалация от');
});

test('3. Limit: an approved letter lowers what is left in the app; the accepted line makes it final and releases the reserve', async ({ page }) => {
  // A multi-role scenario (several logins): ~40–55 s locally, over 60 s on a loaded CI runner.
  test.setTimeout(120_000);
  failOnDialog(page);
  await loginStaff(page, 'clinic_admin');
  const visitId = await openVisit(page);
  const prices = (await api(page, 'GET', '/clinic/price-list')).data as { code: string; price: number; requiresGuarantee: boolean; category: string }[];
  const svc = prices.find((p) => p.requiresGuarantee && p.category === 'diagnostics_advanced')!;
  const g = (await api(page, 'POST', '/clinic/guarantees', { visitId, serviceCode: svc.code, icd10: 'G43.9', estimatedCost: svc.price })).data as { id: string; number: string };

  await asInsured(page);
  const before = ((await api(page, 'GET', '/me/limits')).data as { category: string; limit: number; used: number; reserved?: number }[]).find((l) => l.category === 'outpatient')!;

  await as(page, 'asstDoctor');
  // The clinic bills this assistance at the price of their own contract.
  const clinics = (await api(page, 'GET', '/assist/clinics')).data as { ownPrices: boolean; priceList: { code: string; price: number }[] }[];
  const contractPrice = clinics.find((c) => c.ownPrices)!.priceList.find((p) => p.code === svc.code)!.price;
  const approved = await api(page, 'POST', `/assist/guarantees/${g.id}/decision`, { action: 'approve', amount: svc.price, validUntil: '2030-01-01' });
  expect(approved.status).toBe(200);

  await asInsured(page);
  await expect(page.getByTestId('limit-reserved-outpatient')).toBeVisible();
  const mid = ((await api(page, 'GET', '/me/limits')).data as { category: string; used: number; reserved?: number }[]).find((l) => l.category === 'outpatient')!;
  expect(mid.reserved).toBe((before.reserved ?? 0) + svc.price);

  await as(page, 'clinicAdmin');
  const period = today().slice(0, 7);
  const draft = (await api(page, 'POST', '/clinic/registries/build', { period })).data as { id: string; lines: { id: string }[] };
  for (const l of draft.lines) await api(page, 'DELETE', `/clinic/registries/${draft.id}/lines/${l.id}`);
  const visitPrice = ((await api(page, 'GET', `/clinic/price-list?visitId=${visitId}`)).data as { code: string; price: number }[]).find((p) => p.code === svc.code)!.price;
  expect(visitPrice).toBe(contractPrice);
  const added = await api(page, 'POST', `/clinic/registries/${draft.id}/lines`, { visitId, serviceDate: today(), serviceCode: svc.code, icd10: 'G43.9', quantity: 1, price: visitPrice, guaranteeNumber: g.number });
  expect(added.status).toBe(200);
  expect((await api(page, 'POST', `/clinic/registries/${draft.id}/submit`)).status).toBe(200);

  await as(page, 'asstDoctor');
  await page.goto(`/assist/registries/${draft.id}`);
  await page.getByRole('button', { name: /^Принять строку/ }).first().click();
  await expect(page.getByText('Строка принята: лимит списан')).toBeVisible();

  await asInsured(page);
  const after = ((await api(page, 'GET', '/me/limits')).data as { category: string; used: number; reserved?: number }[]).find((l) => l.category === 'outpatient')!;
  expect(after.reserved ?? 0).toBe(before.reserved ?? 0);
  expect(after.used).toBe(before.used + contractPrice);
});

test('4. One registry of two payers is split: the assistance sees its lines, MIG only lines of clients without one', async ({ page }) => {
  failOnDialog(page);
  await loginStaff(page, 'clinic_admin');
  const demoVisit = await openVisit(page, 'demo');
  const migVisit = await openVisit(page, 'mig');
  const period = today().slice(0, 7);
  const draft = (await api(page, 'POST', '/clinic/registries/build', { period })).data as { id: string; lines: { id: string }[] };
  for (const l of draft.lines) await api(page, 'DELETE', `/clinic/registries/${draft.id}/lines/${l.id}`);
  for (const visitId of [demoVisit, migVisit]) {
    // Each patient is billed at the prices of their payer.
    const price = ((await api(page, 'GET', `/clinic/price-list?visitId=${visitId}`)).data as { code: string; price: number }[]).find((p) => p.code === 'TH-101')!.price;
    const r = await api(page, 'POST', `/clinic/registries/${draft.id}/lines`, { visitId, serviceDate: today(), serviceCode: 'TH-101', icd10: 'J06.9', quantity: 1, price });
    expect(r.status).toBe(200);
  }
  expect((await api(page, 'POST', `/clinic/registries/${draft.id}/submit`)).status).toBe(200);
  await page.goto(`/clinic/registries/${draft.id}`);
  await expect(page.getByTestId('line-payer')).toHaveCount(2);
  const payers = await page.getByTestId('line-payer').allInnerTexts();
  expect(new Set(payers).size).toBe(2);
  expect(payers).toContain('МИГ');

  await as(page, 'asstDoctor');
  await page.goto(`/assist/registries/${draft.id}`);
  await expect(page.getByRole('heading', { level: 1 })).toContainText(period);
  await expect(page.getByRole('button', { name: /^Принять строку/ })).toHaveCount(1);

  await as(page, 'operator');
  await page.goto(`/staff/registries/${draft.id}`);
  await expect(page.getByRole('button', { name: /^Принять строку/ })).toHaveCount(1);
  const mig = (await api(page, 'GET', `/registries/${draft.id}`)).data as { lines: { payer: string }[] };
  expect(mig.lines.every((l) => l.payer === 'mig')).toBe(true);
});

test('5. Rebill: the assistance pays the clinic, bills MIG; the claims officer rejects, the assistance disputes, the claims officer accepts, the accountant pays', async ({ page }) => {
  // A multi-role scenario (several logins): ~40–55 s locally, over 60 s on a loaded CI runner.
  test.setTimeout(120_000);
  failOnDialog(page);
  await loginStaff(page, 'asst_doctor');
  // A registry of another clinic waits for review: the doctor accepts the lines of the assistance.
  const regs = (await api(page, 'GET', '/assist/registries')).data as { id: string; pendingCount: number }[];
  const reg = regs.find((r) => r.pendingCount > 0)!;
  const view = (await api(page, 'GET', `/assist/registries/${reg.id}`)).data as { lines: { id: string; status: string }[] };
  for (const l of view.lines.filter((x) => x.status === 'pending')) await api(page, 'POST', `/assist/registries/${reg.id}/lines/${l.id}/decision`, { decision: 'accept' });

  await as(page, 'asstBilling');
  await page.goto(`/assist/registries/${reg.id}`);
  await page.getByRole('button', { name: /^Оплатить все принятые/ }).click();
  await page.getByRole('dialog').getByLabel('Номер платёжного поручения').fill('PP-20931');
  await page.getByRole('dialog').getByRole('button', { name: 'Отметить оплату' }).click();
  await expect(page.getByTestId('line-paid').first()).toBeVisible();

  await page.goto('/assist/rebills');
  await page.getByRole('button', { name: /Обновить черновик счёт за|Сформировать счёт за/ }).click();
  await expect(page).toHaveURL(/\/assist\/rebills\/[0-9a-f-]{36}$/);
  await expect(page.getByTestId('fee-formula')).toContainText('застрахованных × 15 000 UZS');
  const rebillUrl = page.url();
  const number = (await page.getByRole('heading', { level: 1 }).innerText()).match(/SChA-[^\s]+/)![0];
  await page.getByRole('button', { name: 'Отправить в МИГ' }).click();
  await page.getByRole('dialog', { name: 'Отправить счёт в МИГ?' }).getByRole('button', { name: 'Отправить' }).click();
  await expect(page.getByTestId('rebill-status')).toContainText('Отправлен');
  const rebillId = rebillUrl.split('/').pop()!;

  await as(page, 'claims');
  await page.goto(`/staff/rebills/${rebillId}`);
  await expect(page.getByRole('heading', { level: 1 })).toContainText(number);
  await page.getByRole('button', { name: /^Отклонить строку/ }).first().click();
  await page.getByRole('dialog').getByLabel('Причина').fill('Нет подтверждения оплаты клинике');
  await page.getByRole('dialog').getByRole('button', { name: 'Отклонить' }).click();
  await expect(page.getByText('Строка отклонена')).toBeVisible();
  // Accept the rest.
  const accept = page.getByRole('button', { name: /^Принять строку/ });
  const n = await accept.count();
  for (let k = 0; k < n; k++) {
    await accept.first().click();
    await expect(accept).toHaveCount(n - k - 1);
  }
  await expect(page.getByTestId('rebill-status')).toContainText('Принят частично');
  // The claims officer cannot pay.
  await expect(page.getByRole('button', { name: /^Оплатить/ })).toHaveCount(0);
  expect((await api(page, 'POST', `/rebills/${rebillId}/pay`)).status).toBe(403);

  await as(page, 'asstBilling');
  await page.goto(`/assist/rebills/${rebillId}`);
  await page.getByRole('button', { name: /^Оспорить строку/ }).click();
  await page.getByRole('dialog').getByLabel('Возражение').fill('Платёжное поручение PP-20931 приложено');
  await page.getByRole('dialog').getByRole('button', { name: 'Оспорить' }).click();
  await expect(page.getByTestId('rebill-status')).toContainText('На проверке');

  await as(page, 'claims');
  await page.goto(`/staff/rebills/${rebillId}`);
  await expect(page.getByText('Ассистанс: Платёжное поручение PP-20931 приложено')).toBeVisible();
  await page.getByRole('button', { name: /^Принять строку/ }).click();
  await expect(page.getByTestId('rebill-status')).toHaveText('Принят');

  await as(page, 'accountant');
  await page.goto(`/staff/rebills/${rebillId}`);
  await page.getByRole('button', { name: /^Оплатить/ }).click();
  await page.getByRole('dialog', { name: 'Оплатить счёт ассистанса?' }).getByRole('button', { name: 'Оплатить' }).click();
  await expect(page.getByTestId('rebill-status')).toContainText('Оплачен');
});

test('6. Isolation: another assistance finds nobody; after a change the new one gets new cases, the former one reads old ones only', async ({ page }) => {
  failOnDialog(page);
  await loginStaff(page, 'asst_operator');
  await asInsured(page);
  const fullName = ((await api(page, 'GET', '/me')).data as { fullName: string }).fullName;
  await as(page, 'asstOperator');
  const own = ((await api(page, 'GET', `/assist/insured?q=${encodeURIComponent(fullName)}`)).data as { id: string; fullName: string }[]).find((x) => x.fullName === fullName)!;
  expect(own).toBeTruthy();

  // The operator of the second assistance.
  await loginByEmail(page, 'asst-operator@demo-assist2.uz');
  await expect(page.getByTestId('assistance-name')).not.toHaveText(/Shifo/);
  await page.goto('/assist/insured');
  await page.getByRole('searchbox', { name: 'Поиск застрахованного' }).fill(fullName.split(' ')[0]!);
  await expect(page.getByText('Никого не нашли среди ваших застрахованных').or(page.getByRole('row').nth(1))).toBeVisible();
  await expect(page.getByRole('row', { name: new RegExp(fullName) })).toHaveCount(0);
  await page.goto(`/assist/insured/${own.id}`);
  await expect(page.getByRole('alert')).toContainText('Не найдено');

  // The client that moved from this assistance to the first one mid-year: old cases are read-only.
  const cases = (await api(page, 'GET', '/assist/cases')).data as { id: string; insuredId: string; access: string }[];
  const old = cases.find((c) => c.access === 'read')!;
  expect(old).toBeTruthy();
  await page.goto('/assist/cases');
  await expect(page.getByText('Только чтение').first()).toBeVisible();
  expect((await api(page, 'PATCH', `/assist/cases/${old.id}`, { status: 'resolved', resolution: 'Закрыто' })).status).toBe(403);
  // A new case of a client that is no longer theirs: the person does not exist for them today.
  expect((await api(page, 'POST', '/assist/cases', { insuredId: old.insuredId, type: 'consultation', description: 'Новый вопрос' })).status).toBe(404);

  // The new assistance of the client takes new cases.
  await loginByEmail(page, 'asst-operator@demo-assist.uz');
  await page.goto(`/assist/insured/${old.insuredId}`);
  await page.getByRole('button', { name: 'Новое обращение' }).click();
  await page.getByRole('dialog').getByLabel('Суть обращения').fill('Вопрос по покрытию после смены ассистанса');
  await page.getByRole('dialog').getByRole('button', { name: 'Создать обращение' }).click();
  await expect(page).toHaveURL(/\/assist\/cases\/[0-9a-f-]{36}$/);
  const newCaseId = page.url().split('/').pop()!;

  await loginByEmail(page, 'asst-operator@demo-assist2.uz');
  expect((await api(page, 'GET', `/assist/cases/${newCaseId}`)).status).toBe(404);
});

test('7. App: «Ваш ассистанс 24/7» shows the right company and the chat lands in its portal', async ({ page }) => {
  failOnDialog(page);
  await loginStaff(page, 'asst_operator');
  const name = (await page.getByTestId('assistance-name').innerText()).trim();
  await asInsured(page);
  const fullName = ((await api(page, 'GET', '/me')).data as { fullName: string }).fullName;
  const card = page.getByTestId('assistance-card');
  await expect(card).toContainText(name);
  await expect(card.getByRole('link', { name: /Позвонить/ })).toHaveAttribute('href', /^tel:\+998\d+$/);
  await page.goto('/app/chat');
  await expect(page.getByTestId('chat-assistance')).toContainText(name);
  const text = `Нужна справка для бассейна ${Date.now() % 10000}`;
  await page.getByPlaceholder('Сообщение').fill(text);
  await page.getByRole('button', { name: 'Отправить' }).click();
  await expect(page.getByText(text)).toBeVisible();

  await as(page, 'asstOperator');
  await page.goto('/assist/chat');
  await page.getByRole('button', { name: new RegExp(fullName) }).first().click();
  await expect(page.getByTestId('assist-chat')).toContainText(text);
  await page.getByLabel('Ответ', { exact: true }).fill('Справку подготовим сегодня');
  await page.getByRole('button', { name: 'Отправить' }).click();
  await expect(page.getByTestId('assist-chat')).toContainText('Справку подготовим сегодня');
});

test('8. Simulator of an API assistance: roster sync and a rebill through the API are visible to MIG', async ({ page }) => {
  failOnDialog(page);
  await loginStaff(page, 'asst_admin');
  await page.goto('/assist/integration');
  const sim = page.getByTestId('assist-simulator');
  await sim.getByRole('button', { name: 'Синхронизировать список застрахованных' }).click();
  await expect(page.getByTestId('assist-sim-log')).toContainText('Список застрахованных синхронизирован');
  await sim.getByRole('button', { name: 'Выставить счёт МИГ за месяц' }).click();
  await expect(page.getByTestId('assist-sim-log')).toContainText(/Счёт SChA-\S+ выставлен МИГ/);
  const number = (await page.getByTestId('assist-sim-log').innerText()).match(/SChA-\S+/)![0];
  await page.getByRole('tab', { name: 'Журнал запросов' }).click();
  await expect(page.getByText('/assistance/rebills').first()).toBeVisible();

  await as(page, 'claims');
  await page.goto('/staff/rebills');
  await expect(page.getByRole('row', { name: new RegExp(number) })).toBeVisible();
  await page.goto('/staff/assistance');
  await page.getByRole('row', { name: /Shifo/ }).click();
  await page.getByRole('tab', { name: 'Счета' }).click();
  await expect(page.getByRole('row', { name: new RegExp(number) })).toBeVisible();
});

test('9. Operator requests a letter from a guarantee case; the curator closes a complaint; the MIG admin adds an assistance', async ({ page }) => {
  failOnDialog(page);
  await loginStaff(page, 'asst_operator');
  // A guarantee case of the operator: request the letter right from it.
  const cases = (await api(page, 'GET', '/assist/cases?type=guarantee')).data as { id: string; status: string; access: string; links: { guaranteeId?: string } }[];
  let caseId = cases.find((c) => c.access === 'full' && c.status !== 'resolved' && !c.links.guaranteeId)?.id;
  if (!caseId) {
    const person = ((await api(page, 'GET', '/assist/insured?q=')).data as { id: string }[])[0]!;
    caseId = ((await api(page, 'POST', '/assist/cases', { insuredId: person.id, type: 'guarantee', description: 'Направление на МРТ' })).data as { id: string }).id;
  }
  await page.goto(`/assist/cases/${caseId}`);
  await page.getByRole('button', { name: 'Запросить ГП' }).click();
  const dlg = page.getByRole('dialog', { name: 'Запросить гарантийное письмо' });
  await dlg.getByLabel('Клиника').selectOption({ index: 1 });
  await dlg.getByLabel('Услуга').selectOption({ index: 1 });
  await dlg.getByLabel('Код МКБ-10').fill('G43.9');
  await dlg.getByRole('button', { name: 'Запросить ГП' }).click();
  await expect(page).toHaveURL(/\/assist\/guarantees\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { name: /Гарантийное письмо GP-\d{4}-\d{6}/ })).toBeVisible();

  await as(page, 'operator');
  const assistances = (await api(page, 'GET', '/assistance')).data as { id: string; name: string }[];
  await page.goto(`/staff/assistance/${assistances[0]!.id}?tab=cases`);
  await page.getByRole('button', { name: /^Закрыть жалобу/ }).first().click();
  await page.getByRole('dialog', { name: 'Закрыть жалобу' }).getByLabel('Решение МИГ').fill('Связались с ассистансом, ответ получен');
  await page.getByRole('dialog', { name: 'Закрыть жалобу' }).getByRole('button', { name: 'Закрыть жалобу' }).click();
  await expect(page.getByText('Жалоба закрыта')).toBeVisible();

  await page.getByRole('button', { name: 'Войти как…' }).click();
  await page.getByRole('menuitem', { name: /^Администратор(?! клиники| ассистанса)/ }).click();
  await expect(page.getByText('Вы вошли как «Администратор»').last()).toBeVisible();
  await page.goto('/staff/assistance');
  await page.getByRole('button', { name: 'Добавить ассистанс' }).click();
  const create = page.getByRole('dialog', { name: 'Новый ассистанс' });
  await create.getByLabel('Название').fill('Самарканд Ассистанс Плюс');
  await create.getByLabel('Телефон 24/7').fill('+998 66 200 00 00');
  await create.getByLabel('Номер договора').fill('ДА-2026-004');
  await create.getByLabel('ФИО администратора').fill('Дилноза Каримова');
  await create.getByLabel('Email администратора').fill('admin@samarkand-assist.uz');
  await create.getByRole('button', { name: 'Добавить' }).click();
  await expect(page).toHaveURL(/\/staff\/assistance\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { name: 'Самарканд Ассистанс Плюс' })).toBeVisible();
});
