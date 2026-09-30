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

const TABS: [string, string][] = [
  ['requested', 'Ждут решения'],
  ['info_requested', 'Ждут документы'],
  ['approved,used', 'Одобрены'],
  ['rejected,expired', 'Отклонены и истекли'],
  ['all', 'Все'],
];

export default function GuaranteesPage() {
  useDocumentTitle('Гарантийные письма');
  useTopbar([{ label: 'Гарантийные письма' }]);
  const navigate = useNavigate();
  const [f, setF] = useUrlFilters(['status'] as const);
  const status = TABS.some(([k]) => k === f.status) ? f.status! : 'requested';
  const q = useAssistGuarantees(status === 'all' ? '' : status);
  const columns: Column<GuaranteeView>[] = [
    { key: 'num', header: 'Номер', cell: (g) => <span className="num font-medium">{g.number}</span> },
    { key: 'created', header: 'Запрошено', cell: (g) => <span className="num text-muted">{formatDateTime(g.createdAt)}</span> },
    { key: 'clinic', header: 'Клиника', cell: (g) => g.clinicName },
    { key: 'patient', header: 'Пациент', cell: (g) => g.insuredName },
    { key: 'service', header: 'Услуга', cell: (g) => <span className="line-clamp-1">{g.serviceName}</span> },
    { key: 'cost', header: 'Сумма', align: 'right', cell: (g) => <span className="num whitespace-nowrap">{formatMoney(g.approvedAmount ?? g.estimatedCost)}</span> },
    {
      key: 'status',
      header: 'Статус',
      cell: (g) => (
        <span className="flex flex-wrap items-center gap-1">
          <Chip kind={GUARANTEE_STATUS_CHIP[g.status]}>{GUARANTEE_STATUS_LABEL[g.status]}</Chip>
          {g.escalated && <Chip kind="warning">{g.status === 'requested' ? 'В МИГ' : `Решил ${g.decidedBy === 'mig' ? 'МИГ' : 'ассистанс'}`}</Chip>}
        </span>
      ),
    },
    { key: 'sla', header: 'SLA', cell: (g) => <SlaBadge dueAt={new Date(Date.parse(g.createdAt) + 24 * 3600_000).toISOString()} done={g.status !== 'requested' || !!g.escalated} /> },
  ];
  return (
    <>
      <PageHeader title="Гарантийные письма" subtitle="В пределах полномочий решает врач ассистанса, выше — заключение и эскалация в МИГ" />
      <Tabs value={status} onValueChange={(v) => setF({ status: v === 'requested' ? null : v })}>
        <TabsList>
          {TABS.map(([k, label]) => (
            <TabsTrigger key={k} value={k}>
              {label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <div className="mt-3 rounded-card border border-border bg-surface">
        <DataTable
          caption="Гарантийные письма"
          columns={columns}
          rows={q.data}
          loading={q.isLoading}
          error={q.error}
          onRetry={() => void q.refetch()}
          rowKey={(g) => g.id}
          onRowClick={(g) => navigate(`/assist/guarantees/${g.id}`)}
          onRowOpen={(g) => navigate(`/assist/guarantees/${g.id}`)}
          empty="Писем нет"
        />
      </div>
    </>
  );
}
