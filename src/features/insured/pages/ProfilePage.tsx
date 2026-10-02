import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, FileBadge, LogOut, MonitorSmartphone } from 'lucide-react';
import { useI18n } from '@/i18n';
import { useMe } from '@/shared/api/queries/me';
import { logout } from '@/shared/auth/logout';
import { formatDate } from '@/shared/lib/format';
import { useDocumentTitle } from '@/shared/lib/hooks';
import { Button } from '@/shared/ui/button';
import { Skeleton } from '@/shared/ui/states';
import { BIG, LangSwitch, LoadError, ScreenHeader, Section } from '../components';

export default function ProfilePage() {
  const { t } = useI18n();
  useDocumentTitle(t('profile.title'));
  const me = useMe();
  const [busy, setBusy] = useState<'one' | 'all' | null>(null);

  const doLogout = async (kind: 'one' | 'all') => {
    setBusy(kind);
    // In the prototype «all devices» ends the current session the same way.
    await logout();
  };

  const rows: [string, string | undefined, boolean?][] = me.data
    ? [
        [t('profile.fullName'), me.data.fullName],
        [t('profile.company'), me.data.companyName],
        [t('profile.phone'), me.data.phoneMasked, true],
        [t('profile.pinfl'), me.data.pinflMasked, true],
        [t('profile.card'), me.data.payoutCardMasked, true],
      ]
    : [];

  return (
    <div>
      <ScreenHeader title={t('profile.title')} />
      {me.isLoading ? (
        <Skeleton className="h-[290px] w-full rounded-card" />
      ) : me.isError || !me.data ? (
        <LoadError error={me.error} onRetry={() => void me.refetch()} />
      ) : (
        <dl className="divide-y divide-border-soft rounded-card border border-border bg-surface px-4">
          {rows.map(([label, value, mono]) => (
            <div key={label} className="flex items-center justify-between gap-3 py-3">
              <dt className="text-muted">{label}</dt>
              <dd className={mono ? 'num text-[14px] font-bold' : 'text-right font-bold'}>{value}</dd>
            </div>
          ))}
          <div className="flex items-center justify-between gap-3 py-3">
            <dt className="text-muted">{t('profile.consent')}</dt>
            <dd className="text-right font-bold">
              {me.data.consentGivenAt ? t('profile.consentGiven', { date: formatDate(me.data.consentGivenAt) }) : t('profile.consentMissing')}
            </dd>
          </div>
        </dl>
      )}

      <Link to="/app/certificate" className="mt-4 flex min-h-[54px] items-center gap-3 rounded-card border border-border bg-surface px-4 font-bold hover:bg-rail">
        <FileBadge className="h-5 w-5 text-accent" aria-hidden />
        <span className="flex-1">{t('profile.certificate')}</span>
        <ChevronRight className="h-5 w-5 text-muted" aria-hidden />
      </Link>

      <Section title={t('lang.label')}>
        <LangSwitch />
      </Section>

      <div className="mt-8 flex flex-col gap-3">
        <Button variant="secondary" loading={busy === 'one'} disabled={busy !== null} onClick={() => void doLogout('one')} className={BIG}>
          <LogOut className="h-5 w-5" aria-hidden />
          {t('profile.logout')}
        </Button>
        <Button variant="ghost" loading={busy === 'all'} disabled={busy !== null} onClick={() => void doLogout('all')} className={`${BIG} text-danger-text`}>
          <MonitorSmartphone className="h-5 w-5" aria-hidden />
          {t('profile.logoutAll')}
        </Button>
      </div>
    </div>
  );
}
