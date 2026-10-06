import { expect, test, type Page } from '@playwright/test';
import type { Role } from '../src/shared/types';
import { api, loginStaff } from './helpers';

/*
 * «+ Создать» in the top bar. Expectations follow the permission matrix (src/shared/auth/permissions.ts; the
 * same table is unit-tested in src/features/shell/createItems.test.ts): label of every enabled item, in order,
 * and the automatic documents explained to the role.
 */
type PortalRole = Exclude<Role, 'insured'>;
const AUTO = {
  policy: ['Полис', 'Полис выпускается автоматически после подписания и оплаты договора'],
  endorsement: ['Доп. соглашение', 'Доп. соглашение формируется из заявок на изменение'],
  kp_contract: ['КП и договор', 'КП и договор создаются внутри сделки'],
} as const;
type Auto = keyof typeof AUTO;

const EXPECTED: Record<PortalRole, { items: string[]; auto: Auto[] }> = {
  operator: { items: ['Убыток'], auto: [] },
  underwriter: { items: ['Клиент'], auto: ['policy', 'endorsement', 'kp_contract'] },
  doctor_expert: { items: [], auto: [] },
  accountant: { items: [], auto: [] },
  admin: { items: ['Пользователь', 'Клиника', 'Ассистанс-компания'], auto: [] },
  sales_manager: { items: ['Клиент (лид)', 'Сделка', 'Изменение состава'], auto: ['policy', 'endorsement', 'kp_contract'] },
  legal: { items: [], auto: [] },
  claims_officer: { items: ['Убыток'], auto: [] },
  hr: { items: ['Изменение состава'], auto: ['policy', 'endorsement'] },
  clinic_registrar: { items: ['Гарантийное письмо'], auto: [] },
  clinic_admin: { items: ['Гарантийное письмо', 'Пользователь'], auto: [] },
  asst_operator: { items: ['Обращение'], auto: [] },
  asst_doctor: { items: ['Обращение'], auto: [] },
  asst_billing: { items: [], auto: [] },
  asst_admin: { items: ['Пользователь'], auto: [] },
};

const createButton = (page: Page) => page.getByTestId('topbar').getByRole('button', { name: 'Создать', exact: true });

async function openMenu(page: Page) {
  await createButton(page).click();
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();
  return menu;
}

/** First line of a menu item: its label (the second line is a hint or an explanation). */
async function labels(page: Page, disabled: boolean) {
  const items = page.getByRole('menu').locator(disabled ? '[role="menuitem"][aria-disabled="true"]' : '[role="menuitem"]:not([aria-disabled="true"])');
  return items.evaluateAll((els) => els.map((e) => (e.querySelector('span > span')?.textContent ?? '').trim()));
}

for (const [role, exp] of Object.entries(EXPECTED) as [PortalRole, (typeof EXPECTED)[PortalRole]][]) {
  test(`${role}: «+ Создать» shows exactly the allowed items`, async ({ page }) => {
    await loginStaff(page, role);
    await expect(page.getByTestId('topbar')).toBeVisible();
    if (exp.items.length === 0) {
      await expect(createButton(page)).toHaveCount(0);
      return;
    }
    await expect(createButton(page)).toHaveAttribute('aria-keyshortcuts', 'C');
    await expect(createButton(page)).toHaveAttribute('title', /C/);
    await openMenu(page);
    expect(await labels(page, false)).toEqual(exp.items);
    expect(await labels(page, true)).toEqual(exp.auto.map((a) => AUTO[a][0]));
    for (const a of exp.auto) {
      const item = page.getByRole('menu').locator(`[data-create="${a}"]`);
      await expect(item).toHaveAttribute('aria-disabled', 'true');
      await expect(item).toContainText(AUTO[a][1]);
      await expect(item).toHaveAccessibleDescription(AUTO[a][1]);
    }
  });
}

test('hotkey C opens the menu, but not while typing in the search field or in a dialog', async ({ page }) => {
  await loginStaff(page, 'underwriter');
  await page.goto('/staff/clients');
  await expect(page.getByRole('heading', { name: 'Клиенты' })).toBeVisible();

  await page.keyboard.press('c');
  await expect(page.getByRole('menu')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);

  const search = page.getByPlaceholder('Название или ИНН');
  await search.click();
  await page.keyboard.type('c');
  await expect(search).toHaveValue('c');
  await expect(page.getByRole('menu')).toHaveCount(0);

  // A modifier: Ctrl+C is copying, not «Создать».
  await page.locator('h1').click();
  await page.keyboard.press('Control+c');
  await expect(page.getByRole('menu')).toHaveCount(0);

  // Inside the command palette (a dialog) C is just a letter.
  await page.keyboard.press('Control+k');
  const palette = page.getByRole('dialog');
  await expect(palette).toBeVisible();
  await page.keyboard.type('c');
  await expect(palette.getByRole('combobox')).toHaveValue('c');
  await expect(page.getByRole('menu')).toHaveCount(0);
});

test('client → the lead form; membership change → the change request form', async ({ page }) => {
  await loginStaff(page, 'sales_manager');
  await openMenu(page);
  await page.getByRole('menuitem', { name: /^Клиент \(лид\)/ }).click();
  await expect(page).toHaveURL(/\/staff\/deals$/);
  await expect(page.getByRole('dialog', { name: 'Новый лид' })).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Отмена' }).click();

  await openMenu(page);
  await page.getByRole('menuitem', { name: /^Изменение состава/ }).click();
  await expect(page).toHaveURL(/\/staff\/endorsements$/);
  await expect(page.getByRole('dialog', { name: 'Заявка на изменение' })).toBeVisible();
});

test('underwriter: client → the «Новый клиент» form (the old top-bar button is merged into «+ Создать»)', async ({ page }) => {
  await loginStaff(page, 'underwriter');
  await page.goto('/staff/clients');
  await expect(page.getByTestId('topbar').getByRole('button', { name: /Новый клиент/ })).toHaveCount(0);
  await openMenu(page);
  await page.getByRole('menuitem', { name: /^Клиент/ }).click();
  await expect(page.getByRole('dialog', { name: 'Новый клиент' })).toBeVisible();
  await expect(page).toHaveURL(/\/staff\/clients$/);
});

test('guarantee letter → the patient check of the clinic', async ({ page }) => {
  await loginStaff(page, 'clinic_registrar');
  await openMenu(page);
  await page.getByRole('menuitem', { name: /^Гарантийное письмо/ }).click();
  await expect(page).toHaveURL(/\/clinic\/check$/);
  await expect(page.getByRole('heading', { name: 'Проверка пациента' })).toBeVisible();
});

test('operator: claim → pick the insured person → their card with the claim form', async ({ page }) => {
  await loginStaff(page, 'operator');
  const list = (await api(page, 'GET', '/insured?pageSize=1')).data as { items: { id: string; fullName: string }[] };
  const person = list.items[0]!;
  await openMenu(page);
  await page.getByRole('menuitem', { name: /^Убыток/ }).click();
  const palette = page.getByRole('dialog', { name: 'Новый убыток: выберите застрахованного' });
  await expect(palette).toBeVisible();
  await palette.getByRole('combobox').fill(person.fullName.split(' ').slice(0, 2).join(' '));
  await palette.getByRole('option', { name: new RegExp(`^${person.fullName}`) }).first().click();
  await expect(page).toHaveURL(new RegExp(`/staff/insured/${person.id}$`));
  await expect(page.getByRole('dialog', { name: 'Новый убыток' })).toBeVisible();
});

test('admin: user → the invite form', async ({ page }) => {
  await loginStaff(page, 'admin');
  await openMenu(page);
  await page.getByRole('menuitem', { name: /^Пользователь/ }).click();
  await expect(page).toHaveURL(/\/staff\/admin\/users$/);
  await expect(page.getByRole('dialog', { name: 'Новый сотрудник МИГ' })).toBeVisible();
});

test('HR: membership change → add an employee', async ({ page }) => {
  await loginStaff(page, 'hr');
  await openMenu(page);
  await page.getByRole('menuitem', { name: /^Изменение состава/ }).click();
  await expect(page).toHaveURL(/\/hr\/employees\/new$/);
  await expect(page.getByRole('heading', { name: 'Добавить сотрудника' })).toBeVisible();
});

test('narrow screen: the button collapses to an icon with an accessible name', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await loginStaff(page, 'asst_operator');
  const btn = createButton(page);
  await expect(btn).toBeVisible();
  await expect(btn).toHaveAttribute('aria-label', 'Создать');
  await expect(btn.locator('span')).toBeHidden();
  const box = await btn.boundingBox();
  expect(box!.width).toBeLessThan(48);
  await btn.click();
  await page.getByRole('menuitem', { name: /^Обращение/ }).click();
  await expect(page).toHaveURL(/\/assist\/insured$/);
});
