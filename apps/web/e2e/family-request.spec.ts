/*
 * The request to add a family member is easy to find (DECISIONS «Заявка на члена семьи на виду»): the employee
 * starts it from «+ Добавить» of the home switcher, sees it in «Мои заявки» with its status; HR approves it in
 * «Заявки из приложения»; the employee gets a notification in the bell and sees «Одобрено»; the spouse has no
 * button, only the hint. One tab: the mock database lives in the page.
 */
import { expect, test, type Page } from './test';
import { CODE, INSURED_PHONE, loginStaff, SPOUSE_PHONE } from './helpers';

/** Signs in to the app; the consent screen appears only on the person's first login. */
async function appLogin(page: Page, phone: string): Promise<void> {
  await page.evaluate(() => sessionStorage.removeItem('mig.session')).catch(() => undefined);
  await page.goto('/app/login');
  await page.getByLabel(/Номер телефона/).fill(phone.replace(/\D/g, '').replace(/^998/, ''));
  await page.getByRole('button', { name: 'Получить код' }).click();
  await page.getByLabel('Цифра 1').fill(CODE);
  await expect(page).toHaveURL(/\/app(\/consent(\?.*)?)?$/);
  if (page.url().includes('/app/consent')) {
    await page.getByRole('checkbox', { name: /согласен/ }).click();
    await page.getByRole('button', { name: 'Продолжить' }).click();
  }
  await expect(page).toHaveURL(/\/app$/);
}

const NAME = 'Karimova Zarina Azizovna';

test('the employee finds «+ Добавить» on the home screen, sends the request, HR approves, the bell and «Мои заявки» say so; the spouse has no button', async ({ page }) => {
  test.setTimeout(150_000);
  await appLogin(page, INSURED_PHONE);

  // Both ways in from the home screen: the switcher's last chip and the «Моя семья» tile.
  const switcher = page.getByTestId('profile-switcher');
  await expect(switcher.getByRole('radio').first()).toHaveText('Я');
  const add = switcher.getByTestId('profile-add');
  await expect(add).toHaveText('Добавить');
  await expect(page.getByRole('link', { name: 'Моя семья' })).toHaveAttribute('href', '/app/family');
  await add.click();
  await expect(page).toHaveURL(/\/app\/family\?add=1$/);

  const form = page.getByRole('form', { name: 'Добавить члена семьи' });
  await form.getByLabel('ФИО латиницей').fill(NAME);
  await form.getByLabel('Дата рождения').fill('01.03.2022');
  await form.getByLabel('ПИНФЛ').fill('61234567890123');
  await form.getByRole('button', { name: 'Ребёнок' }).click();
  await form.getByRole('checkbox', { name: /согласен на обработку/ }).click();
  await form.getByRole('button', { name: 'Отправить заявку' }).click();
  await expect(page.getByText('Заявка отправлена HR')).toBeVisible();

  const request = page.getByTestId('family-request').filter({ hasText: NAME });
  await expect(request.getByTestId('family-request-status')).toHaveText('На рассмотрении HR');
  // The members of the family with their status.
  await expect(page.getByTestId('family-member').first().getByTestId('family-member-status')).toHaveText('В полисе');

  // HR approves in «Заявки из приложения».
  await page.evaluate(() => sessionStorage.removeItem('mig.session'));
  await loginStaff(page, 'hr');
  await page.goto('/hr/family/requests');
  await page.getByRole('button', { name: `Одобрить: ${NAME}` }).click();
  await page.getByRole('alertdialog').or(page.getByRole('dialog')).getByRole('button', { name: 'Одобрить', exact: true }).click();
  await expect(page.getByText('Заявка одобрена и отправлена в МИГ')).toBeVisible();

  // The employee: the bell, then «Одобрено».
  await appLogin(page, INSURED_PHONE);
  await expect(page.getByTestId('notifications-count')).toHaveText('1');
  await page.getByTestId('notifications').click();
  const note = page.getByTestId('notification').first();
  await expect(note).toContainText(`HR одобрил заявку: ${NAME} будет добавлен(а) в полис`);
  await note.click();
  await expect(page).toHaveURL(/\/app\/family$/);
  await expect(page.getByTestId('family-request').filter({ hasText: NAME }).getByTestId('family-request-status')).toHaveText('Одобрено');

  // The spouse (an adult member): no «+ Добавить», only the hint in «Моя семья».
  await appLogin(page, SPOUSE_PHONE);
  await expect(page.getByTestId('profile-add')).toHaveCount(0);
  await page.getByRole('link', { name: 'Моя семья' }).click();
  await expect(page.getByTestId('family-add-hint')).toHaveText('Добавить членов семьи может сотрудник, через которого вы застрахованы.');
  await expect(page.getByRole('button', { name: 'Добавить члена семьи' })).toHaveCount(0);
});
