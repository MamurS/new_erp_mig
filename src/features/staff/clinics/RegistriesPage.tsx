/* Clinic registries for MIG (CLINIC_SPEC §5): operator reviews, accountant pays. */
import { useNavigate } from 'react-router-dom';
import type { RegistrySummary } from '@/shared/types/dto';
import { useStaffRegistries } from '@/shared/api/queries/clinic';
import { REGISTRY_STATUS_CHIP, REGISTRY_STATUS_LABEL } from '@/shared/domain/clinics';
import { t } from '@/i18n';
import { formatDateTime, formatMoney } from '@/shared/lib/format';
import { useDocumentTitle, useUrlFilters } from '@/shared/lib/hooks';
import { Chip } from '@/shared/ui/chips';
import { legalFormColumn } from '@/shared/ui/legal-form';
import { DataTable, type Column } from '@/shared/ui/data-table';
import { EmptyState } from '@/shared/ui/states';
import { Tabs, TabsList, TabsTrigger } from '@/shared/ui/tabs';
import { useTopbar } from '../topbar';

const TAB_KEYS = ['submitted,in_review', 'accepted,partially_accepted', 'paid', 'all'] as const;
const tabs = (): [string, string][] => [
  ['submitted,in_review', t('staffOps.registries.tab.review')],
  ['accepted,partially_accepted', t('staffOps.registries.tab.toPay')],
  ['paid', t('staffOps.registries.tab.paid')],
  ['all', t('common.all')],
];
const sourceLabel = (s: RegistrySummary['source']): string => (s === 'portal' ? t('staffOps.registries.source.portal') : s === 'csv' ? 'CSV' : 'API');

export default function RegistriesPage() {
  useDocumentTitle(t('staffOps.registries.title'));
  useTopbar([{ label: t('staffOps.registries.title') }]);
  const navigate = useNavigate();
  const [f, setF] = useUrlFilters(['status', 'clinicId'] as const);
  const status = TAB_KEYS.some((k) => k === f.status) ? f.status : 'submitted,in_review';
  const list = useStaffRegistries({ ...(status === 'all' ? {} : { status }), ...(f.clinicId ? { clinicId: f.clinicId } : {}) });
  const cols: Column<RegistrySummary>[] = [
    { key: 'clinic', header: t('common.clinic'), cell: (r) => <span className="font-medium">{r.clinicName}</span> },
    legalFormColumn<RegistrySummary>((r) => r.clinicLegalForm),
    { key: 'period', header: t('common.period'), cell: (r) => <span className="num">{r.period}</span> },
    { key: 'source', header: t('common.source'), cell: (r) => <Chip kind={r.source === 'api' ? 'sky' : 'neutral'}>{sourceLabel(r.source)}</Chip> },
    { key: 'sent', header: t('staffOps.registries.col.sent'), cell: (r) => <span className="num text-muted">{r.submittedAt ? formatDateTime(r.submittedAt) : '—'}</span> },
    {
      key: 'lines',
      header: t('staffOps.registries.col.lines'),
      align: 'right',
      cell: (r) => (
        <span className="num">
          {r.lineCount}
          {r.pendingCount > 0 && <span className="text-muted">{t('staffOps.registries.pending', { n: r.pendingCount })}</span>}
          {r.disputedCount > 0 && <span className="text-warning-text">{t('staffOps.registries.disputed', { n: r.disputedCount })}</span>}
        </span>
      ),
    },
    { key: 'claimed', header: t('staffOps.registries.claimed'), align: 'right', cell: (r) => <span className="num whitespace-nowrap">{formatMoney(r.totals.claimed)}</span> },
    { key: 'accepted', header: t('staffOps.registries.accepted'), align: 'right', cell: (r) => <span className="num whitespace-nowrap">{formatMoney(r.totals.accepted)}</span> },
    { key: 'status', header: t('common.status'), cell: (r) => <Chip kind={REGISTRY_STATUS_CHIP[r.status]}>{REGISTRY_STATUS_LABEL[r.status]}</Chip> },
  ];
  return (
    <div>
      <h1 className="mb-3 text-[22px] font-bold">{t('staffOps.registries.title')}</h1>
      <Tabs value={status} onValueChange={(v) => setF({ status: v === 'submitted,in_review' ? null : v })}>
        <TabsList>
          {tabs().map(([k, label]) => (
            <TabsTrigger key={k} value={k}>
              {label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <div className="mt-3 rounded-card border border-border bg-surface">
        <DataTable
          caption={t('staffOps.registries.title')}
          columns={cols}
          rows={list.data}
          rowKey={(r) => r.id}
          onRowClick={(r) => navigate(`/staff/registries/${r.id}`)}
          loading={list.isLoading}
          error={list.error}
          onRetry={() => void list.refetch()}
          empty={<EmptyState title={t('staffOps.registries.empty')} />}
        />
      </div>
    </div>
  );
}
