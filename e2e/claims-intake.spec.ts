import { expect, test, type Page } from '@playwright/test';
import { api, loginStaff } from './helpers';

/*
 * A claim registered by the claims officer (claims@): «+ Создать → Убыток» opens the claim form on the claims page,
 * the insured person is found in the form, the source is «Звонок». The claim lands in «Новые» with its reserve set
 * to the claimed amount. «+ Убыток» on the insured card opens the same form with the person preset.
 */
type Person = { id: string; fullName: string };

async function person(page: Page): Promise<Person> {
  const list = (await api(page, 'GET', '/insured?pageSize=1')).data as { items: Person[] };
  return list.items[0]!;
}

/** Yesterday in Tashkent, as typed into the date field. */
function yesterday(): string {
  const d = new Date(Date.now() + 5 * 3600_000 - 24 * 3600_000).toISOString().slice(0, 10);
  return d.split('-').reverse().join('.');
}

async function jpeg(page: Page): Promise<Buffer> {
  const b64 = await page.evaluate(async () => {
    const c = document.createElement('canvas');
    c.width = 240;
    c.height = 160;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.fillStyle = '#000';
    ctx.fillText('HR LETTER', 10, 40);
    const blob = await new Promise<Blob>((r) => c.toBlob((b) => r(b!), 'image/jpeg', 0.9));
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let s = '';
    for (const x of bytes) s += String.fromCharCode(x);
    return btoa(s);
  });
  return Buffer.from(b64, 'base64');
}

async function fillClaim(page: Page, amount: string, provider: string) {
  const dialog = page.getByRole('dialog', { name: 'Новый убыток' });
  await dialog.getByLabel('Источник обращения').selectOption({ label: 'Звонок' });
  await dialog.getByLabel('Категория').selectOption({ label: 'Приём врача' });
  await dialog.getByLabel('Сумма, UZS').fill(amount);
  await dialog.getByLabel('Дата услуги').fill(yesterday());
  await dialog.getByLabel('Клиника или аптека').fill(provider);
  return dialog;
}

test('claims officer: «+ Создать → Убыток» → find the insured → source «Звонок» → «Новые» with the reserve', async ({ page }) => {
  await loginStaff(page, 'claims_officer');
  const p = await person(page);
  await page.getByTestId('topbar').getByRole('button', { name: 'Создать', exact: true }).click();
  await page.getByRole('menuitem', { name: /^Убыток/ }).click();
  await expect(page).toHaveURL(/\/staff\/claims$/);
  const dialog = page.getByRole('dialog', { name: 'Новый убыток' });
  await expect(dialog).toBeVisible();

  // Without the insured person the form does not go.
  await dialog.getByRole('button', { name: 'Создать убыток' }).click();
  await expect(dialog.getByText('Выберите застрахованного')).toBeVisible();

  await dialog.getByLabel('Застрахованный').fill(p.fullName.split(' ').slice(0, 2).join(' '));
  await dialog.getByRole('button', { name: new RegExp(`^${p.fullName}`) }).first().click();
  await expect(dialog.getByLabel('Застрахованный')).toHaveValue(p.fullName);
  await fillClaim(page, '1234500', 'Klinika Intake Test');
  await expect(dialog.getByText('Резерв устанавливается на заявленную сумму при регистрации')).toBeVisible();
  await dialog.getByLabel('Добавить файлы').setInputFiles([
    { name: 'letter.jpg', mimeType: 'image/jpeg', buffer: await jpeg(page) },
    { name: 'note.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n%%EOF\n', 'latin1') },
  ]);
  await expect(dialog.getByText('document-1.jpg')).toBeVisible();
  await expect(dialog.getByText('document-2.pdf')).toBeVisible();
  await dialog.getByRole('button', { name: 'Создать убыток' }).click();

  // The claim card: source of the request, attachments and the reserve equal to the claimed amount.
  await expect(page).toHaveURL(/\/staff\/claims\/[0-9a-f-]{36}$/);
  const number = (await page.locator('h1').innerText()).trim();
  await expect(page.locator('div', { has: page.getByText('Канал поступления', { exact: true }) }).last()).toContainText('Звонок');
  await expect(page.getByTestId('claim-reserve')).toHaveText(/1\s?234\s?500/);
  await expect(page.getByText('Регистрация: заявленная сумма')).toBeVisible();

  // «Новые» of the claims officer's workplace.
  await page.goto('/staff/claims?tab=new');
  await expect(page.getByRole('tab', { name: 'Новые' })).toHaveAttribute('aria-selected', 'true');
  const row = page.getByRole('row', { name: new RegExp(number) });
  await expect(row).toBeVisible();
  await expect(row).toContainText(/1\s?234\s?500/);

  // And the dashboard queue: a new claim.
  await page.goto('/staff');
  await page.getByTestId('queue-tabs').getByRole('tab', { name: /^Убытки/ }).click();
  // More than 15 claims wait in the seed: the new one (due in 5 days) is behind «Показать все».
  await page.getByRole('button', { name: /^Показать все/ }).click();
  const queueRow = page.getByRole('table', { name: 'Очередь задач' }).getByRole('row', { name: new RegExp(number) });
  await expect(queueRow).toContainText('Новый');
});

test('claims officer: «+ Убыток» on the insured card opens the form with the person preset', async ({ page }) => {
  await loginStaff(page, 'claims_officer');
  const p = await person(page);
  await page.goto(`/staff/insured/${p.id}`);
  await page.getByRole('button', { name: 'Убыток', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Новый убыток' });
  await expect(dialog.getByLabel('Застрахованный')).toHaveValue(p.fullName);
  await expect(dialog.getByLabel('Застрахованный')).toHaveAttribute('readonly', '');
  await fillClaim(page, '450000', 'Apteka Card Test');
  await dialog.getByRole('button', { name: 'Создать убыток' }).click();
  await expect(page).toHaveURL(/\/staff\/claims\/[0-9a-f-]{36}$/);
  await expect(page.getByTestId('claim-reserve')).toHaveText(/450\s?000/);
  await expect(page.getByRole('link', { name: p.fullName })).toBeVisible();
});
