/*
 * HR «Семья»: family members of the company's employees — names, relations, coverage; no medical data
 * (FAMILY_SPEC). Requests not yet approved by MIG are listed with their status, like new employees.
 */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Inbox, Plus, ShieldCheck } from 'lucide-react';
import type { HrFamilyMember } from '@/shared/types/dto';
import { useHrFamily, useHrFamilyRequests } from '@/shared/api/queries/hr';
import { FAMILY_RELATIONS, RELATION_LABEL } from '@/shared/domain/family';
import { formatDate } from '@/shared/lib/format';
import { useDocumentTitle, useUrlFilters } from '@/shared/lib/hooks';
import { cn } from '@/shared/lib/cn';
import { buttonVariants, Button } from '@/shared/ui/button';
import { Avatar } from '@/shared/ui/chips';
import { DataTable, type Column } from '@/shared/ui/data-table';
import { Select } from '@/shared/ui/input';
import { SearchInput } from '@/shared/ui/search-input';
import { EmptyState } from '@/shared/ui/states';
import { HR_BTN, HrHeader } from '../ui';
import { FamilyStatusChip } from '../family/FamilyStatusChip';
import { employeesOf, filterFamily, isFamilyRelationFilter } from '../family/familyList';
import { t } from '@/i18n';

const FILTER_KEYS = ['employee', 'relation'] as const;

export default function FamilyPage() {
  useDocumentTitle(t('hr.nav.family'));
  const list = useHrFamily();
  const pending = useHrFamilyRequests('pending');
  const [filters, setFilters] = useUrlFilters(FILTER_KEYS);
  const [search, setSearch] = useState('');
  const relation = isFamilyRelationFilter(filters.relation) ? filters.relation : '';
  const employees = useMemo(() => employeesOf(list.data ?? []), [list.data]);
  const employeeId = employees.some((e) => e.id === filters.employee) ? filters.employee : '';
  const rows = useMemo(() => filterFamily(list.data ?? [], { employeeId, relation, q: search.trim() }), [list.data, employeeId, relation, search]);
  const waiting = pending.data?.length ?? 0;

  const columns: Column<HrFamilyMember>[] = [
    {
      key: 'name',
      header: t('hr.family.person'),
      cell: (m) => (
        <div className={cn('flex items-center gap-3 py-2', m.status === 'excluded' && 'opacity-60')}>
          <Avatar name={m.fullName} className="h-10 w-10 text-[13px]" />
          <div className="min-w-0">
            <p className="truncate font-semibold">{m.fullName}</p>
            {m.status === 'rejected' && m.rejectionReason && <p className="text-[13px] text-danger-text">{t('hr.employees.reason', { reason: m.rejectionReason })}</p>}
          </div>
        </div>
      ),
    },
    {
      key: 'relation',
      header: t('hr.family.relation'),
      cell: (m) => (
        <span>
          {RELATION_LABEL[m.relation]}
          {m.isStudent && <span className="text-muted"> · {t('hr.family.student')}</span>}
        </span>
      ),
    },
    { key: 'employee', header: t('common.employee'), cell: (m) => m.employeeName },
    { key: 'birth', header: t('hr.csv.column.birthDate'), cell: (m) => <span className="num">{m.birthDateMasked || '—'}</span> },
    { key: 'cert', header: t('hr.family.certificate'), cell: (m) => <span className="num whitespace-nowrap">{m.certificateNumber ?? '—'}</span> },
    { key: 'from', header: t('hr.employees.insuredFrom'), cell: (m) => <span className="num">{formatDate(m.insuredFrom)}</span> },
    { key: 'status', header: t('common.status'), cell: (m) => <FamilyStatusChip member={m} /> },
  ];

  const hasFilters = !!employeeId || !!relation || !!search.trim();

  return (
    <>
      <HrHeader
        title={t('hr.family.title')}
        subtitle={t('hr.family.subtitle')}
        actions={
          <>
            <Link to="/hr/family/requests" className={cn(buttonVariants({ variant: 'secondary' }), HR_BTN)}>
              <Inbox className="h-4 w-4" aria-hidden />
              {waiting > 0 ? t('hr.family.requestsN', { n: waiting }) : t('hr.nav.familyRequests')}
            </Link>
            <Link to="/hr/family/new" className={cn(buttonVariants({ variant: 'primary' }), HR_BTN)}>
              <Plus className="h-4 w-4" aria-hidden />
              {t('hr.familyAdd.title')}
            </Link>
          </>
        }
      />

      <div className="mb-6 flex items-start gap-3 rounded-card bg-sky p-4 text-sky-text">
        <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
        <p>{t('hr.family.privacy')}</p>
      </div>

      <section className="rounded-card border border-border bg-surface" aria-label={t('hr.family.listAria')}>
        <div className="flex flex-wrap items-center gap-3 border-b border-border-soft p-4">
          <div className="flex flex-wrap gap-2" role="group" aria-label={t('hr.family.relation')}>
            {['', ...FAMILY_RELATIONS].map((r) => (
              <button
                key={r || 'all'}
                type="button"
                aria-pressed={relation === r}
                onClick={() => setFilters({ relation: r || null })}
                className={cn(
                  'h-11 rounded-full border px-4 text-[14px] font-semibold transition-colors',
                  relation === r ? 'border-accent bg-accent-soft text-accent-text' : 'border-border text-text hover:bg-rail',
                )}
              >
                {r ? RELATION_LABEL[r as (typeof FAMILY_RELATIONS)[number]] : t('common.all')}
              </button>
            ))}
          </div>
          <Select
            aria-label={t('hr.family.employeeFilter')}
            value={employeeId}
            onChange={(e) => setFilters({ employee: e.target.value || null })}
            className="h-11 w-auto min-w-[220px] rounded-btn"
          >
            <option value="">{t('hr.family.allEmployees')}</option>
            {employees.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </Select>
          <SearchInput value={search} onChange={setSearch} placeholder={t('hr.family.searchPlaceholder')} className="min-w-[220px] flex-1 [&_input]:h-11 [&_input]:rounded-btn" />
        </div>
        <DataTable
          caption={t('hr.family.caption')}
          density="client"
          columns={columns}
          rows={list.data ? rows : undefined}
          rowKey={(m) => m.id}
          loading={list.isLoading}
          error={list.isError ? list.error : undefined}
          onRetry={() => void list.refetch()}
          empty={
            hasFilters ? (
              <EmptyState
                title={t('hr.family.notFound')}
                action={
                  <Button
                    variant="secondary"
                    className={HR_BTN}
                    onClick={() => {
                      setSearch('');
                      setFilters({ employee: null, relation: null });
                    }}
                  >
                    {t('hr.employees.resetFilters')}
                  </Button>
                }
              />
            ) : (
              <EmptyState
                title={t('hr.family.empty')}
                description={t('hr.family.emptyHint')}
                action={
                  <Link to="/hr/family/new" className={cn(buttonVariants({ variant: 'primary' }), HR_BTN)}>
                    {t('hr.familyAdd.title')}
                  </Link>
                }
              />
            )
          }
        />
      </section>
    </>
  );
}
