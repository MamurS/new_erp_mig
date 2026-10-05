/* Collapsible side navigation of the staff and assistance portals. */
import { expect, test } from '@playwright/test';
import { loginStaff } from './helpers';

test('staff: groups by role, collapse with the button and Ctrl+B, the choice survives a reload, tooltips when collapsed', async ({ page }) => {
  await loginStaff(page, 'accountant');
  const nav = page.getByTestId('sidebar');
  await expect(nav).toHaveAttribute('data-collapsed', 'false');
  const box = await nav.boundingBox();
  expect(box!.width).toBeGreaterThan(230);
  // Only groups with sections of the role; «Финансы» holds the accountant's money work.
  await expect(nav.getByRole('group', { name: 'Финансы' })).toBeVisible();
  await expect(nav.getByRole('group', { name: 'Финансы' }).getByRole('link')).toHaveCount(3);
  await expect(nav.getByRole('group', { name: 'Администрирование' }).getByRole('link')).toHaveCount(1);
  await expect(nav.getByRole('group', { name: 'Продажи и андеррайтинг' }).getByRole('link', { name: /^Сделки/ })).toHaveCount(0);
  await expect(nav.getByRole('link', { name: /^Ручная разноска, задач: \d+$/ })).toBeVisible();
  await expect(nav.getByTestId('sidebar-user')).toContainText('Бухгалтер');

  const toggle = nav.getByRole('button', { name: 'Свернуть меню' });
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await toggle.click();
  await expect(nav).toHaveAttribute('data-collapsed', 'true');
  await expect.poll(async () => (await nav.boundingBox())!.width).toBeLessThan(70);
  await expect(nav.getByRole('button', { name: 'Развернуть меню' })).toHaveAttribute('aria-expanded', 'false');
  await expect(nav.getByTestId('nav-dot').first()).toBeVisible();
  // The table takes the freed width.
  const main = await page.getByRole('main').boundingBox();
  expect(main!.x).toBeLessThan(80);

  // The name is a tooltip on hover and on keyboard focus.
  await nav.getByRole('link', { name: /^Счета ассистансов/ }).hover();
  await expect(page.getByRole('tooltip')).toContainText('Счета ассистансов');

  await page.reload();
  await expect(page.getByTestId('sidebar')).toHaveAttribute('data-collapsed', 'true');
  await page.keyboard.press('Control+b');
  await expect(page.getByTestId('sidebar')).toHaveAttribute('data-collapsed', 'false');
  // Not while typing.
  await page.getByRole('button', { name: 'Открыть поиск' }).first().click();
  await page.keyboard.press('Control+b');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('sidebar')).toHaveAttribute('data-collapsed', 'false');
});

test('narrow screen: the panel is hidden, the burger opens it over the content; Esc, outside click and navigation close it; focus stays inside', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 800 });
  await loginStaff(page, 'underwriter');
  await expect(page.getByTestId('sidebar')).toBeHidden();
  const burger = page.getByRole('button', { name: 'Открыть меню' });
  await burger.click();
  const drawer = page.getByTestId('sidebar-mobile');
  await expect(drawer).toBeVisible();
  // The rest of the page is hidden from assistive tech while the panel is open: check the attribute directly.
  await expect(page.locator('button[aria-label="Открыть меню"]')).toHaveAttribute('aria-expanded', 'true');
  await expect(drawer.getByText('Продажи и андеррайтинг')).toBeVisible();
  // Focus is trapped in the panel.
  for (let i = 0; i < 25; i++) await page.keyboard.press('Tab');
  expect(await page.evaluate(() => !!document.activeElement?.closest('[data-testid="sidebar-mobile"]'))).toBe(true);
  await page.keyboard.press('Escape');
  await expect(drawer).toBeHidden();

  await burger.click();
  await page.mouse.click(880, 400);
  await expect(page.getByTestId('sidebar-mobile')).toBeHidden();

  await burger.click();
  await page.getByTestId('sidebar-mobile').getByRole('link', { name: /^Клиенты/ }).click();
  await expect(page).toHaveURL(/\/staff\/clients$/);
  await expect(page.getByTestId('sidebar-mobile')).toBeHidden();
});

test('assistance portal: the same panel, its own remembered state', async ({ page }) => {
  await loginStaff(page, 'operator');
  await page.getByTestId('sidebar').getByRole('button', { name: 'Свернуть меню' }).click();
  await expect(page.getByTestId('sidebar')).toHaveAttribute('data-collapsed', 'true');

  await page.getByTestId('sidebar').getByRole('button', { name: 'Профиль и выход' }).click();
  await page.getByRole('menuitem', { name: 'Выйти' }).click();
  await loginStaff(page, 'asst_operator');
  const nav = page.getByTestId('sidebar');
  // The staff portal was collapsed; the assistance one starts expanded.
  await expect(nav).toHaveAttribute('data-collapsed', 'false');
  await expect(nav.getByRole('group', { name: 'Работа' }).getByRole('link', { name: /^Обращения/ })).toBeVisible();
  await expect(nav.getByRole('link', { name: /^Пользователи/ })).toHaveCount(0);
  await nav.getByRole('button', { name: 'Свернуть меню' }).click();
  await expect(nav).toHaveAttribute('data-collapsed', 'true');
});
