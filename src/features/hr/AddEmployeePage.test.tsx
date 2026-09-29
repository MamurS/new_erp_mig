import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMockServer, loginAs, renderRoutes } from '@/test/utils';
import AddEmployeePage from './pages/AddEmployeePage';

const server = createMockServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterAll(() => server.close());
beforeEach(async () => {
  await loginAs('hr');
});

function renderPage() {
  return renderRoutes(
    [
      { path: '/hr/employees/new', element: <AddEmployeePage /> },
      { path: '/hr', element: <p>list</p> },
    ],
    '/hr/employees/new',
  );
}

describe('AddEmployeePage', () => {
  it('shows field errors on empty submit and focuses the first invalid field', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: 'Добавить сотрудника' }));
    const name = screen.getByLabelText('ФИО');
    await waitFor(() => expect(name).toHaveFocus());
    expect(name).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('Укажите фамилию, имя и отчество')).toBeInTheDocument();
    expect(screen.getByLabelText('ПИНФЛ')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Телефон')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Должность')).toHaveAttribute('aria-invalid', 'true');
  });

  it('rejects a 13-digit PINFL after leaving the field', async () => {
    const user = userEvent.setup();
    renderPage();
    const pinfl = screen.getByLabelText('ПИНФЛ');
    await user.type(pinfl, '1234567890123');
    await user.tab();
    expect(await screen.findByText('ПИНФЛ — 14 цифр')).toBeInTheDocument();
    expect(pinfl).toHaveAttribute('aria-invalid', 'true');
  });

  it('masks input, submits a valid employee, shows the toast and returns to the list', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.type(screen.getByLabelText('ФИО'), 'Тестов Тест Тестович');
    await user.type(screen.getByLabelText('Дата рождения'), '15031990');
    expect(screen.getByLabelText('Дата рождения')).toHaveValue('15.03.1990');
    await user.type(screen.getByLabelText('ПИНФЛ'), '31503909876543');
    await user.type(screen.getByLabelText('Телефон'), '901234567');
    expect(screen.getByLabelText('Телефон')).toHaveValue('+998 90 123 45 67');
    await user.type(screen.getByLabelText('Должность'), 'Инженер');
    await user.type(screen.getByLabelText('Дата начала страхования'), '01112026');
    await user.click(screen.getByRole('button', { name: 'Добавить сотрудника' }));
    expect(await screen.findByText('list')).toBeInTheDocument();
    expect(screen.getByText('Сотрудник добавлен, приглашение отправлено')).toBeInTheDocument();
  });
});
