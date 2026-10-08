import { t } from '@/i18n';
import { WifiOff } from 'lucide-react';
import { useOnline } from '@/shared/lib/hooks';

export function OfflineBanner() {
  const online = useOnline();
  if (online) return null;
  return (
    <div role="alert" className="flex items-center justify-center gap-2 bg-danger px-3 py-1.5 text-[13px] text-white">
      <WifiOff className="h-4 w-4" aria-hidden />
      {t('shell.offline')}
    </div>
  );
}
