import { ContentScroll } from '@/shared/ui/content-scroll';
import { LegalFormChip } from '@/shared/ui/legal-form';
import { Outlet, useLocation } from 'react-router-dom';
import { BarChart3, BookOpen, FileSignature, Inbox, ReceiptText, Users, UsersRound } from 'lucide-react';
import { useUser } from '@/shared/auth/session';
import { logout } from '@/shared/auth/logout';
import { IdleWatcher } from '@/shared/auth/IdleWatcher';
import { ROLE_LABEL } from '@/shared/domain/labels';
import { useHrFamilyRequests, useHrOverview } from '@/shared/api/queries/hr';
import { CreateMenu } from '@/features/shell/CreateMenu';
import { HelpContextButton } from '@/features/help/HelpContextButton';
import { NotificationsBell } from '@/features/next/NotificationsBell';
import { LanguageButton } from '@/shared/ui/language-switch';
import { AppSidebar, SidebarProvider, SidebarToggle, type SidebarGroup } from '@/shared/ui/app-sidebar';
import { Skeleton } from '@/shared/ui/states';
import { t } from '@/i18n';

const NAV = [
  { path: '/hr', get label() { return t('hr.nav.employees'); }, icon: Users },
  { path: '/hr/family', get label() { return t('hr.nav.family'); }, icon: UsersRound },
  { path: '/hr/family/requests', get label() { return t('hr.nav.familyRequests'); }, icon: Inbox },
  { path: '/hr/documents', get label() { return t('hr.nav.documents'); }, icon: ReceiptText },
  { path: '/hr/contracts', get label() { return t('hr.nav.contracts'); }, icon: FileSignature },
  { path: '/hr/stats', get label() { return t('hr.nav.stats'); }, icon: BarChart3 },
];

/** HR cabinet shell: the common side panel, client theme for the content up to 1440px (SPEC §7.2). */
export default function HrLayout() {
  const user = useUser();
  const loc = useLocation();
  const overview = useHrOverview();
  // Requests of employees from the app waiting for HR: the counter of «Заявки из приложения».
  const familyRequests = useHrFamilyRequests('pending');
  const pendingRequests = familyRequests.data?.length ?? 0;
  const company = overview.data?.companyName;
  // «Сотрудники» covers the employee pages under /hr/employees too.
  const current =
    NAV.filter((n) => n.path !== '/hr' && (loc.pathname === n.path || loc.pathname.startsWith(`${n.path}/`))).sort((a, b) => b.path.length - a.path.length)[0]?.path ??
    (loc.pathname === '/hr' || loc.pathname.startsWith('/hr/employees') ? '/hr' : undefined);
  const nav = NAV.map((n) => (n.path === '/hr/family/requests' ? { path: n.path, label: n.label, icon: n.icon, count: pendingRequests } : n));
  const groups: SidebarGroup[] = [{ items: nav }];

  return (
    <SidebarProvider portal="hr">
      <div className="portal-shell flex h-[calc(100dvh-var(--banner-h,0px))] overflow-hidden">
        <AppSidebar
          title={t('shell.title.hr')}
          ariaLabel={t('hr.nav.aria')}
          groups={groups}
          activePath={current}
          user={{ name: user?.displayName ?? '', role: user ? ROLE_LABEL[user.role] : 'HR', portal: company ? t('hr.layout.portalNamed', { name: company }) : t('shell.portal.hr') }}
          onLogout={() => void logout()}
          footer={[{ path: '/hr/help', label: t('help.nav'), icon: BookOpen }]}
        />
        <div data-theme="client" className="flex min-h-0 min-w-0 flex-1 flex-col bg-bg text-text">
          <IdleWatcher />
          <header data-testid="topbar" className="relative z-30 flex h-(--topbar-h) shrink-0 items-center gap-3 border-b border-border bg-surface px-4">
            <SidebarToggle />
            <div className="min-w-0 leading-tight">
              <p className="text-[12px] text-muted">{t('shell.portal.hr')}</p>
              {company ? (
                <div className="flex min-w-0 items-center gap-1.5">
                  <p className="truncate font-heading text-[15px] font-semibold" data-testid="hr-company">
                    {company}
                  </p>
                  <LegalFormChip code={overview.data?.companyLegalForm} />
                </div>
              ) : (
                <Skeleton className="mt-1 h-4 w-40" />
              )}
            </div>
            <HelpContextButton className="ml-auto" />
            <NotificationsBell />
            <LanguageButton />
            <CreateMenu />
          </header>
          <ContentScroll className="mx-auto w-full max-w-[1440px] px-4 py-6 md:px-8 md:py-8">
            <Outlet />
          </ContentScroll>
        </div>
      </div>
    </SidebarProvider>
  );
}
