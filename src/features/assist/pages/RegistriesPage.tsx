/* Sub-registries of clinics for this assistance (§5.3): only the lines it pays for. */
import { useNavigate } from 'react-router-dom';
import type { SubRegistrySummary } from '@/shared/types/dto';
import { useAssistRegistries } from '@/shared/api/queries/assist';
import { REGISTRY_STATUS_CHIP, REGISTRY_STATUS_LABEL } from '@/shared/domain/clinics';
import { formatDate, formatMoney } from '@/shared/lib/format';
import { useDocumentTitle } from '@/shared/lib/hooks';
import { Chip } from '@/shared/ui/chips';
import { DataTable, type Column } from '@/shared/ui/data-table';
import { PageHeader } from '@/shared/ui/page';
import { useTopbar } from '@/features/staff/topbar';

const SOURCE_LABEL = { portal: 'Кабинет', csv: 'CSV', api: 'API' } as const;

export default function RegistriesPage() {
  useDocumentTitle('Реестры клиник');
  useTopbar([{ label: 'Реестры клиник' }]);
  const navigate = useNavigate();
  const q = useAssistRegistries();
  const columns: Column<SubRegistrySummary>[] = [
    { key: 'clinic', header: 'Клиника', cell: (r) => <span className="font-medium">{r.clinicName}</span> },
    { key: 'period', header: 'Период', cell: (r) => <span className="num">{r.period}</span> },
    { key: 'source', header: 'Источник', cell: (r) => SOURCE_LABEL[r.source] },
    { key: 'sent', header: 'Получен', cell: (r) => (r.submittedAt ? <span className="num">{formatDate(r.submittedAt)}</span> : '—') },
    { key: 'lines', header: 'Строк', align: 'right', cell: (r) => <span className="num">{r.lineCount}</span> },
    { key: 'todo', header: 'К проверке', align: 'right', cell: (r) => <span className={r.pendingCount + r.disputedCount ? 'num font-semibold text-warning-text' : 'num text-muted'}>{r.pendingCount + r.disputedCount}</span> },
    { key: 'unpaid', header: 'Не оплачено', align: 'right', cell: (r) => <span className={r.unpaidCount ? 'num font-semibold' : 'num text-muted'}>{r.unpaidCount}</span> },
    { key: 'claimed', header: 'Заявлено', align: 'right', cell: (r) => <span className="num whitespace-nowrap">{formatMoney(r.totals.claimed)}</span> },
    { key: 'paid', header: 'Оплачено', align: 'right', cell: (r) => <span className="num whitespace-nowrap">{formatMoney(r.totals.paid)}</span> },
    { key: 'status', header: 'Статус', cell: (r) => <Chip kind={REGISTRY_STATUS_CHIP[r.status]}>{REGISTRY_STATUS_LABEL[r.status]}</Chip> },
  ];
  return (
    <>
      <PageHeader title="Реестры клиник" subtitle="Система сама разносит строки реестров по плательщикам: здесь только строки ваших застрахованных" />
      <div className="rounded-card border border-border bg-surface">
        <DataTable
          caption="Подреестры клиник"
          columns={columns}
          rows={q.data}
          loading={q.isLoading}
          error={q.error}
          onRetry={() => void q.refetch()}
          rowKey={(r) => r.id}
          onRowClick={(r) => navigate(`/assist/registries/${r.id}`)}
          onRowOpen={(r) => navigate(`/assist/registries/${r.id}`)}
          empty="Реестров нет"
        />
      </div>
    </>
  );
}
