import { Outlet, useLocation } from 'react-router-dom';
import { BarChart3, CircleHelp, FileSignature, ReceiptText, Users } from 'lucide-react';
import { useUser } from '@/shared/auth/session';
import { logout } from '@/shared/auth/logout';
import { IdleWatcher } from '@/shared/auth/IdleWatcher';
import { ROLE_LABEL } from '@/shared/domain/labels';
import { useHrOverview } from '@/shared/api/queries/hr';
import { AppSidebar, SidebarProvider, SidebarToggle, type SidebarGroup } from '@/shared/ui/app-sidebar';
import { Skeleton } from '@/shared/ui/states';

const NAV = [
  { path: '/hr', label: 'Сотрудники', icon: Users },
  { path: '/hr/documents', label: 'Счета и документы', icon: ReceiptText },
  { path: '/hr/contracts', label: 'Договор и изменения', icon: FileSignature },
  { path: '/hr/stats', label: 'Статистика', icon: BarChart3 },
];
const HELP = [{ path: '/hr/help', label: 'Помощь', icon: CircleHelp }];

/** HR cabinet shell: the common side panel, client theme for the content up to 1440px (SPEC §7.2). */
export default function HrLayout() {
  const user = useUser();
  const loc = useLocation();
  const overview = useHrOverview();
  const company = overview.data?.companyName;
  const all = [...NAV, ...HELP];
  // «Сотрудники» covers the employee pages under /hr/employees too.
  const current =
    all.filter((n) => n.path !== '/hr' && (loc.pathname === n.path || loc.pathname.startsWith(`${n.path}/`))).sort((a, b) => b.path.length - a.path.length)[0]?.path ??
    (loc.pathname === '/hr' || loc.pathname.startsWith('/hr/employees') ? '/hr' : undefined);
  const groups: SidebarGroup[] = [{ items: NAV }, { label: 'Поддержка', items: HELP }];

  return (
    <SidebarProvider portal="hr">
      <div className="flex" style={{ minHeight: 'calc(100vh - var(--banner-h, 0px))' }}>
        <AppSidebar
          title="MIG · Компания"
          ariaLabel="Разделы кабинета"
          groups={groups}
          activePath={current}
          user={{ name: user?.displayName ?? '', role: user ? ROLE_LABEL[user.role] : 'HR', portal: company ? `Кабинет HR · ${company}` : 'Кабинет HR' }}
          onLogout={() => void logout()}
        />
        <div data-theme="client" className="flex min-w-0 flex-1 flex-col bg-bg text-text">
          <IdleWatcher />
          <header className="sticky top-(--banner-h,0px) z-30 flex h-[52px] shrink-0 items-center gap-3 border-b border-border bg-surface px-4">
            <SidebarToggle />
            <div className="min-w-0 leading-tight">
              <p className="text-[12px] text-muted">Кабинет HR</p>
              {company ? (
                <p className="truncate font-heading text-[15px] font-semibold" data-testid="hr-company">
                  {company}
                </p>
              ) : (
                <Skeleton className="mt-1 h-4 w-40" />
              )}
            </div>
          </header>
          <main className="mx-auto w-full max-w-[1440px] flex-1 px-4 py-6 md:px-8 md:py-8">
            <Outlet />
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
