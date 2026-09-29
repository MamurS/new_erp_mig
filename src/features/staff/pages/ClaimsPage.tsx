import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Claim, ClaimCategory, ClaimStatus } from '@/shared/types';
import { useClaims } from '@/shared/api/queries/staff';
import { CLAIM_CATEGORY_LABEL, CLAIM_STATUS_LABEL } from '@/shared/domain/claims';
import { formatMoney } from '@/shared/lib/format';
import { useDebounced, useDocumentTitle, useUrlFilters } from '@/shared/lib/hooks';
import { cn } from '@/shared/lib/cn';
import { Button } from '@/shared/ui/button';
import { StatusDot } from '@/shared/ui/chips';
import { DataTable, formatSort, parseSort, type Column } from '@/shared/ui/data-table';
import { FilterChip } from '@/shared/ui/filter-chip';
import { SearchInput } from '@/shared/ui/search-input';
import { EmptyState } from '@/shared/ui/states';
import { ExportButton } from '../components/ExportButton';
import { CLAIM_TONE } from '../components/tones';
import { useTopbar } from '../topbar';
import { SlaCell } from '../components/cells';

export default function ClaimsPage() {
  useDocumentTitle('Убытки');
  useTopbar([{ label: 'Убытки' }]);
  const navigate = useNavigate();
  const [f, setF] = useUrlFilters(['status', 'category', 'overdue', 'sort', 'page'] as const);
  const [search, setSearch] = useState('');
  const q = useDebounced(search.trim());
  const page = Number(f.page) || 1;
  const sort = parseSort(f.sort || 'createdAt:desc');
  const list = useClaims({ status: f.status, category: f.category, overdue: f.overdue, sort: formatSort(sort), page, pageSize: 25, q });
  const statusSel = f.status === 'active' ? ['new', 'review', 'medical_review'] : f.status ? f.status.split(',') : [];

  const cols: Column<Claim>[] = [
    { key: 'number', header: 'Номер', sortKey: 'number', cell: (c) => <span className="num font-medium">{c.number}</span> },
    { key: 'insured', header: 'Застрахованный', sortKey: 'insuredName', cell: (c) => c.insuredName },
    { key: 'client', header: 'Клиент', sortKey: 'clientName', cell: (c) => <span className="text-muted">{c.clientName}</span> },
    { key: 'category', header: 'Категория', sortKey: 'category', cell: (c) => CLAIM_CATEGORY_LABEL[c.category] },
    { key: 'amount', header: 'Сумма', sortKey: 'amountClaimed', align: 'right', cell: (c) => <span className="num">{formatMoney(c.amountApproved ?? c.amountClaimed)}</span> },
    { key: 'status', header: 'Статус', sortKey: 'status', cell: (c) => <StatusDot tone={CLAIM_TONE[c.status]}>{CLAIM_STATUS_LABEL[c.status]}</StatusDot> },
    { key: 'sla', header: 'SLA', sortKey: 'slaDueAt', cell: (c) => <SlaCell claim={c} /> },
  ];

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-[22px] font-bold">Убытки</h1>
        <SearchInput value={search} onChange={setSearch} placeholder="Номер убытка, ФИО или клиент" slashFocus className="w-80" />
      </div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <FilterChip
          label="Статус"
          options={(Object.keys(CLAIM_STATUS_LABEL) as ClaimStatus[]).map((s) => ({ value: s, label: CLAIM_STATUS_LABEL[s] }))}
          selected={statusSel}
          onChange={(v) => setF({ status: v.join(',') })}
        />
        <FilterChip
          label="Категория"
          options={(Object.keys(CLAIM_CATEGORY_LABEL) as ClaimCategory[]).map((s) => ({ value: s, label: CLAIM_CATEGORY_LABEL[s] }))}
          selected={f.category ? f.category.split(',') : []}
          onChange={(v) => setF({ category: v.join(',') })}
        />
        <label className={cn('inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-btn border px-2 text-[12px]', f.overdue ? 'border-danger/40 bg-danger-soft text-danger-text' : 'border-dashed border-border text-muted')}>
          <input type="checkbox" checked={f.overdue === '1'} onChange={(e) => setF({ overdue: e.target.checked ? '1' : null })} />
          Просрочен SLA
        </label>
        <div className="ml-auto">
          <ExportButton type="claims_financial" label="Экспорт финансов в CSV" />
        </div>
      </div>
      <div className="rounded-card border border-border bg-surface">
        <DataTable
          caption="Убытки"
          columns={cols}
          rows={list.data?.items}
          rowKey={(c) => c.id}
          loading={list.isLoading}
          error={list.error}
          onRetry={() => void list.refetch()}
          sort={sort}
          onSortChange={(s) => setF({ sort: formatSort(s) })}
          onRowClick={(c) => navigate(`/staff/claims/${c.id}`)}
          page={page}
          pageSize={25}
          total={list.data?.total}
          onPageChange={(p) => setF({ page: p }, false)}
          empty={
            <EmptyState
              title="Убытки не найдены"
              description="Измените фильтры или строку поиска"
              action={<Button variant="secondary" onClick={() => { setSearch(''); setF({ status: '', category: '', overdue: null }); }}>Сбросить фильтры</Button>}
            />
          }
        />
      </div>
    </div>
  );
}
