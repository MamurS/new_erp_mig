/* Family members in the insured app (FAMILY_SPEC): the switcher, hidden care of an adult, consent, «Моя семья». */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Outlet } from 'react-router-dom';
import { createMockServer, loginAs, renderRoutes } from '@/test/utils';
import { request } from '@/shared/api/client';
import * as S from '@/shared/api/schemas';
import { clearSession, setSession } from '@/shared/auth/session';
import { DEMO_CODE, DEMO_SPOUSE_PHONE } from '@/mocks/credentials';
import { PersonProvider } from './person';
import HomePage from './pages/HomePage';
import ClaimsPage from './pages/ClaimsPage';
import ProfilePage from './pages/ProfilePage';
import FamilyPage from './pages/FamilyPage';

const server = createMockServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterAll(() => server.close());
// The Radix checkbox measures itself with ResizeObserver, which jsdom does not have.
beforeEach(() =>
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  ),
);
afterEach(() => vi.unstubAllGlobals());

const routes = [
  {
    element: (
      <PersonProvider>
        <Outlet />
      </PersonProvider>
    ),
    children: [
      { path: '/app', element: <HomePage /> },
      { path: '/app/claims', element: <ClaimsPage /> },
      { path: '/app/profile', element: <ProfilePage /> },
      { path: '/app/family', element: <FamilyPage /> },
    ],
  },
];

async function loginSpouse(): Promise<void> {
  clearSession();
  const c = await request('/auth/phone', {
    method: 'POST',
    body: { phone: DEMO_SPOUSE_PHONE },
    schema: S.challenge,
  });
  const s = await request('/auth/phone/verify', {
    method: 'POST',
    body: { challengeId: c.challengeId, code: DEMO_CODE },
    schema: S.sessionResponse,
  });
  setSession({
    ...s,
    user: { ...s.user, consentGivenAt: s.user.consentGivenAt ?? new Date().toISOString() },
  });
}

describe('family in the insured app', () => {
  it('the switcher «Я / {name}» shows a child fully and an adult member without care data', async () => {
    const user = userEvent.setup();
    await loginAs('insured');
    renderRoutes(routes, '/app', { i18n: true });
    const group = await screen.findByRole('radiogroup', { name: 'Профиль' });
    expect(within(group).getByRole('radio', { name: 'Я' })).toHaveAttribute('aria-checked', 'true');

    await user.click(within(group).getByRole('radio', { name: 'Temur' }));
    expect(await screen.findByTestId('home-person')).toHaveTextContent('Karimov Temur Azizovich');
    expect(await screen.findByTestId('home-next-appointment')).toBeInTheDocument();
    expect(await screen.findByTestId('home-latest-claim')).toBeInTheDocument();
    expect(screen.getByTestId('home-certificate')).toHaveTextContent(/\S+/);

    // Arrow keys move the choice (radio group pattern).
    within(group).getByRole('radio', { name: 'Temur' }).focus();
    await user.keyboard('{ArrowRight}');
    const next = within(group).getByRole('radio', { checked: true });
    expect(next).toHaveFocus();

    await user.click(within(group).getByRole('radio', { name: 'Dilnoza' }));
    expect(await screen.findByTestId('medical-hidden')).toHaveTextContent(/Dilnoza пока не разрешил\(а\)/);
    expect(screen.queryByRole('link', { name: 'Записаться к врачу' })).toBeNull();
    expect(screen.getByRole('link', { name: /Карточка для клиники/ })).toBeInTheDocument();
  });

  it('«Моя семья» of the employee lists the members and sends a request to HR', async () => {
    const user = userEvent.setup();
    await loginAs('insured');
    renderRoutes(routes, '/app/family', { i18n: true });
    const members = await screen.findAllByTestId('family-member');
    expect(members.map((m) => m.textContent).join(' ')).toMatch(
      /Karimova Dilnoza Rustamovna.*Karimov Temur Azizovich|Karimov Temur Azizovich.*Karimova Dilnoza Rustamovna/,
    );

    await user.click(screen.getByRole('button', { name: 'Добавить' }));
    const form = await screen.findByRole('form', { name: 'Добавить члена семьи' });
    await user.click(within(form).getByRole('button', { name: 'Отправить заявку' }));
    expect(await within(form).findByText('Подтвердите согласие члена семьи')).toBeInTheDocument();
    expect(within(form).getByText('Выберите, кем приходится')).toBeInTheDocument();

    await user.type(within(form).getByLabelText('ФИО латиницей'), 'Karimova Zarina Azizovna');
    await user.type(within(form).getByLabelText('Дата рождения'), '01032022');
    await user.type(within(form).getByLabelText('ПИНФЛ'), '61234567890123');
    await user.click(within(form).getByRole('button', { name: 'Ребёнок' }));
    await user.click(within(form).getByRole('checkbox', { name: /согласен на обработку/ }));
    await user.click(within(form).getByRole('button', { name: 'Отправить заявку' }));
    const req = await screen.findByTestId('family-request');
    expect(req).toHaveTextContent('Karimova Zarina Azizovna');
    expect(within(req).getByTestId('family-request-status')).toHaveTextContent('На рассмотрении HR');
    expect(document.body.textContent ?? '').not.toContain('61234567890123');
  });

  it('an adult member sees the employee as the policyholder and toggles the consent with a confirmation', async () => {
    const user = userEvent.setup();
    await loginSpouse();
    renderRoutes(routes, '/app/profile', { i18n: true });
    const toggle = await screen.findByRole('switch', { name: 'Разрешить Aziz видеть мои обращения' });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    await user.click(toggle);
    const dialog = await screen.findByRole('dialog', { name: 'Разрешить Aziz видеть обращения?' });
    await user.click(within(dialog).getByRole('button', { name: 'Разрешить' }));
    expect(
      await screen.findByRole('switch', { name: 'Разрешить Aziz видеть мои обращения', checked: true }),
    ).toBeInTheDocument();
    // Back to «off» for the other tests sharing the mock DB.
    await user.click(screen.getByRole('switch', { name: 'Разрешить Aziz видеть мои обращения' }));
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Закрыть доступ' }),
    );
    expect(
      await screen.findByRole('switch', { name: 'Разрешить Aziz видеть мои обращения', checked: false }),
    ).toBeInTheDocument();
    expect(screen.getByTestId('payout-card')).toHaveTextContent(/Сейчас выплаты идут на карту Aziz/);
  });

  it('an adult member has no switcher; «Моя семья» names the employee only', async () => {
    await loginSpouse();
    renderRoutes(routes, '/app/family', { i18n: true });
    expect(await screen.findByTestId('family-principal')).toHaveTextContent('Karimov Aziz Bahromovich');
    expect(await screen.findByTestId('family-self')).toHaveTextContent('Karimova Dilnoza Rustamovna');
    expect(screen.queryByText(/Temur/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Добавить' })).toBeNull();
  });
});
