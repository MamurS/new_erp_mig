/* «Договоры»: every contract of the lifecycle with its status, version and premium. */
import { t } from '@/i18n';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { ContractView } from '@/shared/types/dto';
import { useContracts } from '@/shared/api/queries/lifecycle';
import { CONTRACT_STATUS_CHIP, CONTRACT_STATUS_LABEL } from '@/shared/domain/contracts';
import { PROGRAM_LABEL } from '@/shared/domain/labels';
import type { ContractStatus } from '@/shared/types';
import { formatDate, formatMoney } from '@/shared/lib/format';
import { useDebounced, useDocumentTitle, useUrlFilters } from '@/shared/lib/hooks';
import { SearchInput } from '@/shared/ui/search-input';
import { Chip } from '@/shared/ui/chips';
import { DataTable, formatSort, parseSort, type Column } from '@/shared/ui/data-table';
import { formatLegalForms, legalFormColumn, parseLegalForms } from '@/shared/ui/legal-form';
import { Select } from '@/shared/ui/input';
import { PageHeader } from '@/shared/ui/page';
import { useTopbar } from '../topbar';

export default function ContractsPage() {
  useDocumentTitle(t('staffLc.contracts.title'));
  useTopbar([{ label: t('staffLc.contracts.title') }]);
  const navigate = useNavigate();
  const [f, setF] = useUrlFilters(['status', 'form', 'sort'] as const);
  const forms = parseLegalForms(f.form);
  const sort = parseSort(f.sort);
  // Search by the new number, the number in the previous system (transferred contracts) or the client.
  const [search, setSearch] = useState('');
  const term = useDebounced(search.trim());
  const q = useContracts({
    ...(term ? { q: term } : {}),
    ...(f.status ? { status: f.status } : {}),
    ...(forms.length ? { form: forms.join(',') } : {}),
    ...(sort ? { sort: `${sort.key}:${sort.dir}` } : {}),
  });
  const columns: Column<ContractView>[] = [
    {
      key: 'num',
      header: t('common.contract'),
      sortKey: 'number',
      cell: (c) => (
        <span className="flex flex-col">
          <span className="num font-medium">{c.number}</span>
          {c.externalNumber && <span className="num text-[12px] text-muted">{t('migration.oldNumberChip', { number: c.externalNumber })}</span>}
        </span>
      ),
    },
    { key: 'client', header: t('common.client'), sortKey: 'clientName', cell: (c) => c.client.name },
    legalFormColumn<ContractView>((c) => c.client.legalForm, { selected: forms, onChange: (v) => setF({ form: formatLegalForms(v) }) }),
    { key: 'status', header: t('common.status'), cell: (c) => <Chip kind={CONTRACT_STATUS_CHIP[c.status]}>{CONTRACT_STATUS_LABEL[c.status]}</Chip> },
    { key: 'ver', header: t('staffLc.contracts.version'), align: 'right', cell: (c) => <span className="num">{c.version}</span> },
    { key: 'program', header: t('common.program'), cell: (c) => PROGRAM_LABEL[c.params.program] },
    { key: 'term', header: t('staffLc.contracts.term'), cell: (c) => <span className="num whitespace-nowrap">{formatDate(c.params.startDate)} — {formatDate(c.params.endDate)}</span> },
    { key: 'total', header: t('common.premium'), align: 'right', cell: (c) => <span className="num whitespace-nowrap">{formatMoney(c.params.total)}</span> },
    { key: 'changed', header: t('staffLc.contracts.changedClauses'), align: 'right', cell: (c) => <span className="num">{c.clauseOverrides.length || '—'}</span> },
  ];
  return (
    <>
      <PageHeader title={t('staffLc.contracts.title')} subtitle={t('staffLc.contracts.subtitle')} />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <SearchInput value={search} onChange={setSearch} placeholder={t('migration.contractsSearch')} aria-label={t('migration.contractsSearch')} slashFocus className="w-80" />
        <Select aria-label={t('common.status')} className="h-8 w-56" value={f.status ?? ''} onChange={(e) => setF({ status: e.target.value || null })}>
          <option value="">{t('staffLc.contracts.allStatuses')}</option>
          {(Object.keys(CONTRACT_STATUS_LABEL) as ContractStatus[]).map((s) => (
            <option key={s} value={s}>
              {CONTRACT_STATUS_LABEL[s]}
            </option>
          ))}
        </Select>
      </div>
      <div className="rounded-card border border-border bg-surface">
        <DataTable caption={t('staffLc.contracts.title')} columns={columns} rows={q.data} sort={sort} onSortChange={(s) => setF({ sort: formatSort(s) })} loading={q.isLoading} error={q.error} onRetry={() => void q.refetch()} rowKey={(c) => c.id} onRowClick={(c) => navigate(`/staff/contracts/${c.id}`)} empty={t('staffLc.contracts.empty')} />
      </div>
    </>
  );
}
