import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMockServer, loginAs, renderRoutes } from '@/test/utils';
import EmployeesPage from './pages/EmployeesPage';
import ImportPage from './pages/ImportPage';
import StatsPage from './pages/StatsPage';
import DocumentsPage from './pages/DocumentsPage';
import HelpPage from './pages/HelpPage';

const server = createMockServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterAll(() => server.close());
beforeEach(async () => {
  await loginAs('hr');
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('HR pages', () => {
  it('employees: overview, privacy notice, table and filter', async () => {
    const user = userEvent.setup();
    const { router } = renderRoutes([{ path: '/hr', element: <EmployeesPage /> }], '/hr');
    expect(await screen.findByText(/застрахованы · \d+ ещё не установили приложение/)).toBeInTheDocument();
    expect(
      screen.getByText('Вы видите, кто застрахован, но не видите диагнозы, визиты и возмещения сотрудников. Это медицинская тайна, и доступа к ней у работодателя нет'),
    ).toBeInTheDocument();
    const table = screen.getByRole('table', { name: 'Сотрудники компании' });
    await within(table).findAllByRole('button', { name: 'Действия с сотрудником' });
    await user.click(screen.getByRole('button', { name: 'Не в приложении' }));
    expect(router.state.location.search).toBe('?filter=not_in_app');
    await user.type(screen.getByRole('searchbox'), 'Иван');
    expect(router.state.location.search).not.toContain('Иван');
  });

  it('import: previews valid (green) and invalid (red) rows with field errors', async () => {
    const user = userEvent.setup();
    renderRoutes([{ path: '/hr/import', element: <ImportPage /> }], '/hr/import');
    const csv =
      'fullName,birthDate,pinfl,phone,position,startDate\n' +
      'Тестов Тест Тестович,15.03.1990,31503909870001,998900000001,Инженер,01.11.2026\n' +
      'Пробов Проб,15.03.1991,123,998900000002,Бухгалтер,01.11.2026\n';
    const file = new File([csv], 'staff.csv', { type: 'text/csv' });
    const input = document.querySelector<HTMLInputElement>('input[type=file]')!;
    await user.upload(input, file);
    expect(await screen.findByRole('button', { name: 'Добавить 1 сотрудника' })).toBeInTheDocument();
    const rows = document.querySelectorAll('tr[data-status]');
    expect(rows[0]).toHaveAttribute('data-status', 'valid');
    expect(rows[1]).toHaveAttribute('data-status', 'invalid');
    expect(screen.getByText('ПИНФЛ: ПИНФЛ — 14 цифр')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Добавить 1 сотрудника' }));
    expect(await screen.findByText('Отправлено заявок: 1, пропущено 1 строка')).toBeInTheDocument();
  });

  it('import: rejects non-CSV files', async () => {
    const user = userEvent.setup({ applyAccept: false });
    renderRoutes([{ path: '/hr/import', element: <ImportPage /> }], '/hr/import');
    const input = document.querySelector<HTMLInputElement>('input[type=file]')!;
    await user.upload(input, new File(['x'], 'staff.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    expect(await screen.findByText(/Можно загрузить только файл \.csv/)).toBeInTheDocument();
  });

  it('stats, documents and help render', async () => {
    const a = renderRoutes([{ path: '/hr/stats', element: <StatsPage /> }], '/hr/stats');
    expect(await screen.findByText('Застраховано сотрудников')).toBeInTheDocument();
    a.unmount();
    const b = renderRoutes([{ path: '/hr/documents', element: <DocumentsPage /> }], '/hr/documents');
    expect(await screen.findByText('Документы полиса')).toBeInTheDocument();
    expect((await screen.findAllByRole('button', { name: /Скачать/ })).length).toBeGreaterThan(0);
    b.unmount();
    renderRoutes([{ path: '/hr/help', element: <HelpPage /> }], '/hr/help');
    const tel = await screen.findByRole('link', { name: /\+998/ });
    expect(tel.getAttribute('href')).toMatch(/^tel:\+998\d+$/);
  });
});
