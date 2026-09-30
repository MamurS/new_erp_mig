import { expect, test } from '@playwright/test';
import { acceptConsent, api, failOnDialog, login, loginStaff } from './helpers';

test('5. Masking: PINFL absent until reveal, visible 30 s, then masked again; audit written', async ({ page }) => {
  await page.clock.install();
  await loginStaff(page, 'operator');
  const list = (await api(page, 'GET', '/insured?pageSize=1')).data as { items: { id: string }[] };
  const id = list.items[0]!.id;
  await page.goto(`/staff/insured/${id}`);
  await expect(page.getByTestId('masked-pinfl')).toBeVisible();
  const before = await page.locator('body').innerText();
  expect(before).not.toMatch(/\d{14}/);
  expect(await page.title()).not.toMatch(/[А-Я][а-я]+ [А-Я][а-я]+/);

  await page.getByRole('button', { name: 'Показать ПИНФЛ' }).click();
  await page.getByRole('button', { name: 'Показать', exact: true }).click();
  await expect(page.getByText('Опишите причину: минимум 10 символов')).toBeVisible();
  await page.getByRole('button', { name: 'Звонок застрахованного' }).click();
  await page.getByRole('button', { name: 'Показать', exact: true }).click();
  const revealed = page.getByTestId('revealed-pinfl');
  await expect(revealed).toHaveText(/^\d{14}$/);
  const pinfl = (await revealed.textContent())!;
  expect(await page.content()).toContain(pinfl);

  await page.clock.fastForward(31_000);
  await expect(page.getByTestId('masked-pinfl')).toBeVisible();
  expect(await page.content()).not.toContain(pinfl);

  await page.getByRole('tab', { name: 'Журнал доступа' }).click();
  await expect(page.getByRole('cell', { name: 'Просмотр ПДн' }).first()).toBeVisible();
  await expect(page.getByRole('cell', { name: /Звонок застрахованного/ }).first()).toBeVisible();
  // The audit trail (admin view) has the entry too — switch role in the same mock via the demo banner.
  await page.getByRole('button', { name: 'Войти как…' }).click();
  await page.getByRole('menuitem', { name: /^Администратор(?! клиники)/ }).click();
  await expect(page).toHaveURL(/\/staff$/);
  await page.goto('/staff/audit?action=reveal_pii');
  await expect(page.getByRole('cell', { name: /ПИНФЛ: Звонок застрахованного/ }).first()).toBeVisible();
  expect(await page.content()).not.toContain(pinfl);
});

test('6. HR pages show no diagnoses, claims or appointments of employees', async ({ page }) => {
  const bodies: string[] = [];
  page.on('response', async (r) => {
    if (r.url().includes('/api/hr/')) bodies.push(await r.text().catch(() => ''));
  });
  await login(page, 'hr');
  for (const path of ['/hr', '/hr/documents', '/hr/stats', '/hr/help', '/hr/employees/new', '/hr/import']) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    const text = await page.locator('main').innerText();
    expect(text, path).not.toMatch(/У-\d{4}-\d{6}/); // claim numbers
    expect(text, path).not.toMatch(/\b[A-TV-Z]\d{2}\.\d\b/); // ICD-10 codes
    expect(text, path).not.toMatch(/Терапевт|Стоматолог|Кардиолог|Невролог/); // appointments
    expect(text, path).not.toMatch(/\d{14}/); // PINFL
  }
  const all = bodies.join('\n');
  expect(all).not.toMatch(/diagnosisCode|amountClaimed|specialty|pinfl"|birthDate"/);
});

test('7. XSS strings from the seed render as text; javascript: links are not clickable', async ({ page }) => {
  failOnDialog(page);
  await loginStaff(page, 'operator');
  await page.goto('/staff/clients');
  await expect(page.getByText('<img src=x onerror=alert(1)>').first()).toBeVisible();
  expect(await page.locator('img[src="x"]').count()).toBe(0);

  await page.getByRole('button', { name: 'Войти как…' }).click();
  await page.getByRole('menuitem', { name: /HR клиента/ }).click();
  await expect(page).toHaveURL(/\/hr$/);
  await page.getByRole('searchbox').fill('script');
  await expect(page.getByText('"><script>alert(1)</script>').first()).toBeVisible();
  expect(await page.locator('main script').count()).toBe(0);

  await page.getByRole('button', { name: 'Войти как…' }).click();
  await page.getByRole('menuitem', { name: /Застрахованный/ }).click();
  await acceptConsent(page);
  await page.goto('/app/chat');
  await expect(page.getByText('javascript:alert(1)')).toBeVisible();
  expect(await page.locator('a[href^="javascript"]').count()).toBe(0);
  const safe = page.getByRole('link', { name: 'https://example.com' });
  await expect(safe).toHaveAttribute('rel', /noopener/);
  await expect(safe).toHaveAttribute('target', '_blank');
  await page.getByText('javascript:alert(1)').click();
  await page.waitForTimeout(300);
});

test('8. CSP: no violations on the main pages', async ({ page }) => {
  const violations: string[] = [];
  page.on('console', (m) => {
    if (/Content Security Policy|Refused to/i.test(m.text())) violations.push(m.text());
  });
  // Also catch violations reported to the page itself (survives across navigations via init script).
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (e) => {
      console.error(`Content Security Policy violation: ${e.violatedDirective} ${e.blockedURI}`);
    });
  });
  const res = await page.goto('/login');
  expect(res?.headers()['content-security-policy']).toContain("script-src 'self'");
  await loginStaff(page, 'operator');
  for (const p of ['/staff', '/staff/clients', '/staff/claims', '/staff/appointments?view=day', '/staff/limit-requests']) {
    await page.goto(p);
    await page.waitForLoadState('networkidle');
  }
  await page.getByRole('button', { name: 'Войти как…' }).click();
  await page.getByRole('menuitem', { name: /Андеррайтер/ }).click();
  await expect(page).toHaveURL(/\/(staff|hr)$/);
  await page.goto('/staff/reports');
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: 'Войти как…' }).click();
  await page.getByRole('menuitem', { name: /HR клиента/ }).click();
  await expect(page).toHaveURL(/\/(staff|hr)$/);
  for (const p of ['/hr', '/hr/stats', '/hr/documents']) {
    await page.goto(p);
    await page.waitForLoadState('networkidle');
  }
  await page.getByRole('button', { name: 'Войти как…' }).click();
  await page.getByRole('menuitem', { name: /Застрахованный/ }).click();
  await acceptConsent(page);
  for (const p of ['/app', '/app/card', '/app/booking', '/app/claims', '/app/chat']) {
    await page.goto(p);
    await page.waitForLoadState('networkidle');
  }
  expect(violations).toEqual([]);
});
