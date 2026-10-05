import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ClipboardList, LayoutDashboard, Receipt } from 'lucide-react';
import { renderRoutes } from '@/test/utils';
import { getNavPrefs, setNavPrefs, setPref } from '@/shared/lib/storage';
import { AppSidebar, SidebarProvider, SidebarToggle, type SidebarGroup } from './app-sidebar';

const GROUPS: SidebarGroup[] = [
  { label: 'Работа', items: [{ path: '/staff', label: 'Рабочий стол', icon: LayoutDashboard, count: 3 }] },
  {
    label: 'Урегулирование',
    items: [
      { path: '/staff/claims', label: 'Убытки', icon: Receipt, count: 12 },
      { path: '/staff/guarantees', label: 'Гарантийные письма', icon: ClipboardList },
    ],
  },
];

function Shell({ onLogout = () => undefined, onSearch }: { onLogout?: () => void; onSearch?: () => void }) {
  return (
    <SidebarProvider portal="staff">
      <AppSidebar
        title="MIG"
        ariaLabel="Разделы портала"
        groups={GROUPS}
        activePath="/staff/claims"
        user={{ name: 'Дмитрий Соколов', role: 'Андеррайтер', portal: 'Портал сотрудников МИГ' }}
        onLogout={onLogout}
        onSearch={onSearch}
      />
      <header>
        <SidebarToggle />
        <input aria-label="Поле" />
      </header>
    </SidebarProvider>
  );
}

const render = (props: { onLogout?: () => void; onSearch?: () => void } = {}) => renderRoutes([{ path: '*', element: <Shell {...props} /> }], '/staff/claims');
const panel = () => screen.getByTestId('sidebar');

describe('AppSidebar', () => {
  beforeEach(() => {
    setPref('nav', {});
    // Radix positions tooltips and menus with ResizeObserver, which jsdom does not have.
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('docked by default at 288 px: title, lower-case group titles, counters as numbers, the active row marked; no content toggle', () => {
    render({ onSearch: () => undefined });
    expect(panel()).toHaveAttribute('data-state', 'expanded');
    expect(panel().style.width).toBe('288px');
    expect(within(panel()).getByTestId('sidebar-title')).toHaveTextContent('MIG');
    expect(within(panel()).getByText('Урегулирование')).toBeInTheDocument();
    expect(within(panel()).getAllByTestId('nav-count').map((n) => n.textContent)).toEqual(['3', '12']);
    const claims = within(panel()).getByRole('link', { name: 'Убытки, задач: 12' });
    expect(claims).toHaveAttribute('aria-current', 'page');
    expect(within(panel()).getByRole('link', { name: 'Гарантийные письма' })).not.toHaveAttribute('aria-current');
    expect(within(panel()).getByRole('button', { name: 'Поиск' })).toBeInTheDocument();
    expect(within(panel()).getByRole('button', { name: 'Меню пользователя' })).toHaveTextContent('Дмитрий Соколов · Андеррайтер');
    expect(screen.queryByTestId('sidebar-toggle')).toBeNull();
  });

  it('«Скрыть панель» hides it completely and puts the toggle into the content; the toggle brings it back; the state is remembered per portal', async () => {
    const user = userEvent.setup();
    render();
    const hide = within(panel()).getByRole('button', { name: 'Скрыть панель' });
    expect(hide).toHaveAttribute('aria-expanded', 'true');
    await user.click(hide);
    expect(panel()).toHaveAttribute('data-state', 'collapsed');
    expect(panel().style.width).toBe('0px');
    expect(panel()).toHaveAttribute('inert');
    expect(getNavPrefs('staff').collapsed).toBe(true);
    expect(getNavPrefs('hr').collapsed).toBe(false);
    const toggle = screen.getByTestId('sidebar-toggle');
    expect(toggle).toHaveAccessibleName('Показать панель');
    expect(toggle).toHaveAttribute('aria-controls', panel().id);
    await user.click(toggle);
    expect(panel()).toHaveAttribute('data-state', 'expanded');
    expect(screen.queryByTestId('sidebar-toggle')).toBeNull();
  });

  it('Ctrl+B and ⌘+B toggle it, except while typing in a field', () => {
    render();
    fireEvent.keyDown(window, { key: 'b', ctrlKey: true });
    expect(panel()).toHaveAttribute('data-state', 'collapsed');
    fireEvent.keyDown(window, { key: 'B', metaKey: true });
    expect(panel()).toHaveAttribute('data-state', 'expanded');
    fireEvent.keyDown(screen.getByLabelText('Поле'), { key: 'b', ctrlKey: true });
    expect(panel()).toHaveAttribute('data-state', 'expanded');
  });

  it('hovering the toggle previews the panel over the content; it closes 300 ms after the mouse leaves; a click pins it', () => {
    setNavPrefs('staff', { collapsed: true });
    vi.useFakeTimers();
    render();
    const toggle = screen.getByTestId('sidebar-toggle');
    fireEvent.mouseEnter(toggle);
    const preview = screen.getByTestId('sidebar-preview');
    expect(within(preview).getByRole('link', { name: 'Убытки, задач: 12' })).toBeInTheDocument();
    expect(panel()).toHaveAttribute('data-state', 'collapsed');
    fireEvent.mouseLeave(toggle);
    act(() => vi.advanceTimersByTime(200));
    fireEvent.mouseEnter(preview); // the mouse moved onto the panel in time
    act(() => vi.advanceTimersByTime(400));
    expect(screen.getByTestId('sidebar-preview')).toBeInTheDocument();
    fireEvent.mouseLeave(screen.getByTestId('sidebar-preview'));
    act(() => vi.advanceTimersByTime(299));
    expect(screen.getByTestId('sidebar-preview')).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(2));
    expect(screen.queryByTestId('sidebar-preview')).toBeNull();

    fireEvent.mouseEnter(toggle);
    fireEvent.click(toggle);
    expect(screen.queryByTestId('sidebar-preview')).toBeNull();
    expect(panel()).toHaveAttribute('data-state', 'expanded');
    expect(getNavPrefs('staff').collapsed).toBe(false);
  });

  it('the separator resizes with the keyboard (±16 px, 224–400), double click resets to 288; the width is saved', () => {
    render();
    const sep = within(panel()).getByRole('separator', { name: 'Ширина панели' });
    expect(sep).toHaveAttribute('aria-orientation', 'vertical');
    expect(sep).toHaveAttribute('aria-valuenow', '288');
    expect(sep).toHaveAttribute('aria-valuemin', '224');
    expect(sep).toHaveAttribute('aria-valuemax', '400');
    expect(sep).toHaveAttribute('tabindex', '0');
    fireEvent.keyDown(sep, { key: 'ArrowRight' });
    expect(sep).toHaveAttribute('aria-valuenow', '304');
    expect(panel().style.width).toBe('304px');
    expect(getNavPrefs('staff').width).toBe(304);
    fireEvent.keyDown(sep, { key: 'ArrowLeft' });
    fireEvent.keyDown(sep, { key: 'ArrowLeft' });
    expect(sep).toHaveAttribute('aria-valuenow', '272');
    fireEvent.keyDown(sep, { key: 'End' });
    fireEvent.keyDown(sep, { key: 'ArrowRight' });
    expect(sep).toHaveAttribute('aria-valuenow', '400');
    fireEvent.keyDown(sep, { key: 'Home' });
    expect(sep).toHaveAttribute('aria-valuenow', '224');
    fireEvent.doubleClick(sep);
    expect(sep).toHaveAttribute('aria-valuenow', '288');
    expect(getNavPrefs('staff').width).toBe(288);
  });

  it('the user menu has «Профиль» and «Выйти»', async () => {
    const user = userEvent.setup();
    const onLogout = vi.fn();
    render({ onLogout });
    await user.click(within(panel()).getByRole('button', { name: 'Меню пользователя' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Профиль' }));
    const dialog = await screen.findByRole('dialog', { name: 'Профиль' });
    expect(dialog).toHaveTextContent('Портал сотрудников МИГ');
    await user.keyboard('{Escape}');
    await user.click(within(panel()).getByRole('button', { name: 'Меню пользователя' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Выйти' }));
    expect(onLogout).toHaveBeenCalledOnce();
  });

  it('storage: per portal, clamped width, broken values fall back to the defaults', () => {
    setNavPrefs('clinic', { width: 999 });
    expect(getNavPrefs('clinic')).toEqual({ collapsed: false, width: 400 });
    setPref('nav', 'oops' as never);
    expect(getNavPrefs('staff')).toEqual({ collapsed: false, width: 288 });
    setPref('nav', { assist: { collapsed: 'yes', width: 'wide' }, hr: { collapsed: true, width: 100 } } as never);
    expect(getNavPrefs('assist')).toEqual({ collapsed: false, width: 288 });
    expect(getNavPrefs('hr')).toEqual({ collapsed: true, width: 224 });
  });
});
