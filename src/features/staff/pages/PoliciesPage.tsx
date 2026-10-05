import { t } from '@/i18n';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Policy, PolicyStatus, ProgramCode } from '@/shared/types';
import { usePolicies } from '@/shared/api/queries/staff';
import { POLICY_STATUS_LABEL, PROGRAM_LABEL } from '@/shared/domain/labels';
import { formatDate, formatMoney, formatNumber } from '@/shared/lib/format';
import { useDebounced, useDocumentTitle, useUrlFilters } from '@/shared/lib/hooks';
import { Button } from '@/shared/ui/button';
import { StatusDot } from '@/shared/ui/chips';
import { DataTable, formatSort, parseSort, type Column } from '@/shared/ui/data-table';
import { FilterChip } from '@/shared/ui/filter-chip';
import { SearchInput } from '@/shared/ui/search-input';
import { EmptyState } from '@/shared/ui/states';
import { ExportButton } from '../components/ExportButton';
import { RenewalCell } from '../components/cells';
import { POLICY_TONE } from '../components/tones';
import { useTopbar } from '../topbar';

export default function PoliciesPage() {
  useDocumentTitle(t('staff.policies.title'));
  useTopbar([{ label: t('staff.policies.title') }]);
  const navigate = useNavigate();
  const [f, setF] = useUrlFilters(['status', 'program', 'sort', 'page'] as const);
  const [search, setSearch] = useState('');
  const q = useDebounced(search.trim());
  const page = Number(f.page) || 1;
  const sort = parseSort(f.sort || 'endDate:asc');
  const list = usePolicies({ status: f.status, program: f.program, sort: formatSort(sort), page, pageSize: 25, q });

  const cols: Column<Policy>[] = [
    { key: 'number', header: t('common.number'), sortKey: 'number', cell: (p) => <span className="num font-medium">{p.number}</span> },
    { key: 'client', header: t('common.client'), sortKey: 'clientName', cell: (p) => p.clientName },
    { key: 'program', header: t('common.program'), sortKey: 'program', cell: (p) => PROGRAM_LABEL[p.program] },
    { key: 'start', header: t('common.start'), sortKey: 'startDate', cell: (p) => formatDate(p.startDate) },
    { key: 'end', header: t('common.end'), sortKey: 'endDate', cell: (p) => (p.status === 'active' ? <RenewalCell date={p.endDate} /> : formatDate(p.endDate)) },
    { key: 'insured', header: t('staff.clients.col.insured'), sortKey: 'insuredCount', align: 'right', cell: (p) => <span className="num">{formatNumber(p.insuredCount)}</span> },
    { key: 'premium', header: t('common.premium'), sortKey: 'premium', align: 'right', cell: (p) => <span className="num">{formatMoney(p.premium)}</span> },
    { key: 'status', header: t('common.status'), sortKey: 'status', cell: (p) => <StatusDot tone={POLICY_TONE[p.status]}>{POLICY_STATUS_LABEL[p.status]}</StatusDot> },
  ];

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-[22px] font-bold">{t('staff.policies.title')}</h1>
        <SearchInput value={search} onChange={setSearch} placeholder={t('staff.policies.searchPlaceholder')} slashFocus className="w-72" />
      </div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <FilterChip
          label={t('common.status')}
          options={(Object.keys(POLICY_STATUS_LABEL) as PolicyStatus[]).map((s) => ({ value: s, label: POLICY_STATUS_LABEL[s] }))}
          selected={f.status ? f.status.split(',') : []}
          onChange={(v) => setF({ status: v.join(',') })}
        />
        <FilterChip
          label={t('common.program')}
          options={(Object.keys(PROGRAM_LABEL) as ProgramCode[]).map((s) => ({ value: s, label: PROGRAM_LABEL[s] }))}
          selected={f.program ? f.program.split(',') : []}
          onChange={(v) => setF({ program: v.join(',') })}
        />
        <div className="ml-auto">
          <ExportButton type="policies" />
        </div>
      </div>
      <div className="rounded-card border border-border bg-surface">
        <DataTable
          caption={t('staff.policies.title')}
          columns={cols}
          rows={list.data?.items}
          rowKey={(p) => p.id}
          loading={list.isLoading}
          error={list.error}
          onRetry={() => void list.refetch()}
          sort={sort}
          onSortChange={(s) => setF({ sort: formatSort(s) })}
          onRowClick={(p) => navigate(`/staff/policies/${p.id}`)}
          page={page}
          pageSize={25}
          total={list.data?.total}
          onPageChange={(p) => setF({ page: p }, false)}
          empty={
            <EmptyState
              title={t('staff.policies.notFound')}
              description={t('staff.clients.notFoundHint')}
              action={<Button variant="secondary" onClick={() => { setSearch(''); setF({ status: '', program: '' }); }}>{t('staff.clients.resetFilters')}</Button>}
            />
          }
        />
      </div>
    </div>
  );
}
