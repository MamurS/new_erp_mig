import { test } from '@playwright/test';
import { loginStaff } from '../helpers';
test('dbg', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 640 });
  await loginStaff(page, 'underwriter');
  await page.goto('/staff/clients');
  const rows = page.locator('[data-content-scroll] tbody tr[data-row]');
  await rows.nth(5).waitFor();
  await rows.nth(1).click();
  await page.getByTestId('detail-panel').waitFor();
  await page.evaluate(() => { const a = document.querySelector('[data-content-scroll]')!; a.addEventListener('scroll', () => console.log('scroll', a.scrollTop, new Error().stack?.split('\n').length)); });
  page.on('console', (m) => console.log('PAGE', m.text()));
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(400);
    console.log(i, await page.evaluate(() => { const r = document.querySelector('tbody tr[aria-selected="true"]') as HTMLElement; const f = document.activeElement as HTMLElement; return JSON.stringify({ st: document.querySelector('[data-content-scroll]')!.scrollTop, selB: r?.getBoundingClientRect().bottom, focB: f.getBoundingClientRect().bottom, same: r === f }); }));
  }
});
