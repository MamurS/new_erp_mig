import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMockServer, loginAs, renderRoutes } from '@/test/utils';
import BookingPage from './pages/BookingPage';

const server = createMockServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterAll(() => server.close());

const routes = [
  { path: '/app/booking', element: <BookingPage /> },
  { path: '/app/appointments', element: <p>appointments-page</p> },
  { path: '/app', element: <p>home-page</p> },
];

describe('BookingPage wizard', () => {
  it('walks specialty → clinic and slot → summary → success', async () => {
    const user = userEvent.setup();
    await loginAs('insured');
    renderRoutes(routes, '/app/booking', { i18n: true });

    // Step 1: specialty grid.
    expect(screen.getByText('Шаг 1 из 3')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Терапевт' }));

    // Step 2: day chips, nearby clinics with slots.
    expect(await screen.findByText('Шаг 2 из 3')).toBeInTheDocument();
    const continueBtn = screen.getByRole('button', { name: 'Продолжить' });
    expect(continueBtn).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Завтра' }));
    const groups = await screen.findAllByRole('group', { name: /Свободное время в клинике/ });
    expect(groups.length).toBeGreaterThan(0);
    const slots = await screen.findAllByRole('button', { name: /^\d{2}:\d{2}$/ });
    const slot = slots[0]!;
    const time = slot.textContent ?? '';
    await user.click(slot);
    expect(slot).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('booking-summary')).toHaveTextContent(`${time}, завтра`);
    expect(continueBtn).toBeEnabled();
    await user.click(continueBtn);

    // Step 3: summary.
    expect(await screen.findByText('Шаг 3 из 3')).toBeInTheDocument();
    expect(screen.getByText('Проверьте запись')).toBeInTheDocument();
    const summary = screen.getByText('Проверьте запись').parentElement!;
    expect(within(summary).getByText('Терапевт')).toBeInTheDocument();
    expect(within(summary).getByText(`Завтра, ${time}`)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Записаться' }));

    // Success.
    expect(await screen.findByText('Запись отправлена в клинику, подтверждение придёт уведомлением')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Мои записи' })).toHaveAttribute('href', '/app/appointments');
  });

  it('opens at step 2 when started from a clinic', async () => {
    await loginAs('insured');
    renderRoutes(routes, '/app/booking?specialty=dentist', { i18n: true });
    expect(await screen.findByText('Шаг 2 из 3')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Сегодня' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('ignores unsafe entry params and starts at step 1', async () => {
    await loginAs('insured');
    renderRoutes(routes, '/app/booking?specialty=<script>&clinicId=javascript:alert(1)', { i18n: true });
    expect(await screen.findByText('Шаг 1 из 3')).toBeInTheDocument();
  });
});
