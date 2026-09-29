import { expect, test } from '@playwright/test';
import { api, login, loginStaff } from './helpers';

test('9. Operator: confirm an appointment in the queue and take a claim to approved', async ({ page }) => {
  await loginStaff(page, 'operator');
  await page.getByRole('tab', { name: 'Записи' }).click();
  const row = page.locator('tbody tr[data-row]').filter({ has: page.getByRole('button', { name: 'Подтвердить' }) }).first();
  const who = (await row.locator('td').nth(1).innerText()).trim();
  await row.getByRole('button', { name: 'Подтвердить' }).click();
  await expect(page.getByText('Запись подтверждена').first()).toBeVisible();
  const updated = page.locator('tbody tr[data-row]').filter({ hasText: who }).first();
  await expect(updated).toContainText('Подтверждена');
  await expect(page).toHaveURL(/\/staff$/);

  await page.goto('/staff/claims?status=new&category=medicines');
  await page.locator('tbody tr[data-row]').first().click();
  await expect(page).toHaveURL(/\/staff\/claims\/[0-9a-f-]{36}$/);
  await page.getByRole('button', { name: 'Взять в работу' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Взять в работу' }).click();
  await expect(page.getByText('Убыток взят в работу').first()).toBeVisible();
  await page.getByRole('button', { name: 'Одобрить' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Одобрить' }).click();
  await expect(page.getByText('Убыток одобрен').first()).toBeVisible();
  await expect(page.locator('h1 + p')).toContainText('Одобрен');
});

/** Builds a JPEG in the browser and injects an EXIF (APP1) segment with a GPS-like payload. */
async function jpegWithExif(page: import('@playwright/test').Page): Promise<Buffer> {
  const b64 = await page.evaluate(async () => {
    const c = document.createElement('canvas');
    c.width = 320;
    c.height = 480;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, 320, 480);
    ctx.fillStyle = '#000';
    ctx.font = '20px sans-serif';
    ctx.fillText('RECEIPT 125 000', 20, 60);
    const blob = await new Promise<Blob>((r) => c.toBlob((b) => r(b!), 'image/jpeg', 0.9));
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let s = '';
    for (const x of bytes) s += String.fromCharCode(x);
    return btoa(s);
  });
  const jpeg = Buffer.from(b64, 'base64');
  const payload = Buffer.from('Exif\0\0MM\0*GPSLatitude=41.311081;GPSLongitude=69.240562', 'latin1');
  const len = payload.length + 2;
  const app1 = Buffer.concat([Buffer.from([0xff, 0xe1, (len >> 8) & 0xff, len & 0xff]), payload]);
  return Buffer.concat([jpeg.subarray(0, 2), app1, jpeg.subarray(2)]);
}

test('10. Insured: send a receipt; the upload is re-encoded without EXIF; status is shown', async ({ page }) => {
  await login(page, 'insured');
  const file = await jpegWithExif(page);
  expect(file.includes(Buffer.from('Exif'))).toBe(true);
  await page.goto('/app/claims/new');
  await page.getByTestId('receipt-input').setInputFiles({ name: 'receipt.jpg', mimeType: 'image/jpeg', buffer: file });
  await expect(page.getByText('Чек распознан')).toBeVisible();
  await page.getByRole('button', { name: 'Лекарства' }).click();
  await page.getByRole('button', { name: 'Продолжить' }).click();
  await page.getByRole('button', { name: 'Отправить' }).click();
  await expect(page).toHaveURL(/\/app\/claims\/[0-9a-f-]{36}$/);
  await expect(page.getByText('Получили').first()).toBeVisible();
  const claimId = page.url().split('/').pop()!;

  // Inspect the stored upload as staff (same in-page mock server).
  await page.getByRole('button', { name: 'Войти как…' }).click();
  await page.getByRole('menuitem', { name: /Оператор/ }).click();
  await expect(page).toHaveURL(/\/staff$/);
  const claim = (await api(page, 'GET', `/claims/${claimId}`)).data as { attachments: { url: string; mime: string }[] };
  expect(claim.attachments).toHaveLength(1);
  expect(claim.attachments[0]!.mime).toBe('image/jpeg');
  const b64 = await page.evaluate(async (url) => {
    const sid = (JSON.parse(sessionStorage.getItem('mig.session')!) as { sessionId: string }).sessionId;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${sid}` } });
    const bytes = new Uint8Array(await res.arrayBuffer());
    let s = '';
    for (const x of bytes) s += String.fromCharCode(x);
    return btoa(s);
  }, claim.attachments[0]!.url);
  const stored = Buffer.from(b64, 'base64');
  expect(stored.subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]));
  expect(stored.includes(Buffer.from('Exif'))).toBe(false);
  expect(stored.includes(Buffer.from('GPSLatitude'))).toBe(false);
});

test('11. Four eyes: underwriter cannot approve own limit request', async ({ page }) => {
  await loginStaff(page, 'underwriter');
  await page.goto('/staff/limit-requests?status=pending');
  const own = page.locator('tbody tr[data-row]').filter({ hasText: 'Вы' }).first();
  await expect(own.getByRole('button', { name: 'Подтвердить' })).toBeDisabled();
  await expect(own.getByTestId('four-eyes-hint')).toHaveAttribute('aria-label', 'Нужно подтверждение другого сотрудника');
  const other = page.locator('tbody tr[data-row]').filter({ hasNotText: 'Вы' }).first();
  await expect(other.getByRole('button', { name: 'Подтвердить' })).toBeEnabled();

  const reqs = (await api(page, 'GET', '/limit-requests?status=pending')).data as { id: string; requestedByName: string }[];
  const me = (await api(page, 'GET', '/auth/me')).data as { displayName: string };
  const mine = reqs.find((r) => r.requestedByName === me.displayName)!;
  const res = await api(page, 'POST', `/limit-requests/${mine.id}/approve`);
  expect(res.status).toBe(409);
});

test('12. Inactivity timeout: warning, then logout', async ({ page }) => {
  await page.clock.install();
  await loginStaff(page, 'operator');
  await page.clock.fastForward('13:05');
  await expect(page.getByRole('dialog', { name: 'Вы ещё здесь?' })).toBeVisible();
  await expect(page.getByTestId('idle-countdown')).toHaveText(/^1:\d\d$/);
  await page.clock.fastForward('02:00');
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByText('Сессия завершена из-за неактивности. Войдите снова')).toBeVisible();
});
