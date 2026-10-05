/*
 * Interface languages: ru (default), uz-Latn, en. Every language is chosen on a sign-in screen, in the
 * side panel's user menu or in the insured app's profile; headings of key screens follow it, <html lang>
 * is set, and the choice survives a reload. Expected texts are read from the dictionaries themselves.
 */
import { expect, test, type Page } from '@playwright/test';
import { ru } from '../src/i18n/dict/ru';
import { uzLatn } from '../src/i18n/dict/uz-Latn';
import { en } from '../src/i18n/dict/en';
import { CODE, EMAIL, PASSWORD } from './helpers';

type Lang = 'ru' | 'uz-Latn' | 'en';
type Key = keyof typeof ru;
const DICT: Record<Lang, Record<string, string | undefined>> = { ru, 'uz-Latn': uzLatn, en };
const NAME: Record<Lang, string> = { ru: 'Русский', 'uz-Latn': 'Oʻzbekcha', en: 'English' };
const LANGS: Lang[] = ['ru', 'uz-Latn', 'en'];

function tr(lang: Lang, key: Key, params: Record<string, string | number> = {}): string {
  const s = DICT[lang][key] ?? ru[key];
  return s.replace(/\{(\w+)\}/g, (m, p: string) => (p in params ? String(params[p]) : m));
}
const exact = (s: string) => new RegExp(`^${s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);

async function staffLogin(page: Page, lang: Lang, email: string): Promise<void> {
  await page.getByLabel(tr(lang, 'common.email')).fill(email);
  await page.getByLabel(tr(lang, 'auth.login.password')).fill(PASSWORD);
  await page.getByRole('button', { name: tr(lang, 'auth.login.submit'), exact: true }).click();
  await expect(page).toHaveURL(/\/login\/otp/);
  await expect(page.getByRole('heading', { name: tr(lang, 'auth.otp.title') })).toBeVisible();
  await page.getByLabel(tr(lang, 'shell.otp.digit', { n: 1 }), { exact: true }).fill(CODE);
}

for (const lang of LANGS) {
  test(`staff portal in ${lang}: chosen on the sign-in screen, headings follow, <html lang>, kept after reload`, async ({ page }) => {
    await page.goto('/login');
    await expect(page.locator('html')).toHaveAttribute('lang', 'ru');
    await page.getByTestId('lang-switch').getByRole('button', { name: NAME[lang] }).click();
    await expect(page.locator('html')).toHaveAttribute('lang', lang);
    await expect(page.getByRole('heading', { name: tr(lang, 'auth.login.title'), exact: true })).toBeVisible();
    await staffLogin(page, lang, EMAIL.underwriter);
    await expect(page).toHaveURL(/\/staff$/);

    const panel = page.getByTestId('sidebar');
    await expect(panel.getByRole('link', { name: exact(tr(lang, 'staff.nav.dashboard')) })).toHaveAttribute('aria-current', 'page');
    await expect(panel.getByRole('link', { name: exact(tr(lang, 'staff.nav.clients')) })).toBeVisible();
    await expect(page.getByText(tr(lang, 'staff.dashboard.queue'), { exact: true })).toBeVisible();
    await panel.getByRole('link', { name: exact(tr(lang, 'staff.nav.clients')) }).click();
    await expect(page).toHaveURL(/\/staff\/clients$/);
    await expect(page.getByRole('heading', { level: 1, name: tr(lang, 'staff.nav.clients') })).toBeVisible();

    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('lang', lang);
    await expect(page.getByRole('heading', { level: 1, name: tr(lang, 'staff.nav.clients') })).toBeVisible();
  });
}

test('the side panel user menu switches the language of every portal, and the choice is kept', async ({ page }) => {
  await page.goto('/login');
  await staffLogin(page, 'ru', EMAIL.hr);
  await expect(page).toHaveURL(/\/hr$/);
  const panel = page.getByTestId('sidebar');
  await expect(panel.getByTestId('sidebar-title')).toHaveText(tr('ru', 'shell.title.hr'));

  for (const lang of ['en', 'uz-Latn', 'ru'] as const) {
    const from = (await page.locator('html').getAttribute('lang')) as Lang;
    await panel.getByRole('button', { name: tr(from, 'shell.user.menu') }).click();
    await page.getByRole('menuitemradio', { name: NAME[lang] }).click();
    await expect(page.locator('html')).toHaveAttribute('lang', lang);
    await expect(panel.getByTestId('sidebar-title')).toHaveText(tr(lang, 'shell.title.hr'));
    await expect(panel.getByRole('link', { name: exact(tr(lang, 'hr.nav.employees')) })).toBeVisible();
    await panel.getByRole('link', { name: exact(tr(lang, 'hr.nav.stats')) }).click();
    await expect(page).toHaveURL(/\/hr\/stats$/);
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('lang', lang);
    await expect(panel.getByTestId('sidebar-title')).toHaveText(tr(lang, 'shell.title.hr'));
    await panel.getByRole('link', { name: exact(tr(lang, 'hr.nav.employees')) }).click();
  }
});

test('clinic and assistance portals follow the chosen language too', async ({ page }) => {
  await page.goto('/login');
  await page.getByTestId('lang-switch').getByRole('button', { name: NAME['uz-Latn'] }).click();
  await staffLogin(page, 'uz-Latn', EMAIL.clinic_admin);
  await expect(page).toHaveURL(/\/clinic$/);
  const panel = page.getByTestId('sidebar');
  await expect(panel.getByTestId('sidebar-title')).toHaveText(tr('uz-Latn', 'shell.title.clinic'));
  await expect(panel.getByRole('link', { name: exact(tr('uz-Latn', 'clinic.nav.home')) })).toHaveAttribute('aria-current', 'page');

  await panel.getByRole('button', { name: tr('uz-Latn', 'shell.user.menu') }).click();
  await page.getByRole('menuitem', { name: tr('uz-Latn', 'shell.user.logout') }).click();
  await expect(page).toHaveURL(/\/login(\?|$)/);
  await expect(page.getByRole('heading', { name: tr('uz-Latn', 'auth.login.title'), exact: true })).toBeVisible();
  await page.getByTestId('lang-switch').getByRole('button', { name: NAME.en }).click();
  await staffLogin(page, 'en', EMAIL.asst_operator);
  await expect(page).toHaveURL(/\/assist$/);
  await expect(page.getByTestId('sidebar').getByTestId('sidebar-title')).toHaveText(tr('en', 'shell.title.assist'));
  await expect(page).toHaveTitle(new RegExp(tr('en', 'assist.dashboard.docTitle')));
});

for (const lang of LANGS) {
  test(`insured app in ${lang}: sign-in, consent and home in the language; the profile switch; kept after reload`, async ({ page }) => {
    await page.goto('/app/login');
    await page.getByTestId('lang-switch').getByRole('button', { name: NAME[lang] }).click();
    await expect(page.locator('html')).toHaveAttribute('lang', lang);
    await expect(page.getByRole('heading', { name: tr(lang, 'app.login.title') })).toBeVisible();
    await page.getByLabel(tr(lang, 'app.login.phone')).fill('900000001');
    await page.getByRole('button', { name: tr(lang, 'app.login.getCode') }).click();
    await expect(page).toHaveURL(/\/app\/login\/code/);
    await page.getByLabel(tr(lang, 'app.login.code.digit', { n: 1 }), { exact: true }).fill(CODE);
    await expect(page).toHaveURL(/\/app\/consent/);
    await expect(page.getByRole('heading', { name: tr(lang, 'app.consent.title') })).toBeVisible();
    await page.getByRole('checkbox', { name: tr(lang, 'app.consent.checkbox') }).click();
    await page.getByRole('button', { name: tr(lang, 'app.consent.continue') }).click();
    await expect(page).toHaveURL(/\/app$/);
    await expect(page.getByText(tr(lang, 'app.home.subtitle'))).toBeVisible();

    // The profile has the switch too: pick the next language there.
    const next = LANGS[(LANGS.indexOf(lang) + 1) % LANGS.length]!;
    await page.getByRole('link', { name: tr(lang, 'app.nav.profile') }).click();
    await expect(page).toHaveURL(/\/app\/profile$/);
    await page.getByTestId('lang-switch').getByRole('button', { name: NAME[next] }).click();
    await expect(page.locator('html')).toHaveAttribute('lang', next);
    await expect(page.getByRole('link', { name: tr(next, 'app.nav.home') })).toBeVisible();
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('lang', next);
    await page.getByRole('link', { name: tr(next, 'app.nav.home') }).click();
    await expect(page.getByText(tr(next, 'app.home.subtitle'))).toBeVisible();
  });
}
