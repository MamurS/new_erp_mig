/* Sub-registries of clinics for this assistance (§5.3): only the lines it pays for. */
import { useNavigate } from 'react-router-dom';
import type { SubRegistrySummary } from '@/shared/types/dto';
import { useAssistRegistries } from '@/shared/api/queries/assist';
import { REGISTRY_STATUS_CHIP, REGISTRY_STATUS_LABEL } from '@/shared/domain/clinics';
import { formatDate, formatMoney } from '@/shared/lib/format';
import { useDocumentTitle } from '@/shared/lib/hooks';
import { Chip } from '@/shared/ui/chips';
import { legalFormColumn } from '@/shared/ui/legal-form';
import { DataTable, type Column } from '@/shared/ui/data-table';
import { PageHeader } from '@/shared/ui/page';
import { EmptyState } from '@/shared/ui/states';
import { roleName } from '@/features/next/NextActions';
import { EmptyHelp } from '@/features/clinic/emptyNext';
import { useTopbar } from '@/features/staff/topbar';
import { SlaBadge } from '../components';
import { t } from '@/i18n';

const SOURCE_LABEL = { get portal() { return t('assist.registries.source.portal'); }, csv: 'CSV', api: 'API' } as const;

export default function RegistriesPage() {
  useDocumentTitle(t('assist.nav.registries'));
  useTopbar([{ label: t('assist.nav.registries') }]);
  const navigate = useNavigate();
  const q = useAssistRegistries();
  const columns: Column<SubRegistrySummary>[] = [
    { key: 'clinic', header: t('common.clinic'), cell: (r) => <span className="font-medium">{r.clinicName}</span> },
    legalFormColumn<SubRegistrySummary>((r) => r.clinicLegalForm),
    { key: 'period', header: t('common.period'), cell: (r) => <span className="num">{r.period}</span> },
    { key: 'source', header: t('common.source'), cell: (r) => SOURCE_LABEL[r.source] },
    { key: 'sent', header: t('assist.registries.received'), cell: (r) => (r.submittedAt ? <span className="num">{formatDate(r.submittedAt)}</span> : '—') },
    { key: 'lines', header: t('assist.registries.lines'), align: 'right', cell: (r) => <span className="num">{r.lineCount}</span> },
    { key: 'todo', header: t('assist.registries.toReview'), align: 'right', cell: (r) => <span className={r.pendingCount + r.disputedCount ? 'num font-semibold text-warning-text' : 'num text-muted'}>{r.pendingCount + r.disputedCount}</span> },
    { key: 'unpaid', header: t('assist.registries.unpaid'), align: 'right', cell: (r) => <span className={r.unpaidCount ? 'num font-semibold' : 'num text-muted'}>{r.unpaidCount}</span> },
    { key: 'claimed', header: t('assist.registry.claimed'), align: 'right', cell: (r) => <span className="num whitespace-nowrap">{formatMoney(r.totals.claimed)}</span> },
    { key: 'paid', header: t('assist.registries.paid'), align: 'right', cell: (r) => <span className="num whitespace-nowrap">{formatMoney(r.totals.paid)}</span> },
    { key: 'sla', header: t('assist.registries.reviewBy'), cell: (r) => (r.reviewDueAt ? <SlaBadge dueAt={r.reviewDueAt} done={r.pendingCount + r.disputedCount === 0} /> : '—') },
    { key: 'status', header: t('common.status'), cell: (r) => <Chip kind={REGISTRY_STATUS_CHIP[r.status]}>{REGISTRY_STATUS_LABEL[r.status]}</Chip> },
  ];
  return (
    <>
      <PageHeader title={t('assist.nav.registries')} subtitle={t('assist.registries.subtitle')} />
      <div className="rounded-card border border-border bg-surface">
        <DataTable
          caption={t('assist.registries.caption')}
          columns={columns}
          rows={q.data}
          loading={q.isLoading}
          error={q.error}
          onRetry={() => void q.refetch()}
          rowKey={(r) => r.id}
          onRowClick={(r) => navigate(`/assist/registries/${r.id}`)}
          onRowOpen={(r) => navigate(`/assist/registries/${r.id}`)}
          empty={
            <EmptyState
              testId="assist-registries-empty"
              title={t('assist.registries.empty')}
              why={t('emptyPartner.assist.registries.why')}
              next={t('emptyPartner.assist.registries.next', { role: roleName('clinic_admin'), checker: roleName('asst_billing') })}
              help={<EmptyHelp article="clinics" section="monthly-registry" contact />}
            />
          }
        />
      </div>
    </>
  );
}
