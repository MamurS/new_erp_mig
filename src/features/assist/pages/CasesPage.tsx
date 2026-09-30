/* Call-centre cases (§5.1): list with SLA, filters by status and type; a former client's cases are read-only. */
import { useNavigate } from 'react-router-dom';
import type { AssistCaseView } from '@/shared/types/dto';
import { useAssistCases } from '@/shared/api/queries/assist';
import { CASE_CHANNEL_LABEL, CASE_STATUS_LABEL, CASE_TYPE_LABEL } from '@/shared/domain/assistance';
import { formatDateTime } from '@/shared/lib/format';
import { useDocumentTitle, useUrlFilters } from '@/shared/lib/hooks';
import { Chip } from '@/shared/ui/chips';
import { DataTable, type Column } from '@/shared/ui/data-table';
import { FilterChip } from '@/shared/ui/filter-chip';
import { PageHeader } from '@/shared/ui/page';
import { useTopbar } from '@/features/staff/topbar';
import { CaseStatus, SlaBadge } from '../components';

const KEYS = ['status', 'type'] as const;

export default function CasesPage() {
  useDocumentTitle('Обращения');
  useTopbar([{ label: 'Обращения' }]);
  const navigate = useNavigate();
  const [f, setF] = useUrlFilters(KEYS);
  const q = useAssistCases({ ...(f.status ? { status: f.status } : {}), ...(f.type ? { type: f.type } : {}) });
  const columns: Column<AssistCaseView>[] = [
    { key: 'number', header: 'Номер', cell: (c) => <span className="num font-medium">{c.number}</span> },
    { key: 'type', header: 'Тип', cell: (c) => (c.type === 'complaint' || c.type === 'emergency' ? <Chip kind="danger">{CASE_TYPE_LABEL[c.type]}</Chip> : CASE_TYPE_LABEL[c.type]) },
    { key: 'who', header: 'Застрахованный', cell: (c) => c.insuredName },
    { key: 'text', header: 'Суть', cell: (c) => <span className="line-clamp-1 text-muted">{c.description}</span> },
    { key: 'channel', header: 'Канал', cell: (c) => CASE_CHANNEL_LABEL[c.channel] },
    { key: 'created', header: 'Создано', cell: (c) => <span className="num whitespace-nowrap">{formatDateTime(c.createdAt)}</span> },
    { key: 'status', header: 'Статус', cell: (c) => (c.access === 'read' ? <Chip kind="neutral">Только чтение</Chip> : <CaseStatus status={c.status} />) },
    { key: 'sla', header: 'SLA', cell: (c) => <SlaBadge dueAt={c.slaDueAt} done={c.status === 'resolved' || c.access === 'read'} /> },
  ];
  return (
    <>
      <PageHeader title="Обращения" subtitle="Новое обращение создаётся из карточки застрахованного после поиска" />
      <div className="mb-3 flex flex-wrap gap-2">
        <FilterChip
          label="Статус"
          options={Object.entries(CASE_STATUS_LABEL).map(([value, label]) => ({ value, label }))}
          selected={f.status ? f.status.split(',') : []}
          onChange={(v) => setF({ status: v.length ? v.join(',') : null })}
        />
        <FilterChip
          label="Тип"
          options={Object.entries(CASE_TYPE_LABEL).map(([value, label]) => ({ value, label }))}
          selected={f.type ? [f.type] : []}
          onChange={(v) => setF({ type: v[v.length - 1] ?? null })}
        />
      </div>
      <div className="rounded-card border border-border bg-surface">
        <DataTable
          caption="Обращения колл-центра"
          columns={columns}
          rows={q.data}
          loading={q.isLoading}
          error={q.error}
          onRetry={() => void q.refetch()}
          rowKey={(c) => c.id}
          onRowClick={(c) => navigate(`/assist/cases/${c.id}`)}
          onRowOpen={(c) => navigate(`/assist/cases/${c.id}`)}
          empty="Обращений нет"
        />
      </div>
    </>
  );
}
