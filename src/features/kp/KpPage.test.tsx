import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMockServer, loginAs, renderRoutes } from '@/test/utils';
import { db, resetDb } from '@/mocks/db';
import { formatMoney } from '@/shared/lib/format';
import KpPage from './KpPage';

const server = createMockServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterAll(() => server.close());
beforeEach(async () => {
  resetDb();
  await loginAs('underwriter');
});

const NBSP = ' ';

function demoClientId(): string {
  return db().hrUsers.find((h) => h.email === 'hr@demo-client.uz')!.companyId;
}

function renderNew() {
  const clientId = demoClientId();
  const utils = renderRoutes(
    [
      { path: '/staff/clients/:clientId/kp/new', element: <KpPage /> },
      { path: '/staff/clients/:clientId', element: <p>client card</p> },
    ],
    `/staff/clients/${clientId}/kp/new`,
  );
  return { ...utils, clientId };
}

const frameHtml = () => screen.getByTitle(/Ташкент Агрологистика/).getAttribute('srcdoc') ?? '';

describe('KP screen', () => {
  it('is prefilled from the client, recalculates the total and refreshes the 17-page preview', async () => {
    const user = userEvent.setup();
    renderNew();
    const employees = await screen.findByLabelText('Сотрудников');
    const active = db().insured.filter((i) => i.clientId === demoClientId() && i.status === 'active');
    expect(employees).toHaveValue(String(active.length));
    expect(screen.getByLabelText('Язык')).toHaveValue('ru');
    expect(screen.getByLabelText('Обложка')).toHaveValue('grey');
    expect(screen.getByTestId('kp-page-counter')).toHaveTextContent('Страница 1 из 17');
    expect(frameHtml().match(/<div class="page">/g)).toHaveLength(17);

    // total follows the form immediately
    await user.clear(employees);
    await user.type(employees, '10');
    const fam = screen.getByLabelText('Членов семей');
    await user.clear(fam);
    await user.type(fam, '2');
    const premEmp = screen.getByLabelText('Премия за сотрудника');
    await user.clear(premEmp);
    await user.type(premEmp, '7000000');
    const premFam = screen.getByLabelText('Премия за члена семьи');
    await user.clear(premFam);
    await user.type(premFam, '3000000');
    expect(premEmp).toHaveValue('7 000 000');
    expect(screen.getByTestId('kp-total').textContent).toBe(formatMoney(10 * 7_000_000 + 2 * 3_000_000));

    // the preview is re-rendered after the debounce
    await waitFor(() => expect(frameHtml()).toContain(`7${NBSP}000${NBSP}000${NBSP}сум`));
    expect(frameHtml()).toContain(`76${NBSP}000${NBSP}000${NBSP}сум`); // total in the letter

    await user.selectOptions(screen.getByLabelText('Язык'), 'en');
    await waitFor(() => expect(frameHtml()).toContain('Commercial offer'));
    expect(frameHtml()).toContain('7,000,000 UZS');
  });

  it('shows validation errors and does not save invalid parameters', async () => {
    const user = userEvent.setup();
    const { router } = renderNew();
    const employees = await screen.findByLabelText('Сотрудников');
    await user.clear(employees);
    const end = screen.getByLabelText('Окончание');
    await user.clear(end);
    await user.type(end, '01012020');
    await user.click(screen.getByRole('button', { name: 'Сохранить черновик' }));
    expect(await screen.findByText('Нужен хотя бы один сотрудник')).toBeInTheDocument();
    expect(screen.getByText('Окончание должно быть позже начала')).toBeInTheDocument();
    expect(employees).toHaveAttribute('aria-invalid', 'true');
    expect(router.state.location.pathname).toMatch(/\/kp\/new$/);
    expect(db().kp).toHaveLength(0);
    // the preview keeps the last valid state
    expect(frameHtml().match(/<div class="page">/g)).toHaveLength(17);
  });

  it('saves a draft into the client documents and opens the documents tab with the new row highlighted', async () => {
    const user = userEvent.setup();
    const { router, clientId } = renderNew();
    await screen.findByLabelText('Сотрудников');
    expect(screen.getByRole('button', { name: /Скачать PDF/ })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Сохранить черновик' }));
    await waitFor(() => expect(router.state.location.pathname).toBe(`/staff/clients/${clientId}`));
    const kp = db().kp[0]!;
    expect(router.state.location.search).toBe(`?tab=documents&highlight=${kp.id}`);
    expect(await screen.findByText(`${kp.number} сохранено в документах клиента`)).toBeInTheDocument();
    expect(kp.status).toBe('draft');
  });
});
