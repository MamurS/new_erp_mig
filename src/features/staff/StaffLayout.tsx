import { ContentScroll } from '@/shared/ui/content-scroll';
import { useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { BookOpen, Search } from 'lucide-react';
import { useUser } from '@/shared/auth/session';
import { logout } from '@/shared/auth/logout';
import { IdleWatcher } from '@/shared/auth/IdleWatcher';
import { ROLE_LABEL } from '@/shared/domain/labels';
import { useDashboard } from '@/shared/api/queries/staff';
import { LanguageButton } from '@/shared/ui/language-switch';
import { AppSidebar, SidebarProvider, SidebarToggle, type SidebarGroup } from '@/shared/ui/app-sidebar';
import { Breadcrumbs } from '@/shared/ui/page';
import { t } from '@/i18n';
import { QUEUE_NAV, STAFF_NAV_GROUP_LABEL, STAFF_NAV_GROUPS, STAFF_SECTIONS } from './nav';
import { CommandPalette, type PaletteMode } from './CommandPalette';
import { useTopbarState } from './topbar';
import { CreateMenu } from '@/features/shell/CreateMenu';
import { HelpContextButton } from '@/features/help/HelpContextButton';

export default function StaffLayout() {
  const user = useUser();
  const loc = useLocation();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteMode, setPaletteMode] = useState<PaletteMode>('search');
  const { crumbs, action } = useTopbarState();
  const dashboard = useDashboard();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteMode('search');
        setPaletteOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!user) return null;
  const openSearch = () => {
    setPaletteMode('search');
    setPaletteOpen(true);
  };
  const sections = STAFF_SECTIONS.filter((s) => s.inNav && (s.roles as string[]).includes(user.role));
  // The longest matching section wins: «Резервы» lives under «Отчёты», «Ручная разноска» under «Счета».
  const current = sections.filter((s) => (s.path === '/staff' ? loc.pathname === '/staff' : loc.pathname === s.path || loc.pathname.startsWith(`${s.path}/`))).sort((a, b) => b.path.length - a.path.length)[0]?.path;
  const counts = new Map<string, number>();
  for (const q of dashboard.data?.queueTypes ?? []) {
    const path = QUEUE_NAV[q.type];
    if (path) counts.set(path, (counts.get(path) ?? 0) + q.count);
  }
  if (dashboard.data) counts.set('/staff', dashboard.data.queueCount);
  // Only groups with at least one section the role may open.
  const groups: SidebarGroup[] = STAFF_NAV_GROUPS.map((g) => ({
    label: STAFF_NAV_GROUP_LABEL[g],
    items: sections.filter((s) => s.group === g).map((s) => ({ path: s.path, label: s.label, icon: s.icon, count: counts.get(s.path) })),
  })).filter((g) => g.items.length > 0);
  const isMac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform);

  return (
    <SidebarProvider portal="staff">
      <div data-theme="staff" className="portal-shell flex h-[calc(100dvh-var(--banner-h,0px))] overflow-hidden">
        <AppSidebar
          title={t('shell.title.staff')}
          ariaLabel={t('staff.layout.sections')}
          groups={groups}
          activePath={current}
          user={{ name: user.displayName, role: ROLE_LABEL[user.role], portal: t('shell.portal.staff') }}
          onLogout={() => void logout()}
          onSearch={openSearch}
          footer={[{ path: '/staff/help', label: t('help.nav'), icon: BookOpen }]}
        />
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <header data-testid="topbar" className="relative z-30 flex h-(--topbar-h) shrink-0 items-center gap-3 border-b border-border bg-surface px-4">
            <SidebarToggle />
            <div className="min-w-0 flex-1">
              <Breadcrumbs items={crumbs.length ? crumbs : [{ label: t('staff.layout.crumbRoot') }]} />
            </div>
            <button
              type="button"
              onClick={openSearch}
              className="hidden h-8 w-64 items-center gap-2 rounded-btn border border-border bg-bg px-2 text-muted hover:text-text md:flex"
              aria-label={t('staff.layout.openSearch')}
            >
              <Search className="h-3.5 w-3.5" aria-hidden />
              <span className="flex-1 text-left">{t('shell.panel.search')}</span>
              <kbd className="rounded-sm border border-border px-1 text-[10px]">{isMac ? '⌘K' : 'Ctrl K'}</kbd>
            </button>
            <button type="button" onClick={openSearch} className="rounded-btn p-2 text-muted md:hidden" aria-label={t('staff.layout.openSearch')}>
              <Search className="h-4 w-4" />
            </button>
            <HelpContextButton />
            <LanguageButton />
            <span className="hidden items-center gap-1.5 rounded-btn bg-success-soft px-2 py-1 text-[12px] font-medium text-success-text lg:inline-flex" title={t('staff.layout.mfaHint')}>
              <span className="h-1.5 w-1.5 rounded-full bg-success" aria-hidden /> MFA · VPN
            </span>
            {action}
            <CreateMenu
              onCommand={(c) => {
                if (c === 'pick-insured-for-claim') {
                  setPaletteMode('claim');
                  setPaletteOpen(true);
                }
              }}
            />
          </header>
          <ContentScroll className="p-4 lg:p-5">
            <Outlet />
          </ContentScroll>
        </div>
        <CommandPalette
          open={paletteOpen}
          mode={paletteMode}
          onOpenChange={(v) => {
            setPaletteOpen(v);
            if (!v) setPaletteMode('search');
          }}
          user={user}
        />
        <IdleWatcher />
      </div>
    </SidebarProvider>
  );
}
