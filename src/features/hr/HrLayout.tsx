import { NavLink, Outlet } from 'react-router-dom';
import { ChevronDown, LogOut } from 'lucide-react';
import { useUser } from '@/shared/auth/session';
import { logout } from '@/shared/auth/logout';
import { IdleWatcher } from '@/shared/auth/IdleWatcher';
import { useHrOverview } from '@/shared/api/queries/hr';
import { Menu, MenuContent, MenuItem, MenuLabel, MenuTrigger } from '@/shared/ui/dropdown';
import { Avatar } from '@/shared/ui/chips';
import { Skeleton } from '@/shared/ui/states';
import { cn } from '@/shared/lib/cn';

const NAV = [
  { to: '/hr', label: 'Сотрудники', end: true },
  { to: '/hr/documents', label: 'Счета и документы', end: false },
  { to: '/hr/contracts', label: 'Договор и изменения', end: false },
  { to: '/hr/stats', label: 'Статистика', end: false },
  { to: '/hr/help', label: 'Помощь', end: false },
] as const;

/** HR cabinet shell: client theme, pill navigation on top, content up to 1440px (SPEC §7.2). */
export default function HrLayout() {
  const user = useUser();
  const overview = useHrOverview();
  const company = overview.data?.companyName;

  return (
    <div data-theme="client" className="flex flex-col bg-bg text-text" style={{ minHeight: 'calc(100vh - var(--banner-h, 0px))' }}>
      <IdleWatcher />
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex w-full max-w-[1440px] flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3 md:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <span aria-hidden className="flex h-11 w-11 shrink-0 items-center justify-center rounded-btn bg-accent font-heading text-[15px] font-semibold text-white">
              MIG
            </span>
            <div className="min-w-0 leading-tight">
              <p className="text-[12px] text-muted">Кабинет HR</p>
              {company ? (
                <p className="truncate font-heading text-[16px] font-semibold" data-testid="hr-company">
                  {company}
                </p>
              ) : (
                <Skeleton className="mt-1 h-4 w-40" />
              )}
            </div>
          </div>

          <nav aria-label="Разделы кабинета" className="order-3 w-full overflow-x-auto md:order-none md:w-auto md:flex-1">
            <ul className="flex gap-2">
              {NAV.map((n) => (
                <li key={n.to}>
                  <NavLink
                    to={n.to}
                    end={n.end}
                    className={({ isActive }) =>
                      cn(
                        'inline-flex h-11 items-center whitespace-nowrap rounded-full px-5 text-[15px] font-semibold transition-colors',
                        isActive ? 'bg-accent text-white' : 'text-text hover:bg-rail',
                      )
                    }
                  >
                    {n.label}
                  </NavLink>
                </li>
              ))}
            </ul>
          </nav>

          <div className="ml-auto">
            <Menu>
              <MenuTrigger asChild>
                <button type="button" className="inline-flex h-11 items-center gap-2 rounded-full pl-1 pr-3 hover:bg-rail" aria-label="Меню пользователя">
                  <Avatar name={user?.displayName ?? ''} className="h-9 w-9 text-[13px]" />
                  <span className="hidden max-w-[180px] truncate font-semibold sm:inline">{user?.displayName}</span>
                  <ChevronDown className="h-4 w-4 text-muted" aria-hidden />
                </button>
              </MenuTrigger>
              <MenuContent>
                <MenuLabel>{company ?? 'Кабинет HR'}</MenuLabel>
                <MenuItem className="min-h-11" onSelect={() => void logout()}>
                  <LogOut className="h-4 w-4" aria-hidden />
                  Выйти
                </MenuItem>
              </MenuContent>
            </Menu>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-[1440px] flex-1 px-4 py-6 md:px-8 md:py-8">
        <Outlet />
      </main>
    </div>
  );
}
