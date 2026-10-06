import { NavLink, Outlet } from 'react-router-dom';
import { Building2, House, Receipt, User, type LucideIcon } from 'lucide-react';
import { useI18n, type I18nKey } from '@/i18n';
import { IdleWatcher } from '@/shared/auth/IdleWatcher';
import { cn } from '@/shared/lib/cn';
import { useSession } from '@/shared/auth/session';
import { PersonProvider } from './person';

const TABS: { to: string; label: I18nKey; icon: LucideIcon; end?: boolean }[] = [
  { to: '/app', label: 'app.nav.home', icon: House, end: true },
  { to: '/app/claims', label: 'app.nav.claims', icon: Receipt },
  { to: '/app/clinics', label: 'app.nav.clinics', icon: Building2 },
  { to: '/app/profile', label: 'app.nav.profile', icon: User },
];

/** Authenticated layout: content + bottom tab bar fixed to the mobile column; the picked person of the family lives here. */
export default function AppLayout() {
  const { t } = useI18n();
  // Another person signed in (the demo switcher keeps the layout mounted): start over with a fresh choice.
  const userId = useSession()?.user.id;
  return (
    <PersonProvider key={userId}>
      <main className="flex-1 px-4 pb-28 pt-5">
        <Outlet />
      </main>
      <nav
        aria-label={t('app.nav.label')}
        className="fixed bottom-0 left-1/2 z-30 w-full max-w-[430px] -translate-x-1/2 border-t border-border bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-sm"
      >
        <ul className="grid grid-cols-4">
          {TABS.map(({ to, label, icon: Icon, end }) => (
            <li key={to}>
              <NavLink
                to={to}
                end={end}
                className={({ isActive }) =>
                  cn(
                    'flex min-h-[60px] flex-col items-center justify-center gap-0.5 text-[12px] font-semibold',
                    isActive ? 'text-accent' : 'text-muted hover:text-text',
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    <span className={cn('flex h-8 w-12 items-center justify-center rounded-full', isActive && 'bg-accent-soft')}>
                      <Icon className="h-5 w-5" aria-hidden />
                    </span>
                    {t(label)}
                  </>
                )}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
      <IdleWatcher />
    </PersonProvider>
  );
}
