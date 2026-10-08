/*
 * «Справка» (HELP_SPEC): context help «?», the search («гп» → «Гарантийное письмо») in the help and in
 * Ctrl+K, «Задать вопрос» with steps and a source link, «Открыть раздел» only with access, the print
 * view of «Скачать PDF» with a title page and a table of contents, the admin tab of questions — and the
 * fraud subsection never reaching HR, clinics or the insured person (TOC, search, answers, PDF).
 */
import { expect, test, type Page } from './test';
import { login, loginStaff, logoutFromSidebar } from './helpers';

/** window.print() would open the browser dialog: count the calls instead. */
async function stubPrint(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __printed: number; print: () => void };
    w.__printed = 0;
    w.print = () => {
      w.__printed += 1;
    };
  });
}

const FRAUD = /мошеннич/i;

test('«?» on the clients list opens the article about clients; the sidebar has «Справка» at the bottom', async ({ page }) => {
  await loginStaff(page, 'operator');
  await page.goto('/staff/clients');
  await page.getByRole('link', { name: 'Справка по этому экрану' }).click();
  await expect(page).toHaveURL(/\/staff\/help\/new-client$/);
  const article = page.getByTestId('help-article');
  await expect(article.getByRole('heading', { level: 2, name: /^5\. Новый клиент/ })).toBeVisible();
  await expect(page.getByTestId('topbar').getByRole('navigation', { name: 'Хлебные крошки' })).toContainText('Справка');
  // «Справка» is pinned to the bottom of the side panel and is the active item here.
  const footer = page.getByTestId('sidebar').getByTestId('sidebar-footer');
  await expect(footer.getByRole('link', { name: 'Справка' })).toHaveAttribute('aria-current', 'page');
  // A subsection of the table of contents; «Следующая» goes on.
  await page.getByTestId('help-toc').getByRole('link', { name: /Коммерческое предложение/ }).click();
  await expect(page).toHaveURL(/\/staff\/help\/new-client#kp$/);
  await article.getByRole('navigation', { name: 'Соседние статьи' }).getByRole('link', { name: /Следующая/ }).click();
  await expect(page).toHaveURL(/\/staff\/help\/signing$/);
  await expect(article.getByRole('heading', { level: 2, name: /^6\. / })).toBeVisible();
});

test('search «гп» finds «Гарантийное письмо» (terms and articles); arrows and Enter open it; Ctrl+K has a «Справка» group', async ({ page }) => {
  await loginStaff(page, 'operator');
  await page.goto('/staff/help');
  const box = page.getByRole('combobox', { name: 'Найдите термин или задайте вопрос' });
  await box.fill('гп');
  const list = page.getByRole('listbox', { name: 'Результаты поиска по справке' });
  await expect(list.getByRole('group', { name: 'Термины' }).getByRole('option').first()).toContainText(/гарантийное письмо/i);
  const articles = list.getByRole('group', { name: 'Статьи' });
  await expect(articles.getByRole('option', { name: /^Гарантийное письмо/ }).first()).toBeVisible();
  await expect(list.locator('mark').first()).toBeVisible();
  // ↓ moves to the first article (after «Спросить» and the terms); Enter opens it.
  const terms = await list.getByRole('group', { name: 'Термины' }).getByRole('option').count();
  for (let i = 0; i < terms + 2; i++) await box.press('ArrowDown');
  await expect(articles.getByRole('option').first()).toHaveAttribute('aria-selected', 'true');
  await box.press('Enter');
  // «Гарантийное письмо» is both a row of the status reference and a subsection of «Медицинское обслуживание».
  await expect(page).toHaveURL(/\/staff\/help\/(statuses|medical#guarantee-letter)$/);
  await expect(page.getByTestId('help-article')).toContainText('Гарантийное письмо');

  // The command palette shows the help results as a separate group.
  await page.keyboard.press('Control+k');
  const palette = page.getByRole('dialog', { name: 'Командная палитра' });
  await palette.getByRole('combobox').fill('гарантийное письмо');
  await expect(palette.getByText('Справка', { exact: true })).toBeVisible();
  await palette.getByRole('option', { name: /^Гарантийное письмо/ }).first().click();
  await expect(page).toHaveURL(/\/staff\/help\/(statuses|medical#guarantee-letter)$/);
});

test('«как разнести платёж от другой компании» — steps from section 12 with a source link; «Полезно»', async ({ page }) => {
  await loginStaff(page, 'accountant');
  await page.getByTestId('sidebar').getByRole('link', { name: 'Справка' }).click();
  await expect(page).toHaveURL(/\/staff\/help$/);
  // A question is answered by itself after a pause in typing.
  await page.getByRole('combobox', { name: 'Найдите термин или задайте вопрос' }).fill('как разнести платёж от другой компании');
  const answer = page.getByTestId('help-answer');
  await expect(answer.getByTestId('help-answer-steps').locator('li').first()).toBeVisible();
  const source = answer.getByTestId('help-answer-sources').locator('a[href^="/staff/help/finance"]').first();
  await expect(source).toBeVisible();
  // The accountant may open «Ручная разноска»: the answer offers it.
  await expect(answer.getByRole('link', { name: 'Открыть раздел «Ручная разноска»' })).toHaveAttribute('href', '/staff/invoices/queue');
  await answer.getByRole('button', { name: 'Полезно', exact: true }).click();
  await expect(answer.getByText('Спасибо, оценка учтена')).toBeVisible();
  await source.click();
  await expect(page).toHaveURL(/\/staff\/help\/finance#[a-z0-9-]+$/);
  await expect(page.getByTestId('help-article').getByRole('heading', { level: 2, name: /^12\. / })).toBeVisible();
});

test('«Открыть раздел» only with access to the screen', async ({ page }) => {
  await loginStaff(page, 'accountant');
  await page.goto('/staff/help/finance#manual-allocation');
  const section = page.locator('#manual-allocation');
  await expect(section.getByRole('link', { name: 'Открыть раздел «Ручная разноска»' })).toBeVisible();
  await section.getByRole('link', { name: 'Открыть раздел «Ручная разноска»' }).click();
  await expect(page).toHaveURL(/\/staff\/invoices\/queue$/);

  // The operator reads the same article but has no access to «Ручная разноска».
  await logoutFromSidebar(page);
  await loginStaff(page, 'operator');
  await page.goto('/staff/help/finance#manual-allocation');
  await expect(page.locator('#manual-allocation')).toBeVisible();
  await expect(page.getByTestId('help-article').getByRole('link', { name: /Открыть раздел «Ручная разноска»/ })).toHaveCount(0);
  await expect(page.locator('a[href="/staff/invoices/queue"]')).toHaveCount(0);
});

test('a question without an answer → «Написать куратору»; the admin sees it in /staff/admin/ai → «Справка»', async ({ page }) => {
  await loginStaff(page, 'admin');
  await page.goto('/staff/help');
  await page.getByRole('combobox', { name: 'Найдите термин или задайте вопрос' }).fill('как приготовить плов на костре');
  await page.getByRole('combobox', { name: 'Найдите термин или задайте вопрос' }).press('Enter');
  const none = page.getByTestId('help-no-answer');
  await expect(none.getByText('В справке нет ответа на этот вопрос')).toBeVisible();
  await expect(none.getByRole('link', { name: 'Написать куратору' })).toHaveAttribute('href', /^mailto:/);
  await page.getByTestId('sidebar').getByRole('link', { name: 'ИИ' }).click();
  await page.getByRole('tab', { name: 'Справка' }).click();
  await expect(page).toHaveURL(/\/staff\/admin\/ai\?tab=help$/);
  const table = page.getByRole('table', { name: 'Вопросы без ответа' });
  await expect(table.getByRole('cell', { name: 'как приготовить плов на костре' })).toBeVisible();
});

test('«Скачать PDF → Вся справка»: the print view with a title page and a table of contents; only the view is printed', async ({ page }) => {
  await stubPrint(page);
  await loginStaff(page, 'claims_officer');
  await page.goto('/staff/help/claims');
  // MIG staff do read the fraud subsection (the control for the external roles below).
  await expect(page.locator('#claims-fraud')).toContainText(FRAUD);
  await page.getByRole('button', { name: 'Скачать PDF' }).click();
  await page.getByRole('menuitem', { name: 'Вся справка' }).click();
  const view = page.getByRole('dialog', { name: 'Руководство пользователя системы ДМС MIG' });
  await expect(view).toBeVisible();
  await expect(view.getByTestId('help-print-meta')).toContainText('Роль: Специалист по убыткам');
  await expect(view.getByTestId('help-print-meta')).toContainText(/Версия 1\.0/);
  const toc = view.getByTestId('help-print-toc');
  await expect(toc.getByRole('link', { name: '11. Урегулирование убытков' })).toHaveAttribute('href', '#hp-claims');
  await expect(view.locator('#hp-claims-fraud')).toBeAttached();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __printed: number }).__printed)).toBe(1);
  // A link of the table of contents leads to its article inside the view.
  await toc.getByRole('link', { name: '12. Финансы: счета, оплаты, выписка 1С' }).click();
  await expect(view.locator('#hp-finance')).toBeInViewport();
  // In print, only the view: the app, its menus and the toolbar are not printed; table rows do not split.
  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('#root')).toBeHidden();
  await expect(view.getByRole('button', { name: 'Печать или PDF' })).toBeHidden();
  expect(await view.locator('tr').first().evaluate((el) => getComputedStyle(el).breakInside)).toBe('avoid');
  await page.emulateMedia({ media: 'screen' });
  await view.getByRole('button', { name: 'Закрыть' }).click();
  await expect(view).toBeHidden();

  // «Текущая статья»: only this article.
  await page.getByRole('button', { name: 'Скачать PDF' }).click();
  await page.getByRole('menuitem', { name: 'Текущая статья' }).click();
  const one = page.getByTestId('help-print');
  await expect(one.getByTestId('help-print-toc').getByRole('link', { name: '11. Урегулирование убытков' })).toBeVisible();
  await expect(one.getByTestId('help-print-toc').getByRole('link', { name: /^12\. / })).toHaveCount(0);
});

for (const role of ['hr', 'clinic_admin', 'insured'] as const) {
  test(`${role}: the fraud subsection is nowhere — table of contents, search, answers, PDF`, async ({ page }) => {
    await stubPrint(page);
    await login(page, role);
    const base = role === 'hr' ? '/hr' : role === 'insured' ? '/app' : '/clinic';
    if (role === 'insured') {
      // The app: «Помощь» in the profile.
      await page.goto('/app/profile');
      await page.getByRole('link', { name: 'Помощь' }).click();
    } else {
      await page.getByTestId('sidebar').getByTestId('sidebar-footer').getByRole('link', { name: 'Справка' }).click();
    }
    await expect(page).toHaveURL(new RegExp(`${base}/help$`));
    await expect(page.getByTestId('help-article')).toBeVisible();

    // Table of contents (the app shows it behind a button).
    if (role === 'insured') await page.getByRole('button', { name: 'Содержание справки' }).click();
    const toc = page.getByTestId('help-toc');
    await expect(toc.getByRole('link').first()).toBeVisible();
    await expect(toc).not.toContainText(FRAUD);
    await expect(toc).not.toContainText('Урегулирование убытков');

    // The subsection does not exist for the role.
    await page.goto(`${base}/help/claims-fraud`);
    await expect(page.getByText('Статья не найдена или недоступна для вашей роли.')).toBeVisible();

    // Search.
    const box = page.getByRole('combobox', { name: 'Найдите термин или задайте вопрос' });
    await box.fill('признаки мошенничества');
    const list = page.getByRole('listbox', { name: 'Результаты поиска по справке' });
    await expect(list).toBeVisible();
    await expect(list.getByText('В справке ничего не найдено').or(list.getByRole('group').getByRole('option').first()).first()).toBeVisible();
    // Only the results: the «Спросить: «…»» row repeats what was typed.
    expect((await list.locator('[role="group"]').allInnerTexts()).join(' ')).not.toMatch(FRAUD);
    await box.press('Escape');

    // «Задать вопрос».
    await box.fill('какие признаки мошенничества по убыткам');
    await box.press('Enter');
    const reply = page.getByTestId('help-answer').or(page.getByTestId('help-no-answer'));
    await expect(reply).toBeVisible();
    await expect(reply).not.toContainText(FRAUD);
    await expect(page.locator('a[href*="claims-fraud"]')).toHaveCount(0);

    // PDF «Вся справка».
    await page.getByRole('button', { name: 'Скачать PDF' }).click();
    await page.getByRole('menuitem', { name: 'Вся справка' }).click();
    const view = page.getByTestId('help-print');
    await expect(view.getByTestId('help-print-toc').getByRole('link').first()).toBeVisible();
    await expect(view).not.toContainText(FRAUD);
    await expect(view.locator('#hp-claims-fraud')).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => (window as unknown as { __printed: number }).__printed)).toBe(1);
  });
}

test('the insured person without the answer gets «Написать нам» to the app chat', async ({ page }) => {
  await login(page, 'insured');
  await page.goto('/app/help');
  await page.getByRole('combobox', { name: 'Найдите термин или задайте вопрос' }).fill('как приготовить плов на костре');
  await page.getByRole('combobox', { name: 'Найдите термин или задайте вопрос' }).press('Enter');
  await page.getByTestId('help-no-answer').getByRole('link', { name: 'Написать нам' }).click();
  await expect(page).toHaveURL(/\/app\/chat$/);
});
