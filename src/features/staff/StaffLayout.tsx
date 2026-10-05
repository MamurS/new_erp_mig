import { useEffect, useId, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Search, ShieldCheck } from 'lucide-react';
import { useUser } from '@/shared/auth/session';
import { logout } from '@/shared/auth/logout';
import { IdleWatcher } from '@/shared/auth/IdleWatcher';
import { ROLE_LABEL } from '@/shared/domain/labels';
import { useDashboard } from '@/shared/api/queries/staff';
import { AppSidebar, SidebarBurger, type SidebarGroup } from '@/shared/ui/app-sidebar';
import { Breadcrumbs } from '@/shared/ui/page';
import { QUEUE_NAV, STAFF_NAV_GROUPS, STAFF_SECTIONS } from './nav';
import { CommandPalette } from './CommandPalette';
import { useTopbarState } from './topbar';

export default function StaffLayout() {
  const user = useUser();
  const loc = useLocation();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const mobileId = useId();
  const { crumbs, action } = useTopbarState();
  const dashboard = useDashboard();

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
  // The longest matching section wins: «Резервы» lives under «Отчёты», «Ручная разноска» under «Счета».
  const current = sections.filter((s) => (s.path === '/staff' ? loc.pathname === '/staff' : loc.pathname === s.path || loc.pathname.startsWith(`${s.path}/`))).sort((a, b) => b.path.length - a.path.length)[0]?.path;
  const counts = new Map<string, number>();
  for (const t of dashboard.data?.queueTypes ?? []) {
    const path = QUEUE_NAV[t.type];
    if (path) counts.set(path, (counts.get(path) ?? 0) + t.count);
  }
  if (dashboard.data) counts.set('/staff', dashboard.data.queueCount);
  // Only groups with at least one section the role may open.
  const groups: SidebarGroup[] = STAFF_NAV_GROUPS.map((g) => ({
    label: g,
    items: sections.filter((s) => s.group === g).map((s) => ({ path: s.path, label: s.label, icon: s.icon, count: counts.get(s.path) })),
  })).filter((g) => g.items.length > 0);
  const isMac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform);

  return (
    <div data-theme="staff" className="flex min-h-[calc(100vh-var(--banner-h,0px))]">
      <AppSidebar
        portal="staff"
        theme="staff"
        ariaLabel="Разделы портала"
        brand={{ to: '/staff', label: 'MIG ДМС — рабочий стол', title: 'MIG ДМС', subtitle: 'Портал сотрудников', icon: ShieldCheck }}
        groups={groups}
        activePath={current}
        user={{ name: user.displayName, role: ROLE_LABEL[user.role] }}
        onLogout={() => void logout()}
        mobileOpen={menuOpen}
        onMobileOpenChange={setMenuOpen}
        mobileId={mobileId}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-[var(--banner-h,0px)] z-30 flex h-[52px] shrink-0 items-center gap-3 border-b border-border bg-surface px-4">
          <SidebarBurger onClick={() => setMenuOpen(true)} controls={mobileId} expanded={menuOpen} />
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
