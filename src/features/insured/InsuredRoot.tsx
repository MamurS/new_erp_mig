import { useEffect } from 'react';
import { Outlet } from 'react-router-dom';
import { WifiOff } from 'lucide-react';
import { I18nProvider, useI18n } from '@/i18n';
import { useOnline } from '@/shared/lib/hooks';

function OfflineNote() {
  const online = useOnline();
  const { t } = useI18n();
  if (online) return null;
  return (
    <div role="status" className="flex items-center justify-center gap-2 bg-peach px-4 py-2 text-[14px] font-semibold text-peach-text">
      <WifiOff className="h-4 w-4" aria-hidden />
      {t('offline')}
    </div>
  );
}

/**
 * Root of /app: i18n, the client theme and the mobile column (360–430 px; centred 430 px on wide screens).
 * The theme is also put on <html> while /app is mounted so that portalled modals get client tokens.
 */
export default function InsuredRoot() {
  useEffect(() => {
    const root = document.documentElement;
    const prev = root.getAttribute('data-theme');
    root.setAttribute('data-theme', 'client');
    return () => {
      if (prev === null) root.removeAttribute('data-theme');
      else root.setAttribute('data-theme', prev);
    };
  }, []);

  return (
    <I18nProvider>
      <div data-theme="client" className="min-h-[calc(100vh-var(--banner-h,0px))] bg-bg">
        <div className="relative mx-auto flex min-h-[calc(100vh-var(--banner-h,0px))] w-full max-w-[430px] flex-col bg-bg md:border-x md:border-border-soft">
          <OfflineNote />
          <Outlet />
        </div>
      </div>
    </I18nProvider>
  );
}
