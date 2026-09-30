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

export default function VisitPage() {
  useDocumentTitle('Визит');
  const { visitId = '' } = useParams();
  const coverage = useVisitCoverage(visitId);
  const guarantees = useClinicGuarantees();
  const canRequestGp = useCan('guarantees.request');
  const [gpOpen, setGpOpen] = useState(false);

  if (coverage.isLoading) return <SkeletonRows rows={6} />;
  if (coverage.isError || !coverage.data)
    return (
      <EmptyState
        title="Визит закрыт или не найден"
        description="Визит действует 24 часа после проверки. Проверьте пациента заново"
        action={
          <Button asChild>
            <Link to="/clinic/check">Проверить пациента</Link>
          </Button>
        }
      />
    );
  const mine = (guarantees.data ?? []).filter((g) => g.visitId === visitId);
  return (
    <>
      <PageTitle title="Визит" subtitle={<Link to="/clinic/check" className="text-accent-text hover:underline">← Проверка пациента</Link>} />
      <CoverageCard result={coverage.data} actions={canRequestGp ? <Button onClick={() => setGpOpen(true)}>Запросить гарантийное письмо</Button> : undefined} />
      <Panel title="Гарантийные письма по визиту" className="mt-4">
        {guarantees.isError ? (
          <ErrorState error={guarantees.error} onRetry={() => void guarantees.refetch()} />
        ) : mine.length === 0 ? (
          <p className="p-4 text-muted">По этому визиту писем ещё нет</p>
        ) : (
          <ul className="divide-y divide-border-soft">
            {mine.map((g) => (
              <li key={g.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
                <span>
                  <span className="font-semibold num">{g.number}</span> · {g.serviceName} · {formatMoney(g.approvedAmount ?? g.estimatedCost)}
                  {g.validUntil && <span className="text-muted"> · до {formatDate(g.validUntil)}</span>}
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
