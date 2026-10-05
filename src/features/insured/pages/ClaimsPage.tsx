import { Link } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { useI18n } from '@/i18n';
import { useMyClaims } from '@/shared/api/queries/me';
import { formatDate, formatMoney } from '@/shared/lib/format';
import { useDocumentTitle } from '@/shared/lib/hooks';
import { Button } from '@/shared/ui/button';
import { BIG, CardSkeletons, ClaimStepBar, Empty, LoadError, ScreenHeader, StatusPill } from '../components';

export default function ClaimsPage() {
  const { t } = useI18n();
  useDocumentTitle(t('app.claims.title'));
  const q = useMyClaims();

  return (
    <div>
      <ScreenHeader title={t('app.claims.title')} />
      <Button asChild className={BIG}>
        <Link to="/app/claims/new">
          <Plus className="h-5 w-5" aria-hidden />
          {t('app.claims.new')}
        </Link>
      </Button>
      <div className="mt-5">
        {q.isLoading ? (
          <CardSkeletons />
        ) : q.isError ? (
          <LoadError error={q.error} onRetry={() => void q.refetch()} />
        ) : !q.data || q.data.length === 0 ? (
          <Empty
            title={t('app.claims.empty')}
            action={
              <Button asChild variant="secondary" className={BIG}>
                <Link to="/app/claims/new">{t('app.claims.new')}</Link>
              </Button>
            }
          />
        ) : (
          <ul className="flex flex-col gap-3">
            {q.data.map((c) => (
              <li key={c.id}>
                <Link to={`/app/claims/${c.id}`} className="block rounded-card border border-border bg-surface p-4 hover:border-accent">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-bold">{c.providerName}</p>
                      <p className="text-[13px] text-muted">
                        {t(`app.claimCat.${c.category}`)} · {formatDate(c.serviceDate)}
                      </p>
                    </div>
                    <StatusPill status={c.status} />
                  </div>
                  <p className="mt-2 font-heading text-[20px] font-semibold">{formatMoney(c.amountClaimed)}</p>
                  <ClaimStepBar claim={c} className="mt-3" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
