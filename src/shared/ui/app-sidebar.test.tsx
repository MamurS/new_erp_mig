import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ClipboardList, LayoutDashboard, Receipt, ShieldCheck } from 'lucide-react';
import { renderRoutes } from '@/test/utils';
import { getNavCollapsed, setNavCollapsed, setPref } from '@/shared/lib/storage';
import { AppSidebar, SidebarBurger, type SidebarGroup } from './app-sidebar';

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

function Shell({ onLogout = () => undefined }: { onLogout?: () => void }) {
  return (
    <div>
      <SidebarBurger onClick={() => undefined} controls="m" expanded={false} />
      <AppSidebar
        portal="staff"
        theme="staff"
        ariaLabel="Разделы портала"
        brand={{ to: '/staff', label: 'MIG ДМС — рабочий стол', title: 'MIG ДМС', icon: ShieldCheck }}
        groups={GROUPS}
        activePath="/staff/claims"
        user={{ name: 'Дмитрий Соколов', role: 'Андеррайтер' }}
        onLogout={onLogout}
        mobileOpen={false}
        onMobileOpenChange={() => undefined}
        mobileId="m"
      />
      <input aria-label="Поиск" />
    </div>
  );
}

const render = (props: { onLogout?: () => void } = {}) => renderRoutes([{ path: '*', element: <Shell {...props} /> }], '/staff/claims');
const sidebar = () => screen.getByTestId('sidebar');
const toggle = () => within(sidebar()).getByRole('button', { name: /меню$/ });

describe('AppSidebar', () => {
  beforeEach(() => setPref('navCollapsed', {}));

  it('expanded by default: labels, group titles, counters; every link has an aria-label; the active one is marked', () => {
    render();
    expect(sidebar()).toHaveAttribute('data-collapsed', 'false');
    expect(within(sidebar()).getByText('Урегулирование')).toBeInTheDocument();
    expect(within(sidebar()).getAllByTestId('nav-count').map((n) => n.textContent)).toEqual(['3', '12']);
    const claims = within(sidebar()).getByRole('link', { name: 'Убытки, задач: 12' });
    expect(claims).toHaveAttribute('aria-current', 'page');
    expect(within(sidebar()).getByRole('link', { name: 'Гарантийные письма' })).toBeInTheDocument();
    expect(toggle()).toHaveAccessibleName('Свернуть меню');
    expect(toggle()).toHaveAttribute('aria-expanded', 'true');
    expect(document.getElementById(toggle().getAttribute('aria-controls')!)).not.toBeNull();
    expect(within(sidebar()).getByTestId('sidebar-user')).toHaveTextContent('Дмитрий Соколов');
    expect(within(sidebar()).getByTestId('sidebar-user')).toHaveTextContent('Андеррайтер');
  });

  it('the button collapses to icons with dot counters; links keep their names; the choice is remembered per portal', async () => {
    const user = userEvent.setup();
    render();
    await user.click(toggle());
    expect(sidebar()).toHaveAttribute('data-collapsed', 'true');
    expect(toggle()).toHaveAccessibleName('Развернуть меню');
    expect(toggle()).toHaveAttribute('aria-expanded', 'false');
    expect(within(sidebar()).queryByText('Урегулирование')).toBeNull();
    expect(within(sidebar()).queryAllByTestId('nav-count')).toHaveLength(0);
    expect(within(sidebar()).getAllByTestId('nav-dot')).toHaveLength(2);
    expect(within(sidebar()).getByRole('link', { name: 'Убытки, задач: 12' })).toBeInTheDocument();
    expect(within(sidebar()).getByRole('button', { name: 'Профиль и выход' })).toBeInTheDocument();
    expect(getNavCollapsed('staff')).toBe(true);
    expect(getNavCollapsed('assist')).toBe(false);
  });

  it('a collapsed item shows its name in a tooltip on keyboard focus', async () => {
    // Radix positions tooltips with ResizeObserver, which jsdom does not have.
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
    setNavCollapsed('staff', true);
    render();
    const link = within(sidebar()).getByRole('link', { name: 'Гарантийные письма' });
    act(() => link.focus());
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Гарантийные письма');
    vi.unstubAllGlobals();
  });

  it('Ctrl+B and ⌘+B toggle it, except while typing in a field', async () => {
    render();
    fireEvent.keyDown(window, { key: 'b', ctrlKey: true });
    expect(sidebar()).toHaveAttribute('data-collapsed', 'true');
    fireEvent.keyDown(window, { key: 'B', metaKey: true });
    expect(sidebar()).toHaveAttribute('data-collapsed', 'false');
    fireEvent.keyDown(screen.getByLabelText('Поиск'), { key: 'b', ctrlKey: true });
    expect(sidebar()).toHaveAttribute('data-collapsed', 'false');
  });

  it('starts collapsed when the portal remembered it; «Выйти» logs out', async () => {
    setNavCollapsed('staff', true);
    const first = render();
    expect(sidebar()).toHaveAttribute('data-collapsed', 'true');
    first.unmount();
    setNavCollapsed('staff', false);
    const onLogout = vi.fn();
    render({ onLogout });
    expect(sidebar()).toHaveAttribute('data-collapsed', 'false');
    await userEvent.setup().click(within(sidebar()).getByRole('button', { name: 'Выйти' }));
    expect(onLogout).toHaveBeenCalledOnce();
  });

  it('broken storage falls back to expanded', () => {
    setPref('navCollapsed', 'oops' as never);
    expect(getNavCollapsed('staff')).toBe(false);
    setPref('navCollapsed', { staff: 'yes', assist: true } as never);
    expect(getNavCollapsed('staff')).toBe(false);
    expect(getNavCollapsed('assist')).toBe(true);
  });
});
