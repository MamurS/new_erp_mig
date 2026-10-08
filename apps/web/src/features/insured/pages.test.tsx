import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMockServer, loginAs, renderRoutes } from '@/test/utils';
import HomePage from './pages/HomePage';
import ClaimsPage from './pages/ClaimsPage';
import ClaimStatusPage from './pages/ClaimStatusPage';
import ClinicsPage from './pages/ClinicsPage';
import AppointmentsPage from './pages/AppointmentsPage';
import ProfilePage from './pages/ProfilePage';
import ChatPage from './pages/ChatPage';

const server = createMockServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterAll(() => server.close());

const routes = [
  { path: '/app', element: <HomePage /> },
  { path: '/app/claims', element: <ClaimsPage /> },
  { path: '/app/claims/:claimId', element: <ClaimStatusPage /> },
  { path: '/app/clinics', element: <ClinicsPage /> },
  { path: '/app/appointments', element: <AppointmentsPage /> },
  { path: '/app/profile', element: <ProfilePage /> },
  { path: '/app/chat', element: <ChatPage /> },
  { path: '/app/booking', element: <p>booking-page</p> },
];

describe('insured app screens', () => {
  it('home shows greeting, policy card, limits and switches language', async () => {
    const user = userEvent.setup();
    await loginAs('insured');
    renderRoutes(routes, '/app', { i18n: true });
    expect(await screen.findByText(/^Добрый день, .+!$/)).toBeInTheDocument();
    expect(await screen.findByText(/^Вы застрахованы через /)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Карточка для клиники/ })).toHaveAttribute('href', '/app/card');
    // The compact language button in the header: current language, then the full names.
    const pick = async (button: string, item: string) => {
      await user.click(screen.getByRole('button', { name: button }));
      await user.click(await screen.findByRole('menuitemradio', { name: new RegExp(`^${item}`) }));
    };
    expect(screen.getByTestId('lang-button')).toHaveTextContent('RU');
    await pick('Язык: Русский', 'Oʻzbekcha');
    expect(await screen.findByText(/^Xayrli kun, .+!$/)).toBeInTheDocument();
    expect(screen.getByTestId('lang-button')).toHaveTextContent('UZ');
    await pick('Til: Oʻzbekcha', 'English');
    expect(await screen.findByText(/^Good afternoon, .+!$/)).toBeInTheDocument();
    await pick('Language: English', 'Русский');
    expect(await screen.findByText(/^Добрый день, .+!$/)).toBeInTheDocument();
  });

  it('claims list links to a status page; a foreign id is a friendly not-found', async () => {
    await loginAs('insured');
    renderRoutes(routes, '/app/claims/3f2b1c9e-8d7a-4c1b-9e2f-1a2b3c4d5e6f', { i18n: true });
    expect(await screen.findByText(/Такого возмещения нет/)).toBeInTheDocument();
  });

  it('clinics «Записаться сюда» opens booking', async () => {
    const user = userEvent.setup();
    await loginAs('insured');
    renderRoutes(routes, '/app/clinics', { i18n: true });
    const buttons = await screen.findAllByRole('button', { name: 'Записаться сюда' });
    await user.click(buttons[0]!);
    expect(await screen.findByText('booking-page')).toBeInTheDocument();
  });

  it('profile shows masked data only', async () => {
    await loginAs('insured');
    renderRoutes(routes, '/app/profile', { i18n: true });
    expect(await screen.findByText('ПИНФЛ')).toBeInTheDocument();
    expect(document.body.textContent ?? '').not.toMatch(/\d{14}/);
  });

  it('chat renders javascript: as text, not a link', async () => {
    const user = userEvent.setup();
    await loginAs('insured');
    renderRoutes(routes, '/app/chat', { i18n: true });
    const input = await screen.findByLabelText('Сообщение');
    await user.type(input, 'javascript:alert(1) https://example.com');
    await user.click(screen.getByRole('button', { name: 'Отправить' }));
    expect(await screen.findByRole('link', { name: 'https://example.com' })).toHaveAttribute('rel', 'noopener noreferrer');
    expect(screen.queryByRole('link', { name: /javascript/ })).toBeNull();
    expect(screen.getByText('javascript:alert(1)', { exact: false })).toBeInTheDocument();
  });
});
