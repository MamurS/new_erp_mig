/*
 * One field of the help: «Найдите термин или задайте вопрос» (DECISIONS «Справка: одно поле»). Short queries
 * only search; a question is answered by itself after a pause in typing, the results stay; Enter with no row
 * chosen asks; ↑/↓ and Enter open a result; «Спросить в справке» of Ctrl+K opens the help with the answer;
 * with the AI scenario off there is no «Спросить» row and the search keeps working.
 */
import { expect, test, type Page } from '@playwright/test';
import { loginStaff } from './helpers';

const field = (page: Page) => page.getByRole('combobox', { name: 'Найдите термин или задайте вопрос' });
const list = (page: Page) => page.getByRole('listbox', { name: 'Результаты поиска по справке' });

test('«гп»: the term is found, no answer starts; the first row is «Спросить: «гп»»', async ({ page }) => {
  await loginStaff(page, 'operator');
  await page.goto('/staff/help');
  await expect(field(page)).toHaveAttribute('placeholder', 'Найдите термин или задайте вопрос');
  await field(page).fill('гп');
  await expect(list(page).getByRole('option').first()).toHaveText('Спросить: «гп»');
  await expect(list(page).getByRole('group', { name: 'Термины' }).getByRole('option').first()).toContainText(/гарантийное письмо/i);
  await expect(list(page).locator('mark').first()).toBeVisible();
  // Longer than the pause: still no answer.
  await page.waitForTimeout(1200);
  await expect(page.getByTestId('help-answer-card')).toHaveCount(0);
});

test('«как разнести платёж от другой компании?»: the answer above the results, both visible', async ({ page }) => {
  await loginStaff(page, 'accountant');
  await page.goto('/staff/help');
  await field(page).fill('как разнести платёж от другой компании?');
  const card = page.getByTestId('help-answer-card');
  await expect(card).toContainText('Вопрос: «как разнести платёж от другой компании?»');
  await expect(card.getByTestId('help-answer-steps').locator('li').first()).toBeVisible();
  await expect(card.getByTestId('help-answer-sources').locator('a[href^="/staff/help/finance"]').first()).toBeVisible();
  await expect(card.getByRole('button', { name: 'Полезно', exact: true })).toBeVisible();
  // The results are still there, under the answer.
  const results = list(page);
  await expect(results.getByRole('group', { name: 'Статьи' }).getByRole('option').first()).toBeVisible();
  const cardBox = (await card.boundingBox())!;
  const listBox = (await results.boundingBox())!;
  expect(listBox.y).toBeGreaterThan(cardBox.y);
});

test('Enter with no row chosen asks; ↑/↓ and Enter open an article; Esc closes the list', async ({ page }) => {
  await loginStaff(page, 'accountant');
  await page.goto('/staff/help');
  await field(page).fill('ручная разноска');
  await expect(list(page).getByRole('group', { name: 'Статьи' }).getByRole('option').first()).toBeVisible();
  await page.waitForTimeout(900);
  await expect(page.getByTestId('help-answer-card')).toHaveCount(0);
  await field(page).press('Enter');
  await expect(page.getByTestId('help-answer-card').getByTestId('help-answer').or(page.getByTestId('help-no-answer'))).toBeVisible();

  // ↓ chooses «Спросить», the next ↓ the first result; ↑ goes back; Esc closes, ↓ reopens.
  await field(page).press('ArrowDown');
  await expect(page.getByTestId('help-ask-row')).toHaveAttribute('aria-selected', 'true');
  await field(page).press('Escape');
  await expect(list(page)).toHaveCount(0);
  await field(page).press('ArrowDown');
  await expect(list(page)).toBeVisible();
  const firstArticle = list(page).getByRole('group', { name: 'Статьи' }).getByRole('option').first();
  const terms = await list(page).getByRole('group', { name: 'Термины' }).getByRole('option').count();
  for (let i = 0; i < terms + 1; i++) await field(page).press('ArrowDown');
  await expect(firstArticle).toHaveAttribute('aria-selected', 'true');
  await field(page).press('Enter');
  await expect(page).toHaveURL(/\/staff\/help\/[a-z0-9-]+(#[a-z0-9-]+)?$/);
  await expect(page.getByTestId('help-article')).toBeVisible();
});

test('Ctrl+K «Спросить в справке» opens the help with the answer ready; the question is not in the URL', async ({ page }) => {
  await loginStaff(page, 'accountant');
  await page.keyboard.press('Control+k');
  const palette = page.getByRole('dialog', { name: 'Командная палитра' });
  await palette.getByRole('combobox').fill('как разнести платёж от другой компании');
  const ask = palette.getByTestId('palette-help-ask');
  await expect(ask).toHaveText('Спросить в справке: «как разнести платёж от другой компании»');
  await ask.click();
  await expect(page).toHaveURL(/\/staff\/help$/);
  await expect(page.getByTestId('help-answer-card').getByTestId('help-answer-steps').locator('li').first()).toBeVisible();
  await expect(field(page)).toHaveValue('как разнести платёж от другой компании');
});

test('AI off: no «Спросить» row (field, palette), the search works', async ({ page }) => {
  await loginStaff(page, 'admin');
  await page.goto('/staff/admin/ai');
  await page.getByRole('button', { name: 'Отключить ИИ везде' }).click();
  const dialog = page.getByRole('dialog', { name: 'Отключить ИИ везде?' });
  await dialog.getByLabel('Причина').fill('Инцидент: проверяем ответы модели');
  await dialog.getByRole('button', { name: 'Отключить' }).click();
  await expect(page.getByText('ИИ отключён везде').first()).toBeVisible();

  await page.goto('/staff/help');
  await expect(page.getByText('Ответы на вопросы сейчас отключены администратором')).toBeVisible();
  await field(page).fill('как разнести платёж от другой компании?');
  await expect(list(page).getByRole('group', { name: 'Статьи' }).getByRole('option').first()).toBeVisible();
  await expect(page.getByTestId('help-ask-row')).toHaveCount(0);
  await field(page).press('Enter');
  await page.waitForTimeout(900);
  await expect(page.getByTestId('help-answer-card')).toHaveCount(0);

  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+k');
  const palette = page.getByRole('dialog', { name: 'Командная палитра' });
  await palette.getByRole('combobox').fill('гарантийное письмо');
  await expect(palette.getByText('Справка', { exact: true })).toBeVisible();
  await expect(palette.getByTestId('palette-help-ask')).toHaveCount(0);
});
