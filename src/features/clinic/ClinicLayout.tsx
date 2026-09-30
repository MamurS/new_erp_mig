/* Clinic cabinet shell (CLINIC_SPEC §4): client theme, pill navigation, dense tables inside. */
import { NavLink, Outlet } from 'react-router-dom';
import { ChevronDown, LogOut } from 'lucide-react';
import type { Action } from '@/shared/auth/permissions';
import { useUser } from '@/shared/auth/session';
import { useCan } from '@/shared/auth/guards';
import { logout } from '@/shared/auth/logout';
import { IdleWatcher } from '@/shared/auth/IdleWatcher';
import { ROLE_LABEL } from '@/shared/domain/labels';
import { useClinicOverview } from '@/shared/api/queries/clinic';
import { Menu, MenuContent, MenuItem, MenuLabel, MenuTrigger } from '@/shared/ui/dropdown';
import { Avatar } from '@/shared/ui/chips';
import { Skeleton } from '@/shared/ui/states';
import { cn } from '@/shared/lib/cn';

const NAV: { to: string; label: string; end?: boolean; action?: Action }[] = [
  { to: '/clinic', label: 'Главная', end: true },
  { to: '/clinic/check', label: 'Проверка пациента' },
  { to: '/clinic/appointments', label: 'Записи' },
  { to: '/clinic/guarantees', label: 'Гарантийные письма' },
  { to: '/clinic/registries', label: 'Реестры', action: 'registries.submit' },
  { to: '/clinic/documents', label: 'Документы' },
  { to: '/clinic/users', label: 'Пользователи', action: 'clinic.users.manage' },
  { to: '/clinic/integration', label: 'Интеграция', action: 'clinic.integration.manage' },
];

function NavItem({ item }: { item: (typeof NAV)[number] }) {
  const allowed = useCan(item.action ?? 'clinic.check_patient');
  if (!allowed) return null;
  return (
    <li>
      <NavLink
        to={item.to}
        end={item.end}
        className={({ isActive }) =>
          cn('inline-flex h-10 items-center whitespace-nowrap rounded-full px-4 text-[14px] font-semibold transition-colors', isActive ? 'bg-accent text-white' : 'text-text hover:bg-rail')
        }
      >
        {item.label}
      </NavLink>
    </li>
  );
}

export default function ClinicLayout() {
  const user = useUser();
  const overview = useClinicOverview();
  const clinicName = overview.data?.clinicName;
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
              <p className="text-[12px] text-muted">Кабинет клиники</p>
              {clinicName ? (
                <p className="truncate font-heading text-[16px] font-semibold" data-testid="clinic-name">
                  {clinicName}
                </p>
              ) : (
                <Skeleton className="mt-1 h-4 w-40" />
              )}
            </div>
          </div>
          <nav aria-label="Разделы кабинета клиники" className="order-3 w-full overflow-x-auto">
            <ul className="flex gap-1.5">
              {NAV.map((n) => (
                <NavItem key={n.to} item={n} />
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
                <MenuLabel>{user ? ROLE_LABEL[user.role] : 'Кабинет клиники'}</MenuLabel>
                <MenuItem className="min-h-11" onSelect={() => void logout()}>
                  <LogOut className="h-4 w-4" aria-hidden />
                  Выйти
                </MenuItem>
              </MenuContent>
            </Menu>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-[1440px] flex-1 px-4 py-6 md:px-8">
        <Outlet />
      </main>
    </div>
  );
}
