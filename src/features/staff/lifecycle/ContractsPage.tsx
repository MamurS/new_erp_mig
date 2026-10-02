/* «Договоры»: every contract of the lifecycle with its status, version and premium. */
import { useNavigate } from 'react-router-dom';
import type { ContractView } from '@/shared/types/dto';
import { useContracts } from '@/shared/api/queries/lifecycle';
import { CONTRACT_STATUS_CHIP, CONTRACT_STATUS_LABEL } from '@/shared/domain/contracts';
import { PROGRAM_LABEL } from '@/shared/domain/labels';
import type { ContractStatus } from '@/shared/types';
import { formatDate, formatMoney } from '@/shared/lib/format';
import { useDocumentTitle, useUrlFilters } from '@/shared/lib/hooks';
import { Chip } from '@/shared/ui/chips';
import { DataTable, type Column } from '@/shared/ui/data-table';
import { Select } from '@/shared/ui/input';
import { PageHeader } from '@/shared/ui/page';
import { useTopbar } from '../topbar';

export default function ContractsPage() {
  useDocumentTitle('Договоры');
  useTopbar([{ label: 'Договоры' }]);
  const navigate = useNavigate();
  const [f, setF] = useUrlFilters(['status'] as const);
  const q = useContracts(f.status ? { status: f.status } : {});
  const columns: Column<ContractView>[] = [
    { key: 'num', header: 'Договор', cell: (c) => <span className="num font-medium">{c.number}</span> },
    { key: 'client', header: 'Клиент', cell: (c) => c.clientName },
    { key: 'status', header: 'Статус', cell: (c) => <Chip kind={CONTRACT_STATUS_CHIP[c.status]}>{CONTRACT_STATUS_LABEL[c.status]}</Chip> },
    { key: 'ver', header: 'Версия', align: 'right', cell: (c) => <span className="num">{c.version}</span> },
    { key: 'program', header: 'Программа', cell: (c) => PROGRAM_LABEL[c.params.program] },
    { key: 'term', header: 'Срок', cell: (c) => <span className="num whitespace-nowrap">{formatDate(c.params.startDate)} — {formatDate(c.params.endDate)}</span> },
    { key: 'total', header: 'Премия', align: 'right', cell: (c) => <span className="num whitespace-nowrap">{formatMoney(c.params.total)}</span> },
    { key: 'changed', header: 'Изм. пунктов', align: 'right', cell: (c) => <span className="num">{c.clauseOverrides.length || '—'}</span> },
  ];
  return (
    <>
      <PageHeader title="Договоры" subtitle="Договоры ДМС: черновики, согласование, подписание и действующие" />
      <div className="mb-3">
        <Select aria-label="Статус" className="h-8 w-56" value={f.status ?? ''} onChange={(e) => setF({ status: e.target.value || null })}>
          <option value="">Все статусы</option>
          {(Object.keys(CONTRACT_STATUS_LABEL) as ContractStatus[]).map((s) => (
            <option key={s} value={s}>
              {CONTRACT_STATUS_LABEL[s]}
            </option>
          ))}
        </Select>
      </div>
      <div className="rounded-card border border-border bg-surface">
        <DataTable caption="Договоры" columns={columns} rows={q.data} loading={q.isLoading} error={q.error} onRetry={() => void q.refetch()} rowKey={(c) => c.id} onRowClick={(c) => navigate(`/staff/contracts/${c.id}`)} empty="Договоров нет" />
      </div>
    </>
  );
}
