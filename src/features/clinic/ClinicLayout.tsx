import { ContentScroll } from '@/shared/ui/content-scroll';
/* Clinic cabinet shell (CLINIC_SPEC §4): client theme for the content, the common side panel for navigation. */
import { LegalFormChip } from '@/shared/ui/legal-form';
import { Outlet, useLocation } from 'react-router-dom';
import { CalendarClock, ClipboardList, FileCheck, FolderOpen, House, PlugZap, ScanLine, Users, type LucideIcon } from 'lucide-react';
import { can, type Action } from '@/shared/auth/permissions';
import { useUser } from '@/shared/auth/session';
import { logout } from '@/shared/auth/logout';
import { IdleWatcher } from '@/shared/auth/IdleWatcher';
import { ROLE_LABEL } from '@/shared/domain/labels';
import { useClinicOverview } from '@/shared/api/queries/clinic';
import { LanguageButton } from '@/shared/ui/language-switch';
import { AppSidebar, SidebarProvider, SidebarToggle, type SidebarGroup } from '@/shared/ui/app-sidebar';
import { Skeleton } from '@/shared/ui/states';
import { t } from '@/i18n';
import { CreateMenu } from '@/features/shell/CreateMenu';

interface ClinicNav {
  to: string;
  label: string;
  icon: LucideIcon;
  group: 'work' | 'admin';
  action?: Action;
}

const NAV: ClinicNav[] = [
  { to: '/clinic', get label() { return t('clinic.nav.home'); }, icon: House, group: 'work' },
  { to: '/clinic/check', get label() { return t('clinic.nav.check'); }, icon: ScanLine, group: 'work' },
  { to: '/clinic/appointments', get label() { return t('clinic.nav.appointments'); }, icon: CalendarClock, group: 'work' },
  { to: '/clinic/guarantees', get label() { return t('clinic.nav.guarantees'); }, icon: FileCheck, group: 'work' },
  { to: '/clinic/registries', get label() { return t('clinic.nav.registries'); }, icon: ClipboardList, group: 'work', action: 'registries.submit' },
  { to: '/clinic/documents', get label() { return t('common.documents'); }, icon: FolderOpen, group: 'work' },
  { to: '/clinic/users', get label() { return t('clinic.nav.users'); }, icon: Users, group: 'admin', action: 'clinic.users.manage' },
  { to: '/clinic/integration', get label() { return t('clinic.nav.integration'); }, icon: PlugZap, group: 'admin', action: 'clinic.integration.manage' },
];

export default function ClinicLayout() {
  const user = useUser();
  const loc = useLocation();
  const overview = useClinicOverview();
  const clinicName = overview.data?.clinicName;
  const allowed = NAV.filter((n) => can(user, n.action ?? 'clinic.check_patient'));
  const current = allowed.filter((n) => (n.to === '/clinic' ? loc.pathname === '/clinic' : loc.pathname === n.to || loc.pathname.startsWith(`${n.to}/`))).sort((a, b) => b.to.length - a.to.length)[0]?.to;
  const toItem = (n: ClinicNav) => ({ path: n.to, label: n.label, icon: n.icon });
  const groups: SidebarGroup[] = [
    { items: allowed.filter((n) => n.group === 'work').map(toItem) },
    { label: t('clinic.nav.admin'), items: allowed.filter((n) => n.group === 'admin').map(toItem) },
  ].filter((g) => g.items.length > 0);

  return (
    <SidebarProvider portal="clinic">
      <div className="portal-shell flex h-[calc(100dvh-var(--banner-h,0px))] overflow-hidden">
        <AppSidebar
          title={t('shell.title.clinic')}
          ariaLabel={t('clinic.nav.aria')}
          groups={groups}
          activePath={current}
          user={{ name: user?.displayName ?? '', role: user ? ROLE_LABEL[user.role] : t('shell.portal.clinic'), portal: clinicName ? t('clinic.layout.portalNamed', { name: clinicName }) : t('shell.portal.clinic') }}
          onLogout={() => void logout()}
        />
        <div data-theme="client" className="flex min-h-0 min-w-0 flex-1 flex-col bg-bg text-text">
          <IdleWatcher />
          <header data-testid="topbar" className="relative z-30 flex h-(--topbar-h) shrink-0 items-center gap-3 border-b border-border bg-surface px-4">
            <SidebarToggle />
            <div className="min-w-0 leading-tight">
              <p className="text-[12px] text-muted">{t('shell.portal.clinic')}</p>
              {clinicName ? (
                <div className="flex min-w-0 items-center gap-1.5">
                  <p className="truncate font-heading text-[15px] font-semibold" data-testid="clinic-name">
                    {clinicName}
                  </p>
                  <LegalFormChip code={overview.data?.clinicLegalForm} />
                </div>
              ) : (
                <Skeleton className="mt-1 h-4 w-40" />
              )}
            </div>
            <LanguageButton className="ml-auto" />
            <CreateMenu />
          </header>
          <ContentScroll className="mx-auto w-full max-w-[1440px] px-4 py-6 md:px-8">
            <Outlet />
          </ContentScroll>
        </div>
      </div>
    </SidebarProvider>
  );
}
