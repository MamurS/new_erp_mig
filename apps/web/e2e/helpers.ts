import { expect, type Page } from '@playwright/test';
import type { Role } from '@mig/contracts';

export const PASSWORD = 'Demo-2026!';
export const CODE = '000000';
export const EMAIL: Record<Exclude<Role, 'insured'>, string> = {
  operator: 'operator@demo.mig.uz',
  underwriter: 'underwriter@demo.mig.uz',
  doctor_expert: 'doctor@demo.mig.uz',
  accountant: 'accountant@demo.mig.uz',
  admin: 'admin@demo.mig.uz',
  sales_manager: 'sales@demo.mig.uz',
  legal: 'legal@demo.mig.uz',
  claims_officer: 'claims@demo.mig.uz',
  hr: 'hr@demo-client.uz',
  clinic_registrar: 'registrar@demo-clinic.uz',
  clinic_admin: 'admin@demo-clinic.uz',
  asst_operator: 'asst-operator@demo-assist.uz',
  asst_doctor: 'asst-doctor@demo-assist.uz',
  asst_billing: 'asst-billing@demo-assist.uz',
  asst_admin: 'asst-admin@demo-assist.uz',
};
export const HOME: Record<Role, string> = {
  operator: '/staff',
  underwriter: '/staff',
  doctor_expert: '/staff',
  accountant: '/staff',
  admin: '/staff',
  sales_manager: '/staff',
  legal: '/staff',
  claims_officer: '/staff',
  hr: '/hr',
  clinic_registrar: '/clinic',
  clinic_admin: '/clinic',
  asst_operator: '/assist',
  asst_doctor: '/assist',
  asst_billing: '/assist',
  asst_admin: '/assist',
  insured: '/app',
};
export const ROLES: Role[] = ['operator', 'underwriter', 'doctor_expert', 'accountant', 'admin', 'hr', 'clinic_registrar', 'clinic_admin', 'asst_operator', 'asst_doctor', 'asst_billing', 'asst_admin', 'insured'];

/** Fails the test if any JS dialog (alert/confirm) opens — XSS canary. */
export function failOnDialog(page: Page): void {
  page.on('dialog', async (d) => {
    await d.dismiss();
    throw new Error(`Unexpected dialog: ${d.message()}`);
  });
}

export async function loginStaff(page: Page, role: Exclude<Role, 'insured'>): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Email').fill(EMAIL[role]);
  await page.getByLabel('Пароль').fill(PASSWORD);
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await expect(page).toHaveURL(/\/login\/otp/);
  await page.getByLabel('Цифра 1').fill(CODE);
  await expect(page).toHaveURL(new RegExp(`${HOME[role]}$`));
}

/** Demo phones of the app: the employee (default) and the employee's spouse with an own login (FAMILY_SPEC). */
export const INSURED_PHONE = '+998 90 000 00 01';
export const SPOUSE_PHONE = '+998 90 000 00 02';

/** Signs in to the app by phone (the demo employee by default) and accepts the first-login consent. */
export async function loginInsured(page: Page, phone: string = INSURED_PHONE): Promise<void> {
  await page.goto('/app/login');
  await page.getByLabel(/Номер телефона/).fill(phone.replace(/\D/g, '').replace(/^998/, ''));
  await page.getByRole('button', { name: 'Получить код' }).click();
  await expect(page).toHaveURL(/\/app\/login\/code/);
  await page.getByLabel('Цифра 1').fill(CODE);
  await acceptConsent(page);
}

/** First login of the demo insured person always lands on the consent screen. */
export async function acceptConsent(page: Page): Promise<void> {
  await expect(page).toHaveURL(/\/app\/consent/);
  await page.getByRole('checkbox', { name: /согласен/ }).click();
  await page.getByRole('button', { name: 'Продолжить' }).click();
  await expect(page).toHaveURL(/\/app$/);
}

export async function login(page: Page, role: Role): Promise<void> {
  if (role === 'insured') await loginInsured(page);
  else await loginStaff(page, role);
}

/**
 * Calls the API from inside the page, as the app does: the session cookie and the CSRF header. The mock runs in the
 * page (its service worker), so Playwright's `page.request` would bypass it; an in-page fetch goes through it, and
 * against the backend it carries the page's session cookie.
 */
export async function api(
  page: Page,
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<{ status: number; data: unknown }> {
  return page.evaluate(
    async ({ method, path, body, headers }) => {
      const h: Record<string, string> = { 'X-Requested-With': 'mig-web', ...headers };
      if (body !== undefined) h['Content-Type'] = 'application/json';
      const res = await fetch(`/api${path}`, { method, headers: h, credentials: 'include', body: body === undefined ? undefined : JSON.stringify(body) });
      const text = await res.text();
      let data: unknown = text;
      try {
        data = JSON.parse(text);
      } catch {
        /* not json */
      }
      return { status: res.status, data };
    },
    { method, path, body, headers },
  );
}

/** Logs out of any portal with the side panel: the user menu at the bottom of the panel → «Выйти». */
export async function logoutFromSidebar(page: Page): Promise<void> {
  await page.getByTestId('sidebar').getByRole('button', { name: 'Меню пользователя' }).click();
  await page.getByRole('menuitem', { name: 'Выйти' }).click();
}
