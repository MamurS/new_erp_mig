/* KP_SPEC §10: commercial offer on the GOLD brochure. */
import { expect, test, type Page } from './test';
import { api, CODE, failOnDialog, loginStaff, PASSWORD, logoutFromSidebar } from './helpers';

const PAGES = 17;

async function loginByEmail(page: Page, email: string, home: RegExp): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Пароль').fill(PASSWORD);
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await expect(page).toHaveURL(/\/login\/otp/);
  await page.getByLabel('Цифра 1').fill(CODE);
  await expect(page).toHaveURL(home);
}

async function logout(page: Page, portal: 'staff' | 'hr'): Promise<void> {
  if (portal === 'hr') {
    await page.getByRole('button', { name: 'Меню пользователя' }).click();
    await page.getByRole('menuitem', { name: 'Выйти' }).click();
  } else {
    await logoutFromSidebar(page);
  }
  await expect(page).toHaveURL(/\/login/);
}

const kpFrame = (page: Page) => page.frameLocator('iframe[sandbox="allow-same-origin allow-modals"]').first();

/** Replaces print() of every iframe window with a counter (the real dialog would block the test). */
async function stubIframePrint(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __kpPrints: number };
    w.__kpPrints = 0;
    const desc = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'contentWindow')!;
    Object.defineProperty(HTMLIFrameElement.prototype, 'contentWindow', {
      configurable: true,
      get(this: HTMLIFrameElement) {
        const win = desc.get!.call(this) as (Window & { print: () => void }) | null;
        if (win) win.print = () => void (w.__kpPrints += 1);
        return win;
      },
    });
  });
}

test('KP 1. Underwriter prepares an offer from the queue, sends it; only this company’s HR sees it', async ({ page }) => {
  failOnDialog(page);
  await loginStaff(page, 'underwriter');
  await page.getByRole('tab', { name: 'Продления' }).click();
  const row = page.locator('tbody tr[data-row]').filter({ has: page.getByRole('button', { name: 'Подготовить КП' }) }).first();
  await row.getByRole('button', { name: 'Подготовить КП' }).click();
  await expect(page).toHaveURL(/\/staff\/clients\/[0-9a-f-]{36}\/kp\/new\?policyId=[0-9a-f-]{36}$/);
  const clientId = /\/clients\/([0-9a-f-]{36})\//.exec(page.url())![1]!;

  // prefilled form and 17 pages of preview
  await expect(page.getByLabel('Сотрудников')).not.toHaveValue('');
  await expect(page.getByLabel('Премия за сотрудника')).not.toHaveValue('');
  await expect(page.getByLabel('Обложка')).toHaveValue('grey');
  await expect(page.getByTestId('kp-page-counter')).toHaveText(`Страница 1 из ${PAGES}`);
  await expect(kpFrame(page).locator('.page')).toHaveCount(PAGES);
  await expect(kpFrame(page).getByText('Коммерческое предложение', { exact: true })).toBeVisible();
  await expect(page.getByTestId('kp-reference')).toContainText('убыточность');

  await page.getByRole('button', { name: 'Сохранить черновик' }).click();
  await expect(page).toHaveURL(new RegExp(`/staff/clients/${clientId}\\?tab=documents&highlight=[0-9a-f-]{36}$`));
  const kpId = new URL(page.url()).searchParams.get('highlight')!;
  const kp = (await api(page, 'GET', `/kp/${kpId}`)).data as { number: string; status: string };
  await expect(page.getByText(`${kp.number} сохранено в документах клиента`)).toBeVisible();
  const docRow = page.locator('tbody tr[data-row]').filter({ hasText: kp.number });
  await expect(docRow).toHaveAttribute('aria-selected', 'true');
  await expect(docRow).toContainText('Черновик');
  await expect(docRow).toContainText('GOLD');

  await docRow.getByRole('button', { name: `Отправить ${kp.number}` }).click();
  await expect(docRow).toContainText('Отправлено');
  await expect(page.getByText(`${kp.number} отправлено клиенту`)).toBeVisible();
  await logout(page, 'staff');

  // HR of this company sees the sent offer
  await loginByEmail(page, 'hr@renewal.example.uz', /\/hr$/);
  await page.goto('/hr/documents');
  const offers = page.getByRole('list', { name: 'Коммерческие предложения' });
  await expect(offers).toContainText(kp.number);
  await offers.getByRole('link', { name: 'Открыть' }).first().click();
  await expect(page).toHaveURL(`/hr/kp/${kpId}`);
  await expect(kpFrame(page).locator('.page')).toHaveCount(PAGES);
  await logout(page, 'hr');

  // HR of another company does not
  await loginByEmail(page, 'hr@demo-client.uz', /\/hr$/);
  await page.goto('/hr/documents');
  // The demo company has its own renewal offer (LIFECYCLE_SPEC §16), not this one.
  await expect(page.getByRole('list', { name: 'Коммерческие предложения' })).toBeVisible();
  expect(await page.locator('body').innerText()).not.toContain(kp.number);
  expect((await api(page, 'GET', `/kp/${kpId}`)).status).toBe(404);
});

test('KP 2. Operator has no «Подготовить КП» and gets 403 from POST /clients/:id/kp', async ({ page }) => {
  await loginStaff(page, 'operator');
  // The curator's queue is assistance service and appointments: renewals are the underwriter's work.
  await expect(page.locator('tbody tr[data-row]').first()).toBeVisible();
  await expect(page.getByTestId('queue-tabs').getByRole('tab', { name: /^Продления/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Подготовить КП' })).toHaveCount(0);

  const clients = (await api(page, 'GET', '/clients?pageSize=1')).data as { items: { id: string }[] };
  const clientId = clients.items[0]!.id;
  await page.goto(`/staff/clients/${clientId}`);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Подготовить КП' })).toHaveCount(0);
  await page.goto(`/staff/clients/${clientId}/kp/new`);
  await expect(page).toHaveURL(/\/403$/);

  const params = {
    templateId: 'gold', lang: 'ru', variant: 'grey', sumInsured: 1_000_000, premiumEmployee: 1000, premiumFamily: 1000,
    employees: 1, familyMembers: 0, coverageStart: '2030-01-01', coverageEnd: '2030-12-31', validUntil: '2030-01-01', paymentTerms: 'single',
  };
  expect((await api(page, 'POST', `/clients/${clientId}/kp`, params)).status).toBe(403);
  expect((await api(page, 'GET', `/clients/${clientId}/kp-defaults`)).status).toBe(403);
});

test('KP 3. An offer for the XSS client opens without any dialog; the name is text; no CSP violations', async ({ page }) => {
  failOnDialog(page);
  const violations: string[] = [];
  page.on('console', (m) => {
    if (/Content Security Policy|Refused to/i.test(m.text())) violations.push(m.text());
  });
  await loginStaff(page, 'underwriter');
  const list = (await api(page, 'GET', '/clients?q=onerror&pageSize=5')).data as { items: { id: string; name: string }[] };
  const client = list.items.find((c) => c.name.includes('<img'))!;
  expect(client).toBeTruthy();
  await page.goto(`/staff/clients/${client.id}/kp/new`);
  const frame = kpFrame(page);
  await expect(frame.locator('.page')).toHaveCount(PAGES);
  await expect(frame.getByText('<img src=x onerror=alert(1)>', { exact: false })).toBeVisible();
  await expect(frame.locator('img[src="x"]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Сохранить черновик' }).click();
  await expect(page).toHaveURL(/tab=documents/);
  const kpId = new URL(page.url()).searchParams.get('highlight')!;
  await page.goto(`/staff/kp/${kpId}`);
  await expect(kpFrame(page).locator('.page')).toHaveCount(PAGES);
  await expect(kpFrame(page).locator('img[src="x"]')).toHaveCount(0);
  await page.waitForTimeout(500); // give any injected handler a chance to fire
  expect(violations).toEqual([]);
});

test('KP 4. «Скачать PDF» calls print() of the iframe and writes kp_downloaded to the audit', async ({ page }) => {
  await stubIframePrint(page);
  await loginStaff(page, 'underwriter');
  const clientId = ((await api(page, 'GET', '/clients?pageSize=1')).data as { items: { id: string }[] }).items[0]!.id;
  const defaults = (await api(page, 'GET', `/clients/${clientId}/kp-defaults`)).data as { params: unknown };
  const kp = (await api(page, 'POST', `/clients/${clientId}/kp`, defaults.params)).data as { id: string; number: string };

  await page.goto(`/staff/kp/${kp.id}`);
  await expect(kpFrame(page).locator('.page')).toHaveCount(PAGES);
  await expect(page.getByText('В окне печати выберите «Сохранить как PDF»')).toBeVisible();
  await page.getByRole('button', { name: 'Скачать PDF' }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __kpPrints: number }).__kpPrints)).toBe(1);

  // the same from the client documents list (hidden frame)
  await page.goto(`/staff/clients/${clientId}?tab=documents`);
  await page.getByRole('button', { name: `Скачать PDF: ${kp.number}` }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __kpPrints: number }).__kpPrints)).toBe(1);

  const history = (await api(page, 'GET', `/clients/${clientId}/history`)).data as { action: string; targetLabel?: string }[];
  expect(history.filter((e) => e.action === 'kp_downloaded' && e.targetLabel === kp.number).length).toBeGreaterThanOrEqual(2);
  await page.getByRole('tab', { name: 'История' }).click();
  await expect(page.getByText('КП скачано').first()).toBeVisible();
});

test('KP 5. A sent offer cannot be changed: PATCH returns 409, the screen is read-only', async ({ page }) => {
  await loginStaff(page, 'underwriter');
  const clientId = ((await api(page, 'GET', '/clients?pageSize=1')).data as { items: { id: string }[] }).items[0]!.id;
  const defaults = (await api(page, 'GET', `/clients/${clientId}/kp-defaults`)).data as { params: Record<string, unknown> };
  const kp = (await api(page, 'POST', `/clients/${clientId}/kp`, defaults.params)).data as { id: string };
  expect((await api(page, 'POST', `/kp/${kp.id}/send`)).status).toBe(200);
  const res = await api(page, 'PATCH', `/kp/${kp.id}`, { ...defaults.params, employees: 1 });
  expect(res.status).toBe(409);

  await page.goto(`/staff/kp/${kp.id}`);
  await expect(page.getByText('Отправленное или отозванное КП нельзя изменить. Создайте новую версию.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Сохранить черновик' })).toHaveCount(0);
  await expect(page.getByLabel('Сотрудников')).toBeDisabled();
  await page.getByRole('button', { name: 'Создать новую версию' }).click();
  await expect(page).toHaveURL(new RegExp(`/staff/clients/${clientId}/kp/new\\?from=${kp.id}$`));
  await expect(page.getByLabel('Сотрудников')).toBeEnabled();
});

test('KP 6. Page order: brochure cover first, the offer letter second — in the preview and in a saved offer', async ({ page }) => {
  await loginStaff(page, 'underwriter');
  const list = (await api(page, 'GET', '/clients?q=Агрологистика')).data as { items: { id: string; name: string }[] };
  const client = list.items[0]!;
  await page.goto(`/staff/clients/${client.id}/kp/new`);
  const pages = kpFrame(page).locator('.page');
  await expect(pages).toHaveCount(PAGES);
  const checkOrder = async () => {
    await expect(pages.nth(0)).toContainText('Что важно знать, прежде чем сделать выбор.');
    await expect(pages.nth(0)).not.toContainText('Коммерческое предложение');
    await expect(pages.nth(1)).toContainText('Коммерческое предложение');
    await expect(pages.nth(1)).toContainText(client.name);
    // the brochure keeps its own page numbers: its page 2 comes third
    await expect(pages.nth(2)).toContainText('Это не только про болезнь.');
  };
  await checkOrder();
  await expect(page.getByTestId('kp-page-counter')).toHaveText(`Страница 1 из ${PAGES}`);

  await page.getByRole('button', { name: 'Сохранить черновик' }).click();
  await expect(page).toHaveURL(/tab=documents/);
  const kpId = new URL(page.url()).searchParams.get('highlight')!;
  await page.goto(`/staff/kp/${kpId}`);
  await expect(pages).toHaveCount(PAGES);
  await checkOrder();
});
