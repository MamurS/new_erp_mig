/* Rebills of assistance companies for MIG: review (curator) and payment (accountant). */
import { useNavigate } from 'react-router-dom';
import type { RebillSummary } from '@/shared/types/dto';
import { useStaffRebills } from '@/shared/api/queries/assist';
import { useCan } from '@/shared/auth/guards';
import { formatDate, formatMoney } from '@/shared/lib/format';
import { useDocumentTitle, useUrlFilters } from '@/shared/lib/hooks';
import { DataTable, type Column } from '@/shared/ui/data-table';
import { PageHeader } from '@/shared/ui/page';
import { Tabs, TabsList, TabsTrigger } from '@/shared/ui/tabs';
import { RebillStatus } from '@/features/assist/components';
import { useTopbar } from '../topbar';

export default function RebillsPage() {
  useDocumentTitle('Счета ассистансов');
  useTopbar([{ label: 'Счета ассистансов' }]);
  const navigate = useNavigate();
  const canPay = useCan('rebills.pay');
  const tabs: [string, string][] = [
    ['submitted,in_review', 'На проверке'],
    ['accepted,partially_accepted', 'К оплате'],
    ['paid', 'Оплачены'],
    ['all', 'Все'],
  ];
  const [f, setF] = useUrlFilters(['status'] as const);
  const fallback = canPay ? 'accepted,partially_accepted' : 'submitted,in_review';
  const status = tabs.some(([k]) => k === f.status) ? f.status! : fallback;
  const q = useStaffRebills(status === 'all' ? {} : { status });
  const columns: Column<RebillSummary>[] = [
    { key: 'num', header: 'Номер', cell: (b) => <span className="num font-medium">{b.number}</span> },
    { key: 'who', header: 'Ассистанс', cell: (b) => b.assistanceName },
    { key: 'period', header: 'Период', cell: (b) => <span className="num">{b.period}</span> },
    { key: 'lines', header: 'Строк', align: 'right', cell: (b) => <span className="num">{b.lineCount}</span> },
    { key: 'flags', header: 'С флагами', align: 'right', cell: (b) => <span className={b.flaggedCount ? 'num font-semibold text-danger-text' : 'num text-muted'}>{b.flaggedCount}</span> },
    { key: 'total', header: 'Итого', align: 'right', cell: (b) => <span className="num whitespace-nowrap">{formatMoney(b.totals.total)}</span> },
    { key: 'due', header: 'Проверить до', cell: (b) => (b.reviewDueAt ? <span className="num">{formatDate(b.reviewDueAt)}</span> : '—') },
    { key: 'status', header: 'Статус', cell: (b) => <RebillStatus status={b.status} /> },
  ];
  return (
    <>
      <PageHeader title="Счета ассистансов" subtitle="Куратор проверяет строки с флагами автоматических проверок, бухгалтер оплачивает. Принявший счёт не может его оплатить" />
      <Tabs value={status} onValueChange={(v) => setF({ status: v === fallback ? null : v })}>
        <TabsList>
          {tabs.map(([k, label]) => (
            <TabsTrigger key={k} value={k}>
              {label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <div className="mt-3 rounded-card border border-border bg-surface">
        <DataTable
          caption="Счета ассистансов"
          columns={columns}
          rows={q.data}
          loading={q.isLoading}
          error={q.error}
          onRetry={() => void q.refetch()}
          rowKey={(b) => b.id}
          onRowClick={(b) => navigate(`/staff/rebills/${b.id}`)}
          onRowOpen={(b) => navigate(`/staff/rebills/${b.id}`)}
          empty="Счетов нет"
        />
      </div>
    </>
  );
}
