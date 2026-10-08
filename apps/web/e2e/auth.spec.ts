import { expect, test } from '@playwright/test';
import { login, ROLES, HOME, logoutFromSidebar } from './helpers';

test.describe('1. Login with every role, MFA, logout', () => {
  for (const role of ROLES) {
    test(`${role}: login → home → logout`, async ({ page }) => {
      await login(page, role);
      await expect(page).toHaveURL(new RegExp(`${HOME[role]}$`));
      if (role === 'insured') {
        await page.goto('/app/profile');
        // Wait for the profile data and the web fonts: until then the text above re-flows and the
        // buttons move, so a click aimed at «Выйти» could land next to it.
        await expect(page.getByText('Karimov Aziz Bahromovich')).toBeVisible();
        await page.evaluate(() => document.fonts.ready.then(() => undefined));
        await page.getByRole('button', { name: 'Выйти', exact: true }).click();
        await expect(page).toHaveURL(/\/app\/login/);
      } else if (role === 'hr' || role === 'clinic_registrar' || role === 'clinic_admin') {
        await page.getByRole('button', { name: 'Меню пользователя' }).click();
        await page.getByRole('menuitem', { name: 'Выйти' }).click();
        await expect(page).toHaveURL(/\/login/);
      } else {
        // Staff and assistance portals: «Выйти» in the side navigation.
        await logoutFromSidebar(page);
        await expect(page).toHaveURL(/\/login/);
      }
      // Session is gone: protected pages redirect to login again.
      await page.goto(HOME[role]);
      await expect(page).toHaveURL(/login/);
    });
  }

  test('wrong password shows a generic error', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill('operator@demo.mig.uz');
    await page.getByLabel('Пароль').fill('wrong-password');
    await page.getByRole('button', { name: 'Войти', exact: true }).click();
    await expect(page.getByText('Неверный email или пароль')).toBeVisible();
  });

  test('logout is synchronised between two tabs', async ({ context }) => {
    const a = await context.newPage();
    const b = await context.newPage();
    await login(a, 'operator');
    await login(b, 'operator');
    await logoutFromSidebar(a);
    await expect(a).toHaveURL(/\/login/);
    await expect(b).toHaveURL(/\/login/);
    await expect(b.getByText('Вы вышли в другой вкладке')).toBeVisible();
  });

  test('?next= keeps internal targets only', async ({ page }) => {
    await page.goto('/staff/claims?status=new');
    await expect(page).toHaveURL(/\/login\?next=/);
    await page.getByLabel('Email').fill('operator@demo.mig.uz');
    await page.getByLabel('Пароль').fill('Demo-2026!');
    await page.getByRole('button', { name: 'Войти', exact: true }).click();
    await page.getByLabel('Цифра 1').fill('000000');
    await expect(page).toHaveURL(/\/staff\/claims\?status=new$/);
  });

  test('a signed-in user is not sent to another portal by ?next= (no 403 after a role switch)', async ({ page }) => {
    await login(page, 'doctor_expert');
    await page.goto('/login?next=%2Fclinic%2Fguarantees');
    await expect(page).toHaveURL(/\/staff$/);
    await page.goto('/login?next=%2Fstaff%2Fclaims');
    await expect(page).toHaveURL(/\/staff\/claims$/);
  });
});
