import { expect, type Page } from '@playwright/test';
import type { Role } from '../src/shared/types';

export const PASSWORD = 'Demo-2026!';
export const CODE = '000000';
export const EMAIL: Record<Exclude<Role, 'insured'>, string> = {
  operator: 'operator@demo.mig.uz',
  underwriter: 'underwriter@demo.mig.uz',
  doctor_expert: 'doctor@demo.mig.uz',
  accountant: 'accountant@demo.mig.uz',
  admin: 'admin@demo.mig.uz',
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

export async function loginInsured(page: Page): Promise<void> {
  await page.goto('/app/login');
  await page.getByLabel(/Номер телефона/).fill('900000001');
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
 * Calls the (mocked) API from inside the page. The mock runs in the page's service worker, so
 * Playwright's `page.request` would bypass it; an in-page fetch goes through it like the app does.
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
      const raw = sessionStorage.getItem('mig.session');
      const sid = raw ? (JSON.parse(raw) as { sessionId: string }).sessionId : '';
      const h: Record<string, string> = { ...headers };
      if (sid) h.Authorization = `Bearer ${sid}`;
      if (body !== undefined) h['Content-Type'] = 'application/json';
      const res = await fetch(`/api${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
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
