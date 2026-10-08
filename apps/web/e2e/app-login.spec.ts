/*
 * Sign-in to the insured app: the screen says who the app is for, and a wrong code and a number that is
 * not among the insured look exactly the same — the app never tells who is insured.
 */
import { expect, test, type Page } from '@playwright/test';
import { uzLatn } from '@mig/i18n/dict/uz-Latn/index';
import { en } from '@mig/i18n/dict/en/index';
import { INSURED_PHONE } from './helpers';

const CAPTION = 'Для сотрудников компаний — клиентов МИГ и членов их семей';
const HR_HINT = 'Код не подошёл или этот номер не найден среди застрахованных. Проверьте код. Если номер верный — обратитесь к HR вашей компании.';
const UNKNOWN_PHONE = '+998 93 765 43 21';

async function requestCode(page: Page, phone: string): Promise<void> {
  await page.goto('/app/login');
  await page.getByLabel(/Номер телефона/).fill(phone.replace(/\D/g, '').replace(/^998/, ''));
  await page.getByRole('button', { name: 'Получить код' }).click();
  await expect(page).toHaveURL(/\/app\/login\/code/);
}

async function rejectedText(page: Page, code: string): Promise<string> {
  await page.getByLabel('Цифра 1').fill(code);
  const alert = page.getByRole('alert');
  await expect(alert).toBeVisible();
  await expect(page).toHaveURL(/\/app\/login\/code/);
  return (await alert.textContent()) ?? '';
}

test('the sign-in screen says who the app is for, in every language, with no hint about the number', async ({ page }) => {
  await page.goto('/app/login');
  await expect(page.getByText(CAPTION)).toBeVisible();
  await expect(page.getByText(/не найден|HR/)).toHaveCount(0);
  await page.getByTestId('lang-switch').getByRole('button', { name: 'Oʻzbekcha' }).click();
  await expect(page.getByText(uzLatn['app.login.audience']!)).toBeVisible();
  await page.getByTestId('lang-switch').getByRole('button', { name: 'English' }).click();
  await expect(page.getByText(en['app.login.audience']!)).toBeVisible();
});

test('an unknown number gets a code screen too; a wrong code and an unknown number show the same HR hint', async ({ page }) => {
  // A number that is not among the insured is not rejected at the phone step.
  await requestCode(page, UNKNOWN_PHONE);
  await expect(page.getByRole('alert')).toHaveCount(0);
  const unknown = await rejectedText(page, '000000');

  // A real insured number with a typo in the code.
  await requestCode(page, INSURED_PHONE);
  const wrongCode = await rejectedText(page, '111111');

  expect(unknown).toBe(HR_HINT);
  expect(wrongCode).toBe(unknown);
  await expect(page.getByText('Ошибка входа')).toHaveCount(0);
});
