/*
 * Stubs audit (docs/STUBS_AUDIT.md): every item of the sidebar and of «+ Создать», for every role, opens a
 * real screen — not «Страница не найдена», not «Что-то пошло не так», no uncaught error in the page. The app of
 * the insured person: every tab of the bottom bar and every tile of the home screen.
 */
import { expect, test, type Page } from './test';
import type { Role } from '@mig/contracts';
import { EMAIL, HOME, loginInsured, loginStaff } from './helpers';

const PORTAL_ROLES = Object.keys(EMAIL) as Exclude<Role, 'insured'>[];

/** Collects uncaught errors of the page (a crash that the error screen might not show). */
function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}

async function expectRealScreen(page: Page, what: string): Promise<void> {
  await expect(page.locator('main').first(), what).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Страница не найдена' }), `${what}: 404`).toHaveCount(0);
  await expect(page.getByText('Что-то пошло не так'), `${what}: crash`).toHaveCount(0);
}

/** Internal links of a container, without duplicates. */
async function hrefsOf(page: Page, selector: string): Promise<string[]> {
  const all = await page.locator(selector).locator('a[href^="/"]').evaluateAll((as) => as.map((a) => a.getAttribute('href') ?? ''));
  return [...new Set(all.filter(Boolean))];
}

for (const role of PORTAL_ROLES) {
  test(`${role}: every sidebar item and every «+ Создать» item opens a real screen`, async ({ page }) => {
    test.setTimeout(240_000);
    const errors = watchErrors(page);
    await loginStaff(page, role);
    await expect(page.getByTestId('sidebar').locator('a[href^="/"]').first()).toBeVisible();
    const links = await hrefsOf(page, '[data-testid="sidebar"]');
    expect(links.length, 'sidebar items').toBeGreaterThan(0);
    for (const href of links) {
      await page.goto(href);
      await expect(page).toHaveURL(new RegExp(`${href.split('?')[0]!.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
      await expectRealScreen(page, `${role} → ${href}`);
    }

    // «+ Создать»: each item opens its form (a screen or a dialog) — never a 404 or a crash.
    await page.goto(HOME[role]);
    const create = page.getByTestId('create-menu');
    if (await create.count()) {
      await create.click();
      const count = await page.getByRole('menuitem').count();
      await page.keyboard.press('Escape');
      for (let i = 0; i < count; i++) {
        await page.goto(HOME[role]);
        await page.getByTestId('create-menu').click();
        const item = page.getByRole('menuitem').nth(i);
        const label = (await item.innerText()).trim();
        await item.click();
        await expectRealScreen(page, `${role} → «+ Создать» → ${label}`);
        await page.keyboard.press('Escape');
      }
    }
    expect(errors, `${role}: uncaught errors`).toEqual([]);
  });
}

test('insured: every tab of the bottom bar and every tile of the home screen opens a real screen', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = watchErrors(page);
  await loginInsured(page);
  await expect(page.locator('main a[href^="/"]').first()).toBeVisible();
  const links = [...(await hrefsOf(page, 'nav[aria-label]')), ...(await hrefsOf(page, 'main'))];
  expect(links.length).toBeGreaterThan(4);
  for (const href of [...new Set(links)]) {
    await page.goto(href);
    await expectRealScreen(page, `insured → ${href}`);
  }
  expect(errors).toEqual([]);
});
