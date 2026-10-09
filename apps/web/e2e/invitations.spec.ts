/*
 * Invitations of e-mail accounts (stage 1.5), in both runs: the administrator invites an employee; the e-mail's link
 * (the mock's outbox; Mailpit against the backend) opens «Задать пароль»; the person signs in with it — against the
 * backend the first sign-in sets up a real TOTP authenticator (its code is computed from the secret on the screen).
 * The link works once; «Отправить повторно» revokes it.
 */
import { totpCode } from '@mig/domain/auth/devMfa';
import { BACKEND, expect, test, type Page } from './test';
import { api, CODE, loginStaff, logoutFromSidebar } from './helpers';

const MAILPIT = process.env.MAILPIT_URL ?? 'http://127.0.0.1:8025';
const PASSWORD = 'Novyi-parol-2026';

/** The token of the newest invitation e-mail to `to`: the mock's outbox, or Mailpit (the worker sends within seconds). */
async function invitationToken(page: Page, to: string, not?: string): Promise<string> {
  let token: string | undefined;
  await expect(async () => {
    let text = '';
    if (BACKEND) {
      const r = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}&limit=1`);
      const { messages } = (await r.json()) as { messages: { ID: string }[] };
      if (messages[0]) text = ((await (await fetch(`${MAILPIT}/api/v1/message/${messages[0].ID}`)).json()) as { Text: string }).Text;
    } else {
      await api(page, 'GET', '/auth/me');
      const mails = (await api(page, 'GET', '/__demo/outbox')).data as { to: string; text: string }[];
      text = mails.find((m) => m.to === to)?.text ?? '';
    }
    token = /\/invite#([A-Za-z0-9_-]+)/.exec(text)?.[1];
    expect(token).toBeTruthy();
    expect(token).not.toBe(not);
  }).toPass({ timeout: 30_000 });
  return token!;
}

const uniqueEmail = () => `invited.${Date.now().toString(36)}@demo.mig.uz`;

test('an invited employee sets a password by the e-mail link and signs in; the link works once', async ({ page }) => {
  const email = uniqueEmail();
  await loginStaff(page, 'admin');
  await page.goto('/staff/admin/users');
  await page.getByRole('button', { name: 'Пригласить сотрудника' }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('ФИО').fill('Karimov Aziz Bahodirovich');
  await dialog.getByLabel('Рабочая почта').fill(email);
  await dialog.getByRole('button', { name: 'Пригласить', exact: true }).click();
  await expect(page.getByText('Приглашение отправлено').first()).toBeVisible();
  const row = page.getByRole('row').filter({ hasText: email });
  await expect(row.getByText(/Приглашение (отправлено|в очереди на отправку)/)).toBeVisible();
  await expect(row.getByRole('button', { name: 'Отправить приглашение повторно: Karimov Aziz Bahodirovich' })).toBeVisible();
  const token = await invitationToken(page, email);
  await logoutFromSidebar(page);

  await page.goto(`/invite#${token}`);
  await expect(page.getByRole('heading', { name: 'Приглашение в ДМС МИГ' })).toBeVisible();
  // The token leaves the address bar at once.
  expect(new URL(page.url()).hash).toBe('');
  await page.getByLabel('Новый пароль').fill('short1');
  await page.getByLabel('Повторите пароль').fill('short1');
  await page.getByRole('button', { name: 'Задать пароль' }).click();
  await expect(page.getByText('Не короче 12 символов').first()).toBeVisible();
  await page.getByLabel('Новый пароль').fill(PASSWORD);
  await page.getByLabel('Повторите пароль').fill(PASSWORD);
  await page.getByRole('button', { name: 'Задать пароль' }).click();
  await expect(page.getByRole('heading', { name: 'Пароль задан' })).toBeVisible();
  await page.getByRole('link', { name: 'Перейти ко входу' }).click();

  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Пароль').fill(PASSWORD);
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await expect(page).toHaveURL(/\/login\/otp/);
  if (BACKEND) {
    // The first sign-in: a real authenticator, its code from the secret shown under «ввести ключ вручную».
    const enrollment = page.getByTestId('totp-enrollment');
    await expect(enrollment.getByTestId('totp-qr')).toBeVisible();
    const secret = ((await enrollment.getByTestId('totp-secret').textContent()) ?? '').replace(/\s+/g, '');
    expect(secret).toMatch(/^[A-Z2-7]{16,}$/);
    await page.getByLabel('Цифра 1').fill(totpCode(secret));
  } else {
    await page.getByLabel('Цифра 1').fill(CODE);
  }
  await expect(page).toHaveURL(/\/staff$/);
  await logoutFromSidebar(page);

  // Used: the link no longer works.
  await page.goto(`/invite#${token}`);
  await expect(page.getByRole('heading', { name: 'Ссылка не работает' })).toBeVisible();
  await expect(page.getByText('Пароль уже задан: приглашение использовано')).toBeVisible();
});

test('«Отправить повторно»: a new e-mail, the old link stops working; a broken link explains what to do', async ({ page }) => {
  const email = uniqueEmail();
  await loginStaff(page, 'admin');
  const created = await api(page, 'POST', '/admin/users', { fullName: 'Rasulova Dilnoza Akmalovna', email, role: 'operator' });
  expect(created.status).toBe(201);
  const first = await invitationToken(page, email);
  await page.goto('/staff/admin/users');
  await page.getByRole('row').filter({ hasText: email }).getByRole('button', { name: 'Отправить приглашение повторно: Rasulova Dilnoza Akmalovna' }).click();
  await expect(page.getByText('Приглашение отправлено повторно. Прежняя ссылка больше не работает')).toBeVisible();
  const second = await invitationToken(page, email, first);
  expect(second).not.toBe(first);
  await logoutFromSidebar(page);

  await page.goto(`/invite#${first}`);
  await expect(page.getByRole('heading', { name: 'Ссылка не работает' })).toBeVisible();
  await expect(page.getByText('Попросите администратора отправить приглашение повторно.')).toBeVisible();
  await page.goto('/login');
  await page.goto(`/invite#${second}`);
  await expect(page.getByRole('heading', { name: 'Приглашение в ДМС МИГ' })).toBeVisible();
  await page.goto('/login');
  await page.goto('/invite');
  await expect(page.getByText('Ссылка неполная. Откройте её из письма целиком.')).toBeVisible();
});
