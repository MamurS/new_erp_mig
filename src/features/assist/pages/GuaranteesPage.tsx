/* Guarantee letters of the assistance's insured (§5.2): the doctor decides within authority or escalates to MIG. */
import { useNavigate } from 'react-router-dom';
import type { GuaranteeView } from '@/shared/types/dto';
import { useAssistGuarantees } from '@/shared/api/queries/assist';
import { GUARANTEE_STATUS_CHIP, GUARANTEE_STATUS_LABEL } from '@/shared/domain/clinics';
import { formatDateTime, formatMoney } from '@/shared/lib/format';
import { useDocumentTitle, useUrlFilters } from '@/shared/lib/hooks';
import { Chip } from '@/shared/ui/chips';
import { DataTable, type Column } from '@/shared/ui/data-table';
import { PageHeader } from '@/shared/ui/page';
import { Tabs, TabsList, TabsTrigger } from '@/shared/ui/tabs';
import { useTopbar } from '@/features/staff/topbar';
import { SlaBadge } from '../components';
import { t, type I18nKey } from '@/i18n';

const TABS: [string, I18nKey][] = [
  ['requested', 'assist.guarantees.tab.requested'],
  ['info_requested', 'assist.guarantees.tab.info'],
  ['approved,used', 'assist.guarantees.tab.approved'],
  ['rejected,expired', 'assist.guarantees.tab.closed'],
  ['all', 'common.all'],
];

export default function GuaranteesPage() {
  useDocumentTitle(t('assist.nav.guarantees'));
  useTopbar([{ label: t('assist.nav.guarantees') }]);
  const navigate = useNavigate();
  const [f, setF] = useUrlFilters(['status'] as const);
  const status = TABS.some(([k]) => k === f.status) ? f.status! : 'requested';
  const q = useAssistGuarantees(status === 'all' ? '' : status);
  const columns: Column<GuaranteeView>[] = [
    { key: 'num', header: t('common.number'), cell: (g) => <span className="num font-medium">{g.number}</span> },
    { key: 'created', header: t('assist.guarantee.requested'), cell: (g) => <span className="num text-muted">{formatDateTime(g.createdAt)}</span> },
    { key: 'clinic', header: t('common.clinic'), cell: (g) => g.clinicName },
    { key: 'patient', header: t('common.patient'), cell: (g) => g.insuredName },
    { key: 'service', header: t('common.service'), cell: (g) => <span className="line-clamp-1">{g.serviceName}</span> },
    { key: 'cost', header: t('common.amount'), align: 'right', cell: (g) => <span className="num whitespace-nowrap">{formatMoney(g.approvedAmount ?? g.estimatedCost)}</span> },
    {
      key: 'status',
      header: t('common.status'),
      cell: (g) => (
        <span className="flex flex-wrap items-center gap-1">
          <Chip kind={GUARANTEE_STATUS_CHIP[g.status]}>{GUARANTEE_STATUS_LABEL[g.status]}</Chip>
          {g.escalated && <Chip kind="warning">{g.status === 'requested' ? t('assist.guarantees.atMig') : g.decidedBy === 'mig' ? t('assist.guarantees.decidedByMig') : t('assist.guarantees.decidedByAssist')}</Chip>}
        </span>
      ),
    },
    { key: 'sla', header: 'SLA', cell: (g) => <SlaBadge dueAt={new Date(Date.parse(g.createdAt) + 24 * 3600_000).toISOString()} done={g.status !== 'requested' || !!g.escalated} /> },
  ];
  return (
    <>
      <PageHeader title={t('assist.nav.guarantees')} subtitle={t('assist.guarantees.subtitle')} />
      <Tabs value={status} onValueChange={(v) => setF({ status: v === 'requested' ? null : v })}>
        <TabsList>
          {TABS.map(([k, label]) => (
            <TabsTrigger key={k} value={k}>
              {t(label)}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <div className="mt-3 rounded-card border border-border bg-surface">
        <DataTable
          caption={t('assist.nav.guarantees')}
          columns={columns}
          rows={q.data}
          loading={q.isLoading}
          error={q.error}
          onRetry={() => void q.refetch()}
          rowKey={(g) => g.id}
          onRowClick={(g) => navigate(`/assist/guarantees/${g.id}`)}
          onRowOpen={(g) => navigate(`/assist/guarantees/${g.id}`)}
          empty={t('assist.guarantees.empty')}
        />
      </div>
    </>
  );
}
