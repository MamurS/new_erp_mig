/* The side panel of every portal (staff, assistance, clinic, HR): hide, Ctrl+B, hover preview, resize, persistence, mobile. */
import { expect, test, type Page } from '@playwright/test';
import type { Role } from '../src/shared/types';
import { loginStaff } from './helpers';

interface PortalCase {
  portal: string;
  role: Exclude<Role, 'insured'>;
  home: RegExp;
  title: string;
  homeLink: RegExp;
  other: { link: RegExp; url: RegExp };
}

const PORTALS: PortalCase[] = [
  { portal: 'staff', role: 'underwriter', home: /\/staff$/, title: 'MIG', homeLink: /^Рабочий стол/, other: { link: /^Клиенты/, url: /\/staff\/clients$/ } },
  { portal: 'assist', role: 'asst_operator', home: /\/assist$/, title: 'MIG · Ассистанс', homeLink: /^Рабочий стол/, other: { link: /^Обращения/, url: /\/assist\/cases$/ } },
  { portal: 'clinic', role: 'clinic_admin', home: /\/clinic$/, title: 'MIG · Клиника', homeLink: /^Главная/, other: { link: /^Записи/, url: /\/clinic\/appointments$/ } },
  { portal: 'hr', role: 'hr', home: /\/hr$/, title: 'MIG · Компания', homeLink: /^Сотрудники/, other: { link: /^Статистика/, url: /\/hr\/stats$/ } },
];

const panel = (page: Page) => page.getByTestId('sidebar');
const toggle = (page: Page) => page.getByTestId('sidebar-toggle');

async function center(page: Page, testId: string): Promise<{ x: number; y: number }> {
  const box = (await page.getByTestId(testId).boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

for (const c of PORTALS) {
  test(`${c.portal}: hide completely, Ctrl+B, hover preview and pin, resize with mouse and keys, persistence, the active row`, async ({ page }) => {
    await loginStaff(page, c.role);
    await expect(panel(page)).toHaveAttribute('data-state', 'expanded');
    await expect(panel(page).getByTestId('sidebar-title')).toHaveText(c.title);
    expect(Math.round((await panel(page).boundingBox())!.width)).toBe(288);

    // The active row: warm grey background, no accent colour.
    const active = panel(page).getByRole('link', { name: c.homeLink });
    await expect(active).toHaveAttribute('aria-current', 'page');
    await expect(active).toHaveCSS('background-color', 'rgb(236, 234, 228)');
    await expect(panel(page).getByRole('link', { name: c.other.link })).not.toHaveAttribute('aria-current');

    // Hide: the panel disappears completely, the toggle stays at the top left of the content header.
    await panel(page).getByRole('button', { name: 'Скрыть панель' }).click();
    await expect(panel(page)).toHaveAttribute('data-state', 'collapsed');
    await expect(panel(page)).toBeHidden();
    await expect(page.locator('header').getByTestId('sidebar-toggle')).toBeVisible();
    const t = (await toggle(page).boundingBox())!;
    expect(t.x).toBeLessThan(40);
    await expect(page.getByRole('main')).toBeVisible();
    expect((await page.getByRole('main').boundingBox())!.x).toBeLessThan(40);

    // Ctrl+B shows and hides it. Not while typing, so focus a button first: a page's search field may take the focus.
    await page.mouse.move(900, 600);
    await expect(async () => {
      if ((await panel(page).getAttribute('data-state')) === 'collapsed') {
        await toggle(page).focus();
        await page.keyboard.press('Control+b');
      }
      await expect(panel(page)).toHaveAttribute('data-state', 'expanded', { timeout: 1000 });
    }).toPass();
    await expect(toggle(page)).toHaveCount(0);
    await panel(page).getByRole('button', { name: 'Скрыть панель' }).focus();
    await page.keyboard.press('Control+b');
    await expect(panel(page)).toHaveAttribute('data-state', 'collapsed');

    // Hovering the toggle previews the panel over the content; leaving it closes the preview.
    await toggle(page).hover();
    const preview = page.getByTestId('sidebar-preview');
    await expect(preview).toBeVisible();
    await expect(preview.getByRole('link', { name: c.other.link })).toBeVisible();
    await expect(panel(page)).toHaveAttribute('data-state', 'collapsed');
    await page.mouse.move(1000, 600);
    await expect(preview).toBeHidden();
    // Hover again and click the same spot: the preview's pin button sits right over the toggle.
    const spot = await center(page, 'sidebar-toggle');
    await page.mouse.move(spot.x, spot.y);
    await expect(preview).toBeVisible();
    // Once the 150 ms slide-in is over, the pin button is centred on the content's toggle.
    const pin = preview.getByRole('button', { name: 'Закрепить панель' });
    await expect
      .poll(async () => {
        const b = await pin.boundingBox();
        return !!b && Math.abs(b.x + b.width / 2 - spot.x) < 3 && Math.abs(b.y + b.height / 2 - spot.y) < 3;
      })
      .toBe(true);
    await page.mouse.click(spot.x, spot.y);
    await expect(panel(page)).toHaveAttribute('data-state', 'expanded');
    await expect(preview).toBeHidden();
    // The width animates for 150 ms: measure the handle once it has settled.
    await expect.poll(async () => Math.round((await panel(page).boundingBox())!.width)).toBe(288);

    // Resize with the mouse, then with the arrow keys; double click returns 288.
    const sep = panel(page).getByRole('separator', { name: 'Ширина панели' });
    await expect(sep).toHaveAttribute('aria-valuemin', '224');
    await expect(sep).toHaveAttribute('aria-valuemax', '400');
    const s = (await sep.boundingBox())!;
    await page.mouse.move(s.x + s.width / 2, s.y + 200);
    await page.mouse.down();
    await page.mouse.move(s.x + s.width / 2 + 60, s.y + 200, { steps: 5 });
    await page.mouse.up();
    await expect(sep).toHaveAttribute('aria-valuenow', '348');
    await sep.focus();
    await page.keyboard.press('ArrowLeft');
    await expect(sep).toHaveAttribute('aria-valuenow', '332');
    await page.mouse.move(s.x + s.width / 2 + 500, s.y + 200);
    await page.mouse.down();
    await page.mouse.move(s.x + s.width / 2 + 600, s.y + 200, { steps: 3 });
    await page.mouse.up();
    await expect(sep).toHaveAttribute('aria-valuenow', '332'); // a drag elsewhere does nothing
    await page.reload();
    await expect(panel(page).getByRole('separator', { name: 'Ширина панели' })).toHaveAttribute('aria-valuenow', '332');
    expect(Math.round((await panel(page).boundingBox())!.width)).toBe(332);
    await panel(page).getByRole('separator', { name: 'Ширина панели' }).dblclick();
    await expect(panel(page).getByRole('separator', { name: 'Ширина панели' })).toHaveAttribute('aria-valuenow', '288');

    // The hidden state survives a reload too.
    await panel(page).getByRole('button', { name: 'Скрыть панель' }).focus();
    await page.keyboard.press('Control+b');
    await expect(panel(page)).toHaveAttribute('data-state', 'collapsed');
    await page.reload();
    await expect(panel(page)).toHaveAttribute('data-state', 'collapsed');
    await expect(toggle(page)).toBeVisible();
  });

  test(`${c.portal}: narrow screen — hidden by default, opens over the content with a backdrop; Esc, outside click and navigation close it; focus stays inside`, async ({ page }) => {
    await page.setViewportSize({ width: 820, height: 820 });
    await loginStaff(page, c.role);
    await expect(panel(page)).toBeHidden();
    await toggle(page).click();
    const drawer = page.getByTestId('sidebar-mobile');
    await expect(drawer).toBeVisible();
    await expect(drawer.getByTestId('sidebar-title')).toHaveText(c.title);
    for (let i = 0; i < 20; i++) await page.keyboard.press('Tab');
    expect(await page.evaluate(() => !!document.activeElement?.closest('[data-testid="sidebar-mobile"]'))).toBe(true);
    await page.keyboard.press('Escape');
    await expect(drawer).toBeHidden();

    await toggle(page).click();
    await expect(drawer).toBeVisible();
    // Radix starts listening for outside clicks a tick after opening: retry like an impatient person would.
    await expect(async () => {
      await page.mouse.click(800, 400);
      await expect(drawer).toBeHidden({ timeout: 500 });
    }).toPass();

    await toggle(page).click();
    await drawer.getByRole('link', { name: c.other.link }).click();
    await expect(page).toHaveURL(c.other.url);
    await expect(drawer).toBeHidden();
  });
}
