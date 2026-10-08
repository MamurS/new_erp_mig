/* Family members in the insured app — FAMILY_SPEC: switcher, clinic check of a child, adult's consent, requests, IDOR. */
import { expect, test, type Page } from './test';
import { acceptConsent, api, failOnDialog, loginInsured } from './helpers';

const EMPLOYEE = 'Karimov Aziz Bahromovich';
const SPOUSE = 'Karimova Dilnoza Rustamovna';
const CHILD = 'Karimov Temur Azizovich';
const FAMILY_NAMES = [EMPLOYEE, SPOUSE, CHILD, 'Karimova Madina Azizovna'];
const CONSENT_SWITCH = 'Разрешить Aziz видеть мои обращения';

type Profile = { id: string; fullName: string; relation: string; access: string };

/** «Войти как…» in the same tab (the in-page mock DB is kept); the first app login lands on the consent screen. */
async function switchTo(page: Page, item: RegExp, home?: RegExp): Promise<void> {
  const before = await page.evaluate(() => sessionStorage.getItem('mig.session'));
  await page.getByRole('button', { name: 'Войти как…' }).click();
  await page.getByRole('menuitem', { name: item }).click();
  // Wait for the new session itself, not only for a toast (an earlier one may still be on screen).
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem('mig.session'))).not.toBe(before);
  if (home) await expect(page).toHaveURL(home);
}
async function asApp(page: Page, item: RegExp): Promise<void> {
  await switchTo(page, item);
  const consent = page.getByRole('checkbox', { name: /согласен/ });
  await expect(consent.or(page.getByRole('link', { name: /Карточка для клиники/ }))).toBeVisible();
  if (await consent.isVisible()) await acceptConsent(page);
  await expect(page).toHaveURL(/\/app$/);
}
const asEmployee = (page: Page) => asApp(page, /^Застрахованный/);
const asSpouse = (page: Page) => asApp(page, /^Член семьи — супруга/);

function switcher(page: Page) {
  return page.getByRole('radiogroup', { name: 'Профиль' });
}
async function pick(page: Page, name: string): Promise<void> {
  const radio = switcher(page).getByRole('radio', { name, exact: true });
  await radio.click();
  await expect(radio).toHaveAttribute('aria-checked', 'true');
}
async function family(page: Page): Promise<Profile[]> {
  const r = await api(page, 'GET', '/me/family');
  expect(r.status).toBe(200);
  return r.data as Profile[];
}

test("a. The employee switches to a child: certificate and QR, limits, the child's appointment and reimbursement", async ({
  page,
}) => {
  failOnDialog(page);
  await loginInsured(page);
  await expect(switcher(page).getByRole('radio', { name: 'Я', exact: true })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await expect(switcher(page).getByRole('radio')).toHaveCount(4);

  await pick(page, 'Temur');
  await expect(page.getByTestId('home-person')).toContainText(CHILD);
  const cert = (await page.getByTestId('home-certificate').innerText()).trim();
  expect(cert.length).toBeGreaterThan(3);
  await expect(page.getByRole('heading', { name: 'Сколько осталось' })).toBeVisible();
  await expect(page.getByText('Амбулаторно').first()).toBeVisible();
  await expect(page.getByTestId('home-next-appointment')).toContainText('Педиатр');
  await expect(page.getByTestId('home-latest-claim')).toContainText('186 000');

  // QR card of the child.
  await page.getByRole('link', { name: /Карточка для клиники/ }).click();
  await expect(page).toHaveURL(/\/app\/card$/);
  await expect(page.getByTestId('person-note')).toContainText(CHILD);
  await expect(page.getByTestId('card-person')).toHaveText(CHILD);
  await expect(page.getByTestId('card-qr')).toBeVisible();
  await expect(page.getByTestId('card-certificate')).toHaveText(cert);
  await page.getByRole('button', { name: 'Назад' }).click();

  // The certificate document of the child.
  await page.getByRole('link', { name: 'Сертификат', exact: true }).click();
  await expect(page.getByTestId('my-certificate-number')).toHaveText(cert);
  await page.getByRole('button', { name: 'Назад' }).click();

  // The reimbursement list and the appointments are the child's too (the choice survives navigation).
  await page.getByRole('link', { name: 'Возмещения', exact: true }).click();
  await expect(page.getByTestId('person-note')).toContainText(CHILD);
  await expect(page.getByText('186 000').first()).toBeVisible();
  await page.getByRole('link', { name: 'Главная', exact: true }).click();
  await page.getByRole('link', { name: 'Все записи' }).click();
  await expect(page.getByTestId('person-note')).toContainText(CHILD);
  await expect(page.getByText('Педиатр').first()).toBeVisible();

  // A receipt for the child is paid to the employee's card.
  await page.getByRole('link', { name: 'Главная', exact: true }).click();
  await page.getByRole('link', { name: 'Вернуть деньги за чек' }).click();
  await expect(page.getByTestId('refund-payout')).toContainText(/Вернём за Temur на вашу карту •+ ?\d{4}/);
  // Nothing personal in the URL or the title.
  expect(page.url()).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/);
  expect(await page.title()).not.toContain('Temur');
});

test("b. A clinic registrar checks the child's app code: coverage for that child", async ({ page }) => {
  failOnDialog(page);
  await loginInsured(page);
  await pick(page, 'Temur');
  await page.getByRole('link', { name: /Карточка для клиники/ }).click();
  await expect(page.getByTestId('card-person')).toHaveText(CHILD);
  const code = (await page.getByTestId('card-short-code').innerText()).trim();
  expect(code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  // Leave the card page so the still-mounted page does not refresh the code during the switch.
  await page.getByRole('button', { name: 'Назад' }).click();
  await expect(page).toHaveURL(/\/app$/);

  await switchTo(page, /^Регистратор клиники/, /\/clinic$/);
  await page.goto('/clinic/check');
  await page.getByLabel('Сканер штрихкодов или код из 8 символов').fill(code);
  await page.getByRole('button', { name: 'Проверить код' }).click();
  const result = page.getByTestId('coverage-result');
  await expect(result).toBeVisible();
  await expect(result).toContainText('Temur');
  await expect(result).not.toContainText('Aziz Bahromovich');
  await expect(result.getByTestId('coverage-table')).toBeVisible();
});

test("c. The spouse's claim is hidden until she allows it; revoking hides it again; both are audited", async ({
  page,
}) => {
  failOnDialog(page);
  await loginInsured(page);
  const spouseId = (await family(page)).find((p) => p.relation === 'spouse')!.id;
  expect((await family(page)).find((p) => p.id === spouseId)!.access).toBe('basic');
  await pick(page, 'Dilnoza');
  await expect(page.getByTestId('medical-hidden')).toContainText('Dilnoza пока не разрешил(а)');
  await expect(page.getByRole('link', { name: /Карточка для клиники/ })).toBeVisible();
  await expect(page.getByTestId('home-latest-claim')).toHaveCount(0);
  expect((await api(page, 'GET', `/me/claims?personId=${spouseId}`)).status).toBe(404);
  expect((await api(page, 'GET', `/me/policy?personId=${spouseId}`)).status).toBe(200);

  // The spouse signs in with her own phone and allows it in her profile.
  await asSpouse(page);
  await expect(switcher(page)).toHaveCount(0);
  await page.getByRole('link', { name: 'Профиль', exact: true }).click();
  const toggle = page.getByRole('switch', { name: CONSENT_SWITCH });
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await toggle.click();
  await page
    .getByRole('dialog', { name: 'Разрешить Aziz видеть обращения?' })
    .getByRole('button', { name: 'Разрешить' })
    .click();
  await expect(toggle).toHaveAttribute('aria-checked', 'true');

  await asEmployee(page);
  await pick(page, 'Dilnoza');
  await expect(page.getByTestId('home-latest-claim')).toContainText('420 000');
  await expect(page.getByTestId('medical-hidden')).toHaveCount(0);
  expect((await api(page, 'GET', `/me/claims?personId=${spouseId}`)).status).toBe(200);

  // She revokes: hidden again.
  await asSpouse(page);
  await page.getByRole('link', { name: 'Профиль', exact: true }).click();
  await page.getByRole('switch', { name: CONSENT_SWITCH }).click();
  await page
    .getByRole('dialog', { name: 'Закрыть доступ для Aziz?' })
    .getByRole('button', { name: 'Закрыть доступ' })
    .click();
  await expect(page.getByRole('switch', { name: CONSENT_SWITCH })).toHaveAttribute('aria-checked', 'false');

  await asEmployee(page);
  await pick(page, 'Dilnoza');
  await expect(page.getByTestId('medical-hidden')).toBeVisible();
  expect((await api(page, 'GET', `/me/claims?personId=${spouseId}`)).status).toBe(404);

  await switchTo(page, /^Администратор — admin@/, /\/staff$/);
  const res = await api(
    page,
    'GET',
    '/audit?action=family_consent_granted,family_consent_revoked&pageSize=50',
  );
  expect(res.status, JSON.stringify(res.data).slice(0, 300)).toBe(200);
  const audit = res.data as { items: { action: string }[] };
  expect(audit.items.filter((e) => e.action === 'family_consent_granted').length).toBeGreaterThanOrEqual(1);
  expect(audit.items.filter((e) => e.action === 'family_consent_revoked').length).toBeGreaterThanOrEqual(1);
});

test('d. The employee asks to add a family member from the app: pending, then approved by HR', async ({
  page,
}) => {
  failOnDialog(page);
  await loginInsured(page);
  await page.getByRole('link', { name: 'Профиль', exact: true }).click();
  await page.getByRole('link', { name: 'Моя семья' }).click();
  await expect(page).toHaveURL(/\/app\/family$/);
  await expect(page.getByTestId('family-member').filter({ hasText: CHILD })).toBeVisible();
  await expect(page.getByTestId('family-member').filter({ hasText: SPOUSE })).toBeVisible();

  await page.getByRole('button', { name: 'Добавить члена семьи' }).click();
  const form = page.getByRole('form', { name: 'Добавить члена семьи' });
  await form.getByLabel('ФИО латиницей').fill('Karimova Zarina Azizovna');
  await form.getByLabel('Дата рождения').fill('01.03.2022');
  await form.getByLabel('ПИНФЛ').fill('61234567890123');
  await form.getByRole('button', { name: 'Ребёнок' }).click();
  await form.getByRole('checkbox', { name: /согласен на обработку/ }).click();
  await form.getByRole('button', { name: 'Отправить заявку' }).click();
  const req = page.getByTestId('family-request').filter({ hasText: 'Karimova Zarina Azizovna' });
  await expect(req.getByTestId('family-request-status')).toHaveText('На рассмотрении HR');
  expect(page.url()).not.toContain('61234567890123');

  // HR approves it (the HR screen itself is covered by e2e/hr-family.spec.ts).
  await switchTo(page, /^HR клиента/, /\/hr$/);
  const pending = (await api(page, 'GET', '/hr/family-requests?status=pending')).data as {
    id: string;
    fullName: string;
  }[];
  const mine = pending.find((r) => r.fullName === 'Karimova Zarina Azizovna');
  expect(mine).toBeTruthy();
  expect(
    (await api(page, 'POST', `/hr/family-requests/${mine!.id}/decision`, { decision: 'approve' })).status,
  ).toBe(200);

  await asEmployee(page);
  await page.getByRole('link', { name: 'Профиль', exact: true }).click();
  await page.getByRole('link', { name: 'Моя семья' }).click();
  await expect(
    page
      .getByTestId('family-request')
      .filter({ hasText: 'Karimova Zarina Azizovna' })
      .getByTestId('family-request-status'),
  ).toHaveText('Одобрено');
});

test("e. IDOR: another family's person, appointment or claim through /api/me is 404", async ({ page }) => {
  // Ids of another family, as a curator sees them.
  await loginInsured(page);
  await switchTo(page, /^Куратор ДМС/, /\/staff$/);
  let other: { id: string } | undefined;
  for (let p = 1; p <= 30 && !other; p++) {
    const list = (await api(page, 'GET', `/insured?page=${p}&pageSize=100`)).data as {
      items: { id: string; fullName: string; relation?: string }[];
    };
    other = list.items.find(
      (i) => i.relation && i.relation !== 'employee' && !FAMILY_NAMES.includes(i.fullName),
    );
    if (list.items.length < 100) break;
  }
  expect(other, 'a family member of another employee').toBeTruthy();
  const claims = (await api(page, 'GET', '/claims?pageSize=100')).data as {
    items: { id: string; insuredName: string }[];
  };
  const otherClaim = claims.items.find((c) => !FAMILY_NAMES.includes(c.insuredName));
  const appts = (await api(page, 'GET', '/appointments?pageSize=100')).data as
    { items?: { id: string; insuredName: string }[] } | { id: string; insuredName: string }[];
  const apptList = Array.isArray(appts) ? appts : (appts.items ?? []);
  const otherAppt = apptList.find((a) => !FAMILY_NAMES.includes(a.insuredName));
  expect(otherClaim).toBeTruthy();
  expect(otherAppt).toBeTruthy();

  await asEmployee(page);
  for (const path of [
    '/me/policy',
    '/me/limits',
    '/me/claims',
    '/me/appointments',
    '/me/certificate',
    '/me/card-token',
  ]) {
    expect((await api(page, 'GET', `${path}?personId=${other!.id}`)).status, path).toBe(404);
  }
  expect((await api(page, 'GET', '/me/claims?personId=not-a-uuid')).status).toBe(404);
  expect((await api(page, 'GET', `/me/claims/${otherClaim!.id}`)).status).toBe(404);
  expect((await api(page, 'POST', `/me/appointments/${otherAppt!.id}/cancel`)).status).toBe(404);
  // The employee's own family is fine.
  const child = (await family(page)).find((p) => p.relation === 'child')!;
  expect((await api(page, 'GET', `/me/limits?personId=${child.id}`)).status).toBe(200);
});
