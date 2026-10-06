import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMockServer, loginAs, renderRoutes } from '@/test/utils';
import AddFamilyMemberPage from './pages/AddFamilyMemberPage';

const server = createMockServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterAll(() => server.close());
beforeEach(async () => {
  // The Radix checkbox measures itself with ResizeObserver, which jsdom does not have.
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  await loginAs('hr');
});
afterEach(() => vi.unstubAllGlobals());

function renderPage() {
  return renderRoutes(
    [
      { path: '/hr/family/new', element: <AddFamilyMemberPage /> },
      { path: '/hr/family', element: <p>family list</p> },
    ],
    '/hr/family/new',
  );
}

describe('AddFamilyMemberPage', () => {
  it('requires the employee, a Latin full name and the relation', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.type(screen.getByLabelText('ФИО латиницей'), 'Каримов Тимур Азизович');
    await user.click(screen.getByRole('button', { name: 'Отправить заявку' }));
    expect(await screen.findByText('Выберите сотрудника')).toBeInTheDocument();
    expect(screen.getByLabelText('ФИО латиницей')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Кем приходится сотруднику')).toHaveAttribute('aria-invalid', 'true');
  });

  it('shows the student flag for a child only; sends a change request and returns to the list', async () => {
    const user = userEvent.setup();
    renderPage();
    const option = (await within(screen.getByRole('listbox', { name: 'Сотрудники' })).findAllByRole('option'))[0]!;
    await user.click(option);
    expect(screen.getByTestId('picked-employee')).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Кем приходится сотруднику'), 'Ребёнок');
    expect(screen.getByRole('checkbox', { name: 'Учится очно' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Телефон для входа в приложение')).toBeNull();
    await user.selectOptions(screen.getByLabelText('Кем приходится сотруднику'), 'Родитель');
    expect(screen.queryByRole('checkbox', { name: 'Учится очно' })).toBeNull();
    expect(screen.getByLabelText('Телефон для входа в приложение')).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Кем приходится сотруднику'), 'Ребёнок');
    await user.type(screen.getByLabelText('ФИО латиницей'), 'Testov Test Testovich');
    await user.type(screen.getByLabelText('Дата рождения'), '15032018');
    await user.type(screen.getByLabelText('ПИНФЛ'), '31503189876543');
    await user.click(screen.getByRole('button', { name: 'Отправить заявку' }));
    await waitFor(() => expect(screen.getByText('family list')).toBeInTheDocument());
    expect(screen.getByText('Заявка отправлена в МИГ — член семьи появится в полисе после подтверждения')).toBeInTheDocument();
  });
});
