/* An open visit: coverage and the guarantee letters requested within it. */
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useClinicGuarantees, useVisitCoverage } from '@/shared/api/queries/clinic';
import { useCan } from '@/shared/auth/guards';
import { formatDate, formatMoney } from '@/shared/lib/format';
import { useDocumentTitle } from '@/shared/lib/hooks';
import { Button } from '@/shared/ui/button';
import { EmptyState, ErrorState, SkeletonRows } from '@/shared/ui/states';
import { CoverageCard, GuaranteeChip, GuaranteeRequestDialog, PageTitle, Panel } from '../components';
import { t } from '@/i18n';

export default function VisitPage() {
  useDocumentTitle(t('clinic.visit.title'));
  const { visitId = '' } = useParams();
  const coverage = useVisitCoverage(visitId);
  const guarantees = useClinicGuarantees();
  const canRequestGp = useCan('guarantees.request');
  const [gpOpen, setGpOpen] = useState(false);

  if (coverage.isLoading) return <SkeletonRows rows={6} />;
  if (coverage.isError || !coverage.data)
    return (
      <EmptyState
        title={t('clinic.visit.notFound')}
        description={t('clinic.visit.notFoundHint')}
        action={
          <Button asChild>
            <Link to="/clinic/check">{t('clinic.home.checkPatient')}</Link>
          </Button>
        }
      />
    );
  const mine = (guarantees.data ?? []).filter((g) => g.visitId === visitId);
  return (
    <>
      <PageTitle title={t('clinic.visit.title')} subtitle={<Link to="/clinic/check" className="text-accent-text hover:underline">{t('clinic.visit.back')}</Link>} />
      <CoverageCard result={coverage.data} actions={canRequestGp ? <Button onClick={() => setGpOpen(true)}>{t('clinic.gpRequest.title')}</Button> : undefined} />
      <Panel title={t('clinic.visit.guarantees')} className="mt-4">
        {guarantees.isError ? (
          <ErrorState error={guarantees.error} onRetry={() => void guarantees.refetch()} />
        ) : mine.length === 0 ? (
          <p className="p-4 text-muted">{t('clinic.visit.noGuarantees')}</p>
        ) : (
          <ul className="divide-y divide-border-soft">
            {mine.map((g) => (
              <li key={g.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
                <span>
                  <span className="font-semibold num">{g.number}</span> · {g.serviceName} · {formatMoney(g.approvedAmount ?? g.estimatedCost)}
                  {g.validUntil && <span className="text-muted">{t('clinic.visit.until', { date: formatDate(g.validUntil) })}</span>}
                </span>
                <GuaranteeChip status={g.status} />
              </li>
            ))}
          </ul>
        )}
      </Panel>
      <GuaranteeRequestDialog visitId={visitId} open={gpOpen} onOpenChange={setGpOpen} />
    </>
  );
}
