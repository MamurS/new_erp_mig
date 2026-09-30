/* Rebills of the assistance to MIG (§5.5): the monthly bill of clinic payments plus the fee. */
import { useNavigate } from 'react-router-dom';
import type { RebillSummary } from '@/shared/types/dto';
import { useAssistRebills, useBuildRebill } from '@/shared/api/queries/assist';
import { errorMessage } from '@/shared/api/client';
import { formatDate, formatMoney, todayISO } from '@/shared/lib/format';
import { useDocumentTitle } from '@/shared/lib/hooks';
import { Button } from '@/shared/ui/button';
import { DataTable, type Column } from '@/shared/ui/data-table';
import { PageHeader } from '@/shared/ui/page';
import { toast } from '@/shared/ui/toast';
import { useTopbar } from '@/features/staff/topbar';
import { RebillStatus } from '../components';

export default function RebillsPage() {
  useDocumentTitle('Счета МИГ');
  useTopbar([{ label: 'Счета МИГ' }]);
  const navigate = useNavigate();
  const q = useAssistRebills();
  const build = useBuildRebill();
  const period = todayISO().slice(0, 7);
  const current = q.data?.find((b) => b.period === period);
  const columns: Column<RebillSummary>[] = [
    { key: 'num', header: 'Номер', cell: (b) => <span className="num font-medium">{b.number}</span> },
    { key: 'period', header: 'Период', cell: (b) => <span className="num">{b.period}</span> },
    { key: 'lines', header: 'Строк', align: 'right', cell: (b) => <span className="num">{b.lineCount}</span> },
    { key: 'flags', header: 'С флагами', align: 'right', cell: (b) => <span className={b.flaggedCount ? 'num font-semibold text-danger-text' : 'num text-muted'}>{b.flaggedCount}</span> },
    { key: 'total', header: 'Итого', align: 'right', cell: (b) => <span className="num whitespace-nowrap">{formatMoney(b.totals.total)}</span> },
    { key: 'sent', header: 'Отправлен', cell: (b) => (b.submittedAt ? <span className="num">{formatDate(b.submittedAt)}</span> : '—') },
    { key: 'status', header: 'Статус', cell: (b) => <RebillStatus status={b.status} /> },
  ];
  return (
    <>
      <PageHeader
        title="Счета на возмещение МИГ"
        subtitle="Строки, оплаченные клиникам в месяце, плюс вознаграждение по договору. МИГ проверяет счёт 10 рабочих дней"
        actions={
          (!current || current.status === 'draft') && (
            <Button
              loading={build.isPending}
              onClick={async () => {
                try {
                  const b = await build.mutateAsync(period);
                  navigate(`/assist/rebills/${b.id}`);
                } catch (e) {
                  toast.error(errorMessage(e));
                }
              }}
            >
              {current ? 'Обновить черновик' : 'Сформировать'} счёт за {period}
            </Button>
          )
        }
      />
      <div className="rounded-card border border-border bg-surface">
        <DataTable
          caption="Счета МИГ"
          columns={columns}
          rows={q.data}
          loading={q.isLoading}
          error={q.error}
          onRetry={() => void q.refetch()}
          rowKey={(b) => b.id}
          onRowClick={(b) => navigate(`/assist/rebills/${b.id}`)}
          onRowOpen={(b) => navigate(`/assist/rebills/${b.id}`)}
          empty="Счетов пока нет"
        />
      </div>
    </>
  );
}
