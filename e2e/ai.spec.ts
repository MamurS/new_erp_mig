/* AI coverage check — AI_COVERAGE_SPEC §7, e2e scenarios 1–6. */
import { expect, test, type Page } from '@playwright/test';
import { acceptConsent, api, loginStaff } from './helpers';

async function switchTo(page: Page, label: string, home: RegExp): Promise<void> {
  await page.getByRole('button', { name: 'Войти как…' }).click();
  await page.getByRole('menuitem', { name: new RegExp(`^${label} — [a-z0-9.+-]+@`) }).click();
  await expect(page.getByText(`Вы вошли как «${label}»`).last()).toBeVisible();
  await expect(page).toHaveURL(home);
}

async function asInsured(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Войти как…' }).click();
  await page.getByRole('menuitem', { name: /^Застрахованный/ }).click();
  const consent = page.getByRole('checkbox', { name: /согласен/ });
  await expect(consent.or(page.getByRole('link', { name: /Карточка для клиники/ }))).toBeVisible();
  if (await consent.isVisible()) await acceptConsent(page);
}

async function jpeg(page: Page, text: string): Promise<Buffer> {
  const b64 = await page.evaluate(async (t) => {
    const c = document.createElement('canvas');
    c.width = 320;
    c.height = 200 + (t.length % 50);
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.fillStyle = '#000';
    ctx.font = '18px sans-serif';
    ctx.fillText(t, 10, 40);
    const blob = await new Promise<Blob>((r) => c.toBlob((b) => r(b!), 'image/jpeg', 0.9));
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let s = '';
    for (const x of bytes) s += String.fromCharCode(x);
    return btoa(s);
  }, text);
  return Buffer.from(b64, 'base64');
}

test('1. The insured asks «мрт колена»: a guarantee letter is needed, with the clause and the limit; «Уточнить у ассистанса» opens the chat with the question', async ({ page }) => {
  await loginStaff(page, 'operator');
  await asInsured(page);
  await page.getByRole('link', { name: 'Покрывается ли?' }).click();
  await expect(page).toHaveURL(/\/app\/coverage$/);
  await page.getByLabel('Какая услуга или лекарство?').fill('мрт колена');
  await page.getByRole('button', { name: 'Проверить' }).click();
  await expect(page.getByTestId('coverage-verdict')).toHaveText('Нужно гарантийное письмо, его запросит клиника');
  await expect(page.getByTestId('coverage-clause')).toContainText('п. 2.3 программы');
  await expect(page.getByTestId('coverage-limit')).toContainText('Осталось по лимиту');
  await expect(page.getByText('Это предварительная оценка')).toBeVisible();
  await page.getByRole('button', { name: 'Уточнить у ассистанса' }).click();
  await expect(page).toHaveURL(/\/app\/chat$/);
  await expect(page.getByRole('textbox')).toHaveValue('Покрывается ли «мрт колена»?');
});

test('2. A receipt with medicines, vitamins and cosmetics: positions are labelled, the expected sum is counted, «не вернём» positions are removed', async ({ page }) => {
  test.setTimeout(120_000);
  await loginStaff(page, 'operator');
  await asInsured(page);
  // The fake OCR returns a pharmacy or a clinic receipt depending on the image: retry until a pharmacy.
  for (let k = 0; k < 8; k++) {
    await page.goto('/app/claims/new');
    await page.getByTestId('receipt-input').setInputFiles({ name: 'receipt.jpg', mimeType: 'image/jpeg', buffer: await jpeg(page, `PHARMACY ${k} ${'x'.repeat(k * 7)}`) });
    await expect(page.getByText('Чек распознан')).toBeVisible();
    await expect(page.getByTestId('receipt-items')).toBeVisible();
    if ((await page.locator('[data-testid="receipt-item"][data-label="no_refund"]').count()) > 0) break;
  }
  const items = page.getByTestId('receipt-item');
  await expect(items).toHaveCount(4);
  await expect(page.locator('[data-testid="receipt-item"][data-label="refund"]')).toHaveCount(2);
  await expect(page.locator('[data-testid="receipt-item"][data-label="no_refund"]')).toHaveCount(2);
  await expect(page.getByTestId('receipt-items')).toContainText('вернём');
  await expect(page.getByTestId('receipt-items')).toContainText('не вернём');
  const refundSum = await page.locator('[data-testid="receipt-item"][data-label="refund"] .num').allInnerTexts();
  const sum = refundSum.map((s) => Number(s.replace(/\D/g, ''))).reduce((a, b) => a + b, 0);
  await expect(page.getByTestId('receipt-expected')).toContainText(String(sum).replace(/\B(?=(\d{3})+(?!\d))/g, ' '));
  await page.getByRole('button', { name: 'Убрать позиции «не вернём»' }).click();
  await expect(page.locator('[data-testid="receipt-item"][data-label="no_refund"]')).toHaveCount(0);
  await expect(page.getByLabel('Сумма')).toHaveValue(String(sum).replace(/\B(?=(\d{3})+(?!\d))/g, ' '));
});

test('3. The clinic presses «Проверить строки» in a draft registry and sees the lines likely to be rejected', async ({ page }) => {
  await loginStaff(page, 'clinic_admin');
  const code = ((await api(page, 'POST', '/__demo/mis-card')).data as { shortCode: string }).shortCode;
  const visitId = ((await api(page, 'POST', '/clinic/check', { qrToken: code })).data as { visitId: string }).visitId;
  const prices = (await api(page, 'GET', `/clinic/price-list?visitId=${visitId}`)).data as { code: string; price: number; name: string }[];
  const ok = prices.find((p) => p.code === 'TH-101')!;
  const bad = prices.find((p) => p.code === 'CL-102')!;
  expect(bad, 'a cosmetology service in the price list').toBeTruthy();
  const today = new Date(Date.now() + 5 * 3600_000).toISOString().slice(0, 10);
  const csv = ['visit_id,service_date,service_code,icd10,quantity,price,guarantee_number', `${visitId},${today},${ok.code},J06.9,1,${ok.price},`, `${visitId},${today},${bad.code},L70.0,1,${bad.price},`].join('\n');
  await page.goto('/clinic/registries');
  await page.getByRole('button', { name: 'Загрузить CSV' }).click();
  await page.getByLabel('Файл реестра CSV').setInputFiles({ name: 'registry.csv', mimeType: 'text/csv', buffer: Buffer.from(csv, 'utf8') });
  await page.getByRole('button', { name: 'Создать реестр (2)' }).click();
  await expect(page).toHaveURL(/\/clinic\/registries\/[0-9a-f-]{36}$/);
  await page.getByRole('button', { name: 'Проверить строки' }).click();
  await expect(page.getByTestId('line-ai-risk')).toHaveCount(1);
  await expect(page.getByRole('row').filter({ hasText: 'Чистка лица' }).getByTestId('line-ai-risk')).toContainText('Не покрывается');
  // Sending is still allowed.
  await expect(page.getByRole('button', { name: 'Отправить в МИГ' })).toBeEnabled();
});

test('4. The claims officer sees the hint, disagrees with a comment; the metric in /staff/admin/ai follows', async ({ page }) => {
  await loginStaff(page, 'claims_officer');
  const list = (await api(page, 'GET', '/claims?tab=review&pageSize=50')).data as { items: { id: string }[] };
  await page.goto(`/staff/claims/${list.items[0]!.id}`);
  const hint = page.getByTestId('ai-hint');
  await expect(hint).toContainText('Предлагаемый вердикт');
  await expect(hint).toContainText('Подсказка не заполняет решение');
  await hint.getByRole('button', { name: 'Не согласен' }).click();
  const dialog = page.getByRole('dialog', { name: 'Не согласен с подсказкой' });
  await dialog.getByRole('button', { name: 'Отправить' }).click();
  await expect(dialog.getByText(/минимум 5 символов/)).toBeVisible();
  await dialog.getByLabel('Комментарий').fill('Препарат назначен врачом по основному диагнозу');
  await dialog.getByRole('button', { name: 'Отправить' }).click();
  await expect(page.getByTestId('ai-rated')).toContainText('не согласен');

  await switchTo(page, 'Администратор', /\/staff$/);
  await page.goto('/staff/admin/ai');
  await expect(page.getByTestId('ai-metric-decision')).toContainText('0%');
  await expect(page.getByTestId('ai-disagreements')).toContainText('Препарат назначен врачом по основному диагнозу');
  await page.getByRole('button', { name: 'Прогнать' }).click();
  await expect(page.getByTestId('golden-result')).toContainText(/Точность (9\d|100)%/);
});

test('5. The kill switch hides AI blocks in every portal and in the app', async ({ page }) => {
  test.setTimeout(120_000);
  await loginStaff(page, 'admin');
  await page.goto('/staff/admin/ai');
  await page.getByRole('button', { name: 'Отключить ИИ везде' }).click();
  const dialog = page.getByRole('dialog', { name: 'Отключить ИИ везде?' });
  await dialog.getByLabel('Причина').fill('Инцидент: проверяем ответы модели');
  await dialog.getByRole('button', { name: 'Отключить' }).click();
  await expect(page.getByText('ИИ отключён везде').first()).toBeVisible();

  await asInsured(page);
  await page.goto('/app/coverage');
  await expect(page.getByTestId('coverage-off')).toContainText('Проверка временно недоступна, уточните у ассистанса');

  await switchTo(page, 'Специалист по убыткам', /\/staff$/);
  const claims = (await api(page, 'GET', '/claims?tab=review&pageSize=5')).data as { items: { id: string }[] };
  await page.goto(`/staff/claims/${claims.items[0]!.id}`);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByTestId('ai-hint')).toHaveCount(0);
  await expect(page.getByText('Подсказка ИИ')).toHaveCount(0);

  await switchTo(page, 'Врач ассистанса', /\/assist$/);
  const gps = (await api(page, 'GET', '/assist/guarantees')).data as { id: string }[] | { items: { id: string }[] };
  const gp = Array.isArray(gps) ? gps[0] : gps.items[0];
  if (gp) {
    await page.goto(`/assist/guarantees/${gp.id}`);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByTestId('ai-hint')).toHaveCount(0);
  }

  await switchTo(page, 'Администратор клиники', /\/clinic$/);
  const regs = (await api(page, 'GET', '/clinic/registries')).data as { id: string; status: string }[] | { items: { id: string; status: string }[] };
  const draft = (Array.isArray(regs) ? regs : regs.items).find((r) => r.status === 'draft');
  if (draft) {
    await page.goto(`/clinic/registries/${draft.id}`);
    await expect(page.getByRole('button', { name: 'Отправить в МИГ' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Проверить строки' })).toHaveCount(0);
  }
});

test('6. Rights: a clinic without a visit cannot call the check (404); HR sees no AI blocks and gets 403', async ({ page }) => {
  await loginStaff(page, 'clinic_registrar');
  const r = await api(page, 'POST', '/ai/coverage-check', { scenario: 'clinic', subject: { type: 'visit', id: '11111111-1111-4111-8111-111111111111' }, serviceCode: 'DG-310' });
  expect(r.status).toBe(404);

  await switchTo(page, 'HR клиента', /\/hr$/);
  for (const path of ['/hr', '/hr/documents', '/hr/contracts']) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByText(/Подсказка ИИ|Проверка покрытия|Покрывается ли/)).toHaveCount(0);
  }
  expect((await api(page, 'POST', '/ai/coverage-check', { scenario: 'insured', query: 'мрт' })).status).toBe(403);
  expect((await api(page, 'POST', '/ai/coverage-check', { scenario: 'decision', subject: { type: 'claim', id: '11111111-1111-4111-8111-111111111111' } })).status).toBe(403);
});
