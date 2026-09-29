import { expect, test } from '@playwright/test';
import type { Role } from '../src/shared/types';
import { api, login } from './helpers';

const FORBIDDEN_ROUTES: Record<Role, string[]> = {
  operator: ['/staff/reports', '/staff/audit', '/staff/admin/users', '/hr', '/app'],
  underwriter: ['/staff/claims', '/staff/appointments', '/staff/audit', '/staff/admin/users', '/hr'],
  doctor_expert: ['/staff/clients', '/staff/policies', '/staff/reports', '/staff/audit', '/staff/limit-requests'],
  accountant: ['/staff/insured/00000000-0000-4000-8000-000000000000', '/staff/appointments', '/staff/clinics', '/staff/audit', '/staff/limit-requests'],
  admin: ['/staff/claims', '/staff/policies', '/staff/appointments', '/staff/reports', '/staff/insured/00000000-0000-4000-8000-000000000000'],
  hr: ['/staff', '/staff/clients', '/app'],
  insured: ['/staff', '/hr', '/staff/claims'],
};

test.describe('2. Route matrix: forbidden routes lead to /403', () => {
  for (const [role, routes] of Object.entries(FORBIDDEN_ROUTES) as [Role, string[]][]) {
    test(role, async ({ page }) => {
      await login(page, role);
      for (const r of routes) {
        await page.goto(r);
        await expect(page, `${role} → ${r}`).toHaveURL(/\/403$/);
        await expect(page.getByRole('heading', { name: 'Нет доступа' })).toBeVisible();
      }
    });
  }
});

const FORBIDDEN_API: Record<Role, [string, string, unknown?][]> = {
  operator: [['GET', '/audit'], ['GET', '/admin/users'], ['GET', '/reports/premium-by-month'], ['POST', '/exports', { type: 'clients' }], ['GET', '/hr/employees']],
  underwriter: [['GET', '/claims'], ['GET', '/appointments'], ['GET', '/audit'], ['POST', '/exports', { type: 'claims_financial' }]],
  doctor_expert: [['GET', '/clients'], ['GET', '/policies'], ['GET', '/reports/loss-ratio-by-client'], ['GET', '/admin/users']],
  accountant: [['GET', '/audit'], ['GET', '/appointments'], ['GET', '/clinics'], ['POST', '/limit-requests', {}]],
  admin: [['GET', '/claims'], ['GET', '/policies'], ['GET', '/appointments'], ['GET', '/reports/loss-ratio-by-client']],
  hr: [['GET', '/clients'], ['GET', '/claims'], ['GET', '/insured'], ['GET', '/audit'], ['GET', '/me/claims'], ['POST', '/exports', { type: 'clients' }]],
  insured: [['GET', '/clients'], ['GET', '/claims'], ['GET', '/insured'], ['GET', '/hr/employees'], ['GET', '/audit'], ['GET', '/dashboard']],
};

test.describe('3. API matrix: forbidden endpoints answer 403/404', () => {
  for (const [role, calls] of Object.entries(FORBIDDEN_API) as [Role, [string, string, unknown?][]][]) {
    test(role, async ({ page }) => {
      await login(page, role);
      for (const [method, path, body] of calls) {
        const r = await api(page, method, path, body);
        expect([403, 404], `${role} ${method} ${path} → ${r.status}`).toContain(r.status);
      }
      // A client-supplied role header is ignored.
      const spoof = await api(page, 'GET', '/audit', undefined, { 'X-Role': 'admin' });
      if (role !== 'admin') expect([403, 404]).toContain(spoof.status);
    });
  }

  test('no session → 401', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByLabel('Email')).toBeVisible(); // mocks are running once the app renders
    expect((await api(page, 'GET', '/dashboard')).status).toBe(401);
  });
});

test.describe('4. IDOR', () => {
  test('insured gets 404 for a foreign claim id', async ({ page }) => {
    await login(page, 'operator');
    const list = (await api(page, 'GET', '/claims?pageSize=5')).data as { items: { id: string; insuredName: string }[] };
    const foreign = list.items.find((c) => !c.insuredName.startsWith('Каримов Азиз'))!;
    await page.getByRole('button', { name: 'Профиль и выход' }).click();
    await page.getByRole('menuitem', { name: 'Выйти' }).click();
    await login(page, 'insured');
    expect((await api(page, 'GET', `/me/claims/${foreign.id}`)).status).toBe(404);
    const mine = (await api(page, 'GET', '/me/claims')).data as { id: string }[];
    expect((await api(page, 'GET', `/me/claims/${mine[0]!.id}`)).status).toBe(200);
    await page.goto(`/app/claims/${foreign.id}`);
    await expect(page.getByText('Такого возмещения нет')).toBeVisible();
  });

  test('hr gets 404 for another company’s employee', async ({ page }) => {
    await login(page, 'operator');
    const others = (await api(page, 'GET', '/insured?pageSize=100')).data as { items: { id: string; clientName: string }[] };
    const foreign = others.items.find((i) => i.clientName !== 'Ташкент Агрологистика')!;
    await page.getByRole('button', { name: 'Профиль и выход' }).click();
    await page.getByRole('menuitem', { name: 'Выйти' }).click();
    await login(page, 'hr');
    expect((await api(page, 'GET', `/hr/employees/${foreign.id}`)).status).toBe(404);
    expect((await api(page, 'DELETE', `/hr/employees/${foreign.id}`, { excludeFrom: '2026-12-01' })).status).toBe(404);
  });
});
