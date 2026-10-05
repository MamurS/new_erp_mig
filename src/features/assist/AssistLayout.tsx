/*
 * Assistance portal shell (ASSISTANCE_SPEC §6): the dense `staff` theme for the call centre, a rail of
 * collapsible side navigation grouped by work and a top bar with the assistance name and the «Портал партнёра» mark.
 */
import { Outlet, useLocation } from 'react-router-dom';
import { useUser } from '@/shared/auth/session';
import { logout } from '@/shared/auth/logout';
import { IdleWatcher } from '@/shared/auth/IdleWatcher';
import { ROLE_LABEL } from '@/shared/domain/labels';
import { useAssistOverview } from '@/shared/api/queries/assist';
import { AppSidebar, SidebarProvider, SidebarToggle, type SidebarGroup } from '@/shared/ui/app-sidebar';
import { Breadcrumbs } from '@/shared/ui/page';
import { Skeleton } from '@/shared/ui/states';
import { useTopbarState } from '@/features/staff/topbar';
import { ASSIST_NAV_GROUP_LABEL, ASSIST_NAV_GROUPS, ASSIST_SECTIONS } from './nav';
import { t } from '@/i18n';

export default function AssistLayout() {
  const user = useUser();
  const loc = useLocation();
  const overview = useAssistOverview();
  const { crumbs, action } = useTopbarState();
  if (!user) return null;
  const sections = ASSIST_SECTIONS.filter((s) => (s.roles as string[]).includes(user.role));
  const name = overview.data?.assistance.name;
  const current = sections.filter((s) => (s.path === '/assist' ? loc.pathname === '/assist' : loc.pathname === s.path || loc.pathname.startsWith(`${s.path}/`))).sort((a, b) => b.path.length - a.path.length)[0]?.path;
  const c = overview.data?.counters;
  const counts: Record<string, number | undefined> = c
    ? { '/assist/cases': c.openCases, '/assist/guarantees': c.guaranteesPending, '/assist/registries': c.linesPending, '/assist/rebills': c.rebillsInReview }
    : {};
  const groups: SidebarGroup[] = ASSIST_NAV_GROUPS.map((g) => ({
    label: ASSIST_NAV_GROUP_LABEL[g],
    items: sections.filter((s) => s.group === g).map((s) => ({ path: s.path, label: s.label, icon: s.icon, count: counts[s.path] })),
  })).filter((g) => g.items.length > 0);

  return (
    <SidebarProvider portal="assist">
      <div data-theme="staff" className="flex min-h-[calc(100vh-var(--banner-h,0px))]">
        <AppSidebar
          title={t('shell.title.assist')}
          ariaLabel={t('assist.layout.navAria')}
          groups={groups}
          activePath={current}
          user={{ name: user.displayName, role: ROLE_LABEL[user.role], portal: name ? t('assist.layout.partnerPortalOf', { name }) : t('assist.layout.partnerPortal') }}
          onLogout={() => void logout()}
        />
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-(--banner-h,0px) z-30 flex h-[52px] shrink-0 items-center gap-3 border-b border-border bg-surface px-4">
            <SidebarToggle />
            <div className="flex min-w-0 shrink-0 items-center gap-2 border-r border-border pr-3">
              {name ? (
                <span className="max-w-[220px] truncate font-semibold" data-testid="assistance-name">
                  {name}
                </span>
              ) : (
                <Skeleton className="h-4 w-32" />
              )}
              <span className="hidden rounded-btn bg-accent-soft px-1.5 py-0.5 text-[11px] font-medium text-accent-text sm:inline">{t('assist.layout.partnerPortal')}</span>
            </div>
            <div className="min-w-0 flex-1">
              <Breadcrumbs items={crumbs.length ? crumbs : [{ label: t('assist.nav.dashboard') }]} />
            </div>
            {action}
          </header>
          <main className="min-w-0 flex-1 p-4 lg:p-5">
            <Outlet />
          </main>
        </div>
        <IdleWatcher />
      </div>
    </SidebarProvider>
  );
}
