import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { LogOut, Search, ShieldCheck } from 'lucide-react';
import { useUser } from '@/shared/auth/session';
import { logout } from '@/shared/auth/logout';
import { IdleWatcher } from '@/shared/auth/IdleWatcher';
import { ROLE_LABEL } from '@/shared/domain/labels';
import { cn } from '@/shared/lib/cn';
import { Avatar } from '@/shared/ui/chips';
import { Breadcrumbs } from '@/shared/ui/page';
import { Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger } from '@/shared/ui/dropdown';
import { Tooltip } from '@/shared/ui/tooltip';
import { STAFF_SECTIONS } from './nav';
import { CommandPalette } from './CommandPalette';
import { useTopbarState } from './topbar';

export default function StaffLayout() {
  const user = useUser();
  const loc = useLocation();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const { crumbs, action } = useTopbarState();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!user) return null;
  const sections = STAFF_SECTIONS.filter((s) => s.inNav && (s.roles as string[]).includes(user.role));
  // The longest matching section wins: «Резервы» lives under «Отчёты».
  const current = sections.filter((s) => (s.path === '/staff' ? loc.pathname === '/staff' : loc.pathname.startsWith(s.path))).sort((a, b) => b.path.length - a.path.length)[0]?.path;
  const isMac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform);

  return (
    <div data-theme="staff" className="flex min-h-[calc(100vh-var(--banner-h,0px))]">
      <nav
        aria-label="Разделы портала"
        className="sticky top-[var(--banner-h,0px)] flex h-[calc(100vh-var(--banner-h,0px))] w-[60px] shrink-0 flex-col items-center gap-1 border-r border-border bg-rail py-3"
      >
        <NavLink to="/staff" end aria-label="MIG ДМС — рабочий стол" className="mb-3 flex h-9 w-9 items-center justify-center rounded-btn bg-accent text-white">
          <ShieldCheck className="h-5 w-5" aria-hidden />
        </NavLink>
        {sections.map((s) => {
          const active = s.path === current;
          return (
            <Tooltip key={s.path} content={s.label} side="right">
              <NavLink
                to={s.path}
                end={s.path === '/staff'}
                aria-label={s.label}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex h-10 w-10 items-center justify-center rounded-btn text-muted hover:bg-surface hover:text-text',
                  active && 'bg-surface text-accent shadow-sm ring-1 ring-border',
                )}
              >
                <s.icon className="h-[18px] w-[18px]" aria-hidden />
              </NavLink>
            </Tooltip>
          );
        })}
        <div className="mt-auto">
          <Menu>
            <MenuTrigger asChild>
              <button type="button" aria-label="Профиль и выход" className="rounded-full">
                <Avatar name={user.displayName} className="h-9 w-9" />
              </button>
            </MenuTrigger>
            <MenuContent align="start">
              <MenuLabel>
                <span className="block font-semibold text-text">{user.displayName}</span>
                {ROLE_LABEL[user.role]}
              </MenuLabel>
              <MenuSeparator />
              <MenuItem onSelect={() => void logout()}>
                <LogOut className="h-4 w-4" aria-hidden /> Выйти
              </MenuItem>
            </MenuContent>
          </Menu>
        </div>
      </nav>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-[var(--banner-h,0px)] z-30 flex h-[52px] shrink-0 items-center gap-3 border-b border-border bg-surface px-4">
          <div className="min-w-0 flex-1">
            <Breadcrumbs items={crumbs.length ? crumbs : [{ label: 'Портал сотрудников' }]} />
          </div>
          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            className="hidden h-8 w-64 items-center gap-2 rounded-btn border border-border bg-bg px-2 text-muted hover:text-text md:flex"
            aria-label="Открыть поиск"
          >
            <Search className="h-3.5 w-3.5" aria-hidden />
            <span className="flex-1 text-left">Поиск</span>
            <kbd className="rounded border border-border px-1 text-[10px]">{isMac ? '⌘K' : 'Ctrl K'}</kbd>
          </button>
          <button type="button" onClick={() => setPaletteOpen(true)} className="rounded-btn p-2 text-muted md:hidden" aria-label="Открыть поиск">
            <Search className="h-4 w-4" />
          </button>
          <span className="hidden items-center gap-1.5 rounded-btn bg-success-soft px-2 py-1 text-[12px] font-medium text-success-text lg:inline-flex" title="Вход с MFA через корпоративный VPN">
            <span className="h-1.5 w-1.5 rounded-full bg-success" aria-hidden /> MFA · VPN
          </span>
          {action}
        </header>
        <main className="min-w-0 flex-1 p-4 lg:p-5">
          <Outlet />
        </main>
      </div>
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} user={user} />
      <IdleWatcher />
    </div>
  );
}
