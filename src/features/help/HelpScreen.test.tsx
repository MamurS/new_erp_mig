/*
 * The help screen against the real mock API: the table of contents and the article follow the role,
 * «Открыть раздел» only with access to the screen, search with grouped results and the keyboard,
 * «Задать вопрос» with steps and sources, the print view with a title page and a table of contents.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMockServer, loginAs, renderRoutes } from '@/test/utils';
import HelpPage from './HelpPage';

const server = createMockServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterAll(() => server.close());
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const routes = (portal: string) => [
  { path: `/${portal}/help`, element: <HelpPage /> },
  { path: `/${portal}/help/:anchor`, element: <HelpPage /> },
];

describe('help screen', () => {
  it('shows the article with breadcrumbs, prev/next and «Открыть раздел» only for screens the role may open', async () => {
    await loginAs('accountant');
    const a = renderRoutes(routes('staff'), '/staff/help/finance#manual-allocation');
    const article = await screen.findByTestId('help-article');
    expect(within(article).getByRole('heading', { level: 2, name: /^12\. / })).toBeInTheDocument();
    expect(within(article).getAllByRole('link', { name: 'Открыть раздел «Ручная разноска»' })[0]).toHaveAttribute('href', '/staff/invoices/queue');
    const pager = within(article).getByRole('navigation', { name: 'Соседние статьи' });
    expect(within(pager).getByRole('link', { name: /Предыдущая/ })).toHaveAttribute('href', '/staff/help/claims');
    expect(within(pager).getByRole('link', { name: /Следующая/ })).toHaveAttribute('href', '/staff/help/staff-roles');
    expect(screen.getByRole('button', { name: /Скопировать ссылку на подраздел «Ручная разноска»/ })).toBeInTheDocument();
    a.unmount();

    await loginAs('operator');
    renderRoutes(routes('staff'), '/staff/help/finance');
    const other = await screen.findByTestId('help-article');
    expect(within(other).queryByRole('link', { name: 'Открыть раздел «Ручная разноска»' })).toBeNull();
  });

  it('HR: the table of contents has no MIG-only articles, a hidden subsection does not open', async () => {
    await loginAs('hr');
    const a = renderRoutes(routes('hr'), '/hr/help');
    const toc = await screen.findByTestId('help-toc');
    await within(toc).findByRole('link', { name: /О системе/ });
    expect(within(toc).queryByRole('link', { name: /Урегулирование убытков/ })).toBeNull();
    expect(toc.textContent).not.toMatch(/мошенничеств/i);
    a.unmount();
    renderRoutes(routes('hr'), '/hr/help/claims-fraud');
    expect(await screen.findByText('Статья не найдена или недоступна для вашей роли.')).toBeInTheDocument();
  });

  it('search: grouped results, the match highlighted, arrows and Enter open a result', async () => {
    await loginAs('operator');
    const user = userEvent.setup();
    const { router } = renderRoutes(routes('staff'), '/staff/help');
    const box = await screen.findByRole('combobox', { name: 'Поиск по справке' });
    await user.type(box, 'гп');
    const list = await screen.findByRole('listbox', { name: 'Результаты поиска по справке' });
    const terms = await within(list).findByRole('group', { name: 'Термины' });
    expect(within(terms).getAllByRole('option')[0]).toHaveTextContent(/гарантийное письмо/i);
    expect(within(list).getByRole('group', { name: 'Статьи' })).toBeInTheDocument();
    expect(list.querySelector('mark')).not.toBeNull();
    await user.keyboard('{ArrowDown}');
    expect(box.getAttribute('aria-activedescendant')).toBe(within(list).getAllByRole('option')[1]!.id);
    await user.keyboard('{Enter}');
    expect(router.state.location.pathname).toMatch(/^\/staff\/help\/[a-z-]+$/);
  });

  it('«Задать вопрос»: steps and a source link; «Полезно» is accepted', async () => {
    await loginAs('accountant');
    const user = userEvent.setup();
    renderRoutes(routes('staff'), '/staff/help');
    await user.type(await screen.findByRole('textbox', { name: 'Задайте вопрос своими словами' }), 'как разнести платёж от другой компании');
    await user.click(screen.getByRole('button', { name: 'Спросить' }));
    const answer = await screen.findByTestId('help-answer');
    expect(within(answer).getByTestId('help-answer-steps').querySelectorAll('li').length).toBeGreaterThan(0);
    expect(within(answer).getByTestId('help-answer-sources').querySelector('a[href^="/staff/help/finance"]')).not.toBeNull();
    await user.click(within(answer).getByRole('button', { name: /Полезно/ }));
    expect(await within(answer).findByText('Спасибо, оценка учтена')).toBeInTheDocument();
  });

  it('«Скачать PDF → Вся справка»: the print view with a title page and a table of contents, then print()', async () => {
    await loginAs('hr');
    const print = vi.fn();
    vi.stubGlobal('print', print);
    const user = userEvent.setup();
    renderRoutes(routes('hr'), '/hr/help');
    await screen.findByTestId('help-article');
    await user.click(screen.getByRole('button', { name: 'Скачать PDF' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Вся справка' }));
    const view = await screen.findByTestId('help-print');
    const toc = await within(view).findByTestId('help-print-toc');
    expect(within(toc).getAllByRole('link').length).toBeGreaterThan(5);
    expect(within(view).getByTestId('help-print-meta')).toHaveTextContent(/Роль: HR/);
    expect(view.textContent).not.toMatch(/мошенничеств/i);
    expect(document.documentElement.classList.contains('help-printing')).toBe(true);
    await vi.waitFor(() => expect(print).toHaveBeenCalledTimes(1));
    await user.click(within(view).getByRole('button', { name: 'Закрыть' }));
    expect(screen.queryByTestId('help-print')).toBeNull();
    expect(document.documentElement.classList.contains('help-printing')).toBe(false);
  });
});
