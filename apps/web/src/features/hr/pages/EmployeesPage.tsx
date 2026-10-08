import { useState } from 'react';
import { HrTasks } from '@/features/next/HrTasks';
import { Link } from 'react-router-dom';
import { Download, FileText, MoreHorizontal, Plus, Send, ShieldCheck, Upload, UserMinus, BellRing, UsersRound } from 'lucide-react';
import type { HrEmployee, HrOverview } from '@mig/contracts/dto';
import { useExcludeEmployee, useHrEmployees, useHrOverview, useInvite } from '@/shared/api/queries/hr';
import { useExport } from '@/shared/api/queries/staff';
import { errorMessage } from '@/shared/api/client';
import { exclusionDropsBelow, groupSize } from '@mig/domain/minGroup';
import { hrExcludeSchema } from '@mig/contracts/forms';
import { PROGRAM_LABEL } from '@mig/domain/labels';
import { formatDate, formatMoney, formatNumber, formatRelativeDays, todayISO } from '@mig/domain/lib/format';
import { downloadText, exportFileName } from '@/shared/lib/csv';
import { useDebounced, useDocumentTitle, useUrlFilters } from '@/shared/lib/hooks';
import { Button, buttonVariants } from '@/shared/ui/button';
import { Avatar, Chip } from '@/shared/ui/chips';
import { DataTable, formatSort, parseSort, type Column } from '@/shared/ui/data-table';
import { Menu, MenuContent, MenuItem, MenuTrigger } from '@/shared/ui/dropdown';
import { SearchInput } from '@/shared/ui/search-input';
import { EmptyState, ErrorState, Skeleton } from '@/shared/ui/states';
import { ConfirmDialog } from '@/shared/ui/confirm-dialog';
import { Field } from '@/shared/ui/input';
import { MaskedInput } from '@/shared/ui/masked-input';
import { toast } from '@/shared/ui/toast';
import { cn } from '@/shared/lib/cn';
import { FamilyNames } from '@/shared/ui/family-names';
import { invoicePdf, downloadPdf, pdfFileName } from '../pdf';
import { AppStatusChip, HR_BTN, HrCard, HrHeader } from '../ui';
import { EmployeeFamilyDialog } from '../family/EmployeeFamilyDialog';
import { t, tp, tm } from '@/i18n';

const PAGE_SIZE = 25;
const FILTER_KEYS = ['filter', 'page', 'sort'] as const;
const FILTERS = [
  { value: '', get label() { return t('common.all'); } },
  { value: 'not_in_app', get label() { return t('hr.employees.filter.notInApp'); } },
  { value: 'recent', get label() { return t('hr.employees.filter.recent'); } },
  { value: 'requests', get label() { return t('hr.contracts.requests'); } },
] as const;

export default function EmployeesPage() {
  useDocumentTitle(t('hr.nav.employees'));
  const overview = useHrOverview();
  const [filters, setFilters] = useUrlFilters(FILTER_KEYS);
  const [search, setSearch] = useState('');
  const q = useDebounced(search.trim(), 300);
  const page = Math.max(1, Number(filters.page) || 1);
  const sort = parseSort(filters.sort);
  const filter = FILTERS.some((f) => f.value === filters.filter) ? filters.filter : '';

  const list = useHrEmployees({ filter: filter || undefined, q: q || undefined, page, pageSize: PAGE_SIZE, sort: filters.sort || undefined });
  const invite = useInvite();
  const exporter = useExport();
  const [excluding, setExcluding] = useState<HrEmployee | null>(null);
  const [familyOf, setFamilyOf] = useState<HrEmployee | null>(null);

  const onInvite = (e: HrEmployee) =>
    invite.mutate([e.id], {
      onSuccess: () => toast.success(t('hr.employees.invited')),
      onError: (err) => toast.error(errorMessage(err)),
    });

  const onExport = () =>
    exporter.mutate('hr_employees', {
      onSuccess: (csv) => {
        downloadText(csv, exportFileName('employees'));
        toast.success(t('hr.employees.exported'));
      },
      onError: (err) => toast.error(errorMessage(err)),
    });

  const columns: Column<HrEmployee>[] = [
    {
      key: 'name',
      header: t('common.employee'),
      sortKey: 'fullName',
      cell: (e) => (
        <div className={cn('flex items-center gap-3 py-2', e.status === 'excluded' && 'opacity-60')}>
          <Avatar name={e.fullName} className="h-10 w-10 text-[13px]" />
          <div className="min-w-0">
            <p className="truncate font-semibold">{e.fullName}</p>
            <p className="truncate text-[13px] text-muted">
              {e.status === 'excluded' && e.excludedFrom ? t('hr.employees.excludedFrom', { date: formatDate(e.excludedFrom) }) : e.position}
            </p>
            {e.pendingExclusionFrom && (
              <p className="text-[13px] font-medium text-warning-text" data-testid="pending-exclusion">
                {t('hr.employees.pendingExclusion', { date: formatDate(e.pendingExclusionFrom) })}
              </p>
            )}
            {e.status === 'rejected' && e.rejectionReason && <p className="text-[13px] text-danger-text">{t('hr.employees.reason', { reason: e.rejectionReason })}</p>}
            {e.status === 'active' && e.rejectionReason && (
              <p className="text-[13px] text-danger-text" data-testid="exclusion-rejected">
                {t('hr.employees.exclusionRejected', { reason: e.rejectionReason })}
              </p>
            )}
          </div>
        </div>
      ),
    },
    { key: 'program', header: t('common.program'), cell: (e) => <span className={cn(e.status === 'excluded' && 'text-muted')}>{PROGRAM_LABEL[e.program]}</span> },
    { key: 'from', header: t('hr.employees.insuredFrom'), sortKey: 'insuredFrom', cell: (e) => <span className="num">{formatDate(e.insuredFrom)}</span> },
    {
      key: 'family',
      header: t('hr.employees.family'),
      sortKey: 'family',
      // People of the family by name (FAMILY_SPEC: a list instead of «семья: N»).
      cell: (e) => <FamilyNames family={e.family} />,
    },
    {
      key: 'app',
      header: t('hr.employees.app'),
      sortKey: 'appStatus',
      cell: (e) =>
        e.status === 'excluded' ? (
          <span className="text-muted">{t('hr.employees.excluded')}</span>
        ) : e.status === 'pending' ? (
          <Chip kind="sun">{t('hr.employees.pending')}</Chip>
        ) : e.status === 'rejected' ? (
          <Chip kind="danger">{t('hr.employees.rejected')}</Chip>
        ) : (
          <AppStatusChip status={e.appStatus} />
        ),
    },
    {
      key: 'menu',
      header: '',
      align: 'right',
      className: 'w-14',
      cell: (e) =>
        e.status !== 'active' ? null : (
          <Menu>
            <MenuTrigger asChild>
              <Button variant="ghost" size="icon-lg" aria-label={t('hr.employees.actions')}>
                <MoreHorizontal className="h-5 w-5" aria-hidden />
              </Button>
            </MenuTrigger>
            <MenuContent>
              <MenuItem className="min-h-11" onSelect={() => setFamilyOf(e)}>
                <UsersRound className="h-4 w-4" aria-hidden />
                {t('hr.employees.familyMenu')}
              </MenuItem>
              <MenuItem className="min-h-11" disabled={e.appStatus === 'active'} onSelect={() => onInvite(e)}>
                <Send className="h-4 w-4" aria-hidden />
                {t('hr.employees.invite')}
              </MenuItem>
              <MenuItem className="min-h-11" danger disabled={!!e.pendingExclusionFrom} onSelect={() => setExcluding(e)}>
                <UserMinus className="h-4 w-4" aria-hidden />
                {t('hr.employees.exclude')}
              </MenuItem>
            </MenuContent>
          </Menu>
        ),
    },
  ];

  const hasFilters = !!filter || !!q;

  return (
    <>
      <HrHeader
        title={t('hr.nav.employees')}
        subtitle={
          overview.data ? (
            t('hr.employees.subtitle', { insured: formatNumber(overview.data.insuredCount), notInApp: formatNumber(overview.data.notInApp) })
          ) : (
            <Skeleton className="h-4 w-72" />
          )
        }
        actions={
          <>
            <Link to="/hr/import" className={cn(buttonVariants({ variant: 'secondary' }), HR_BTN)}>
              <Upload className="h-4 w-4" aria-hidden />
              {t('hr.employees.importCsv')}
            </Link>
            <Link to="/hr/employees/new" className={cn(buttonVariants({ variant: 'primary' }), HR_BTN)}>
              <Plus className="h-4 w-4" aria-hidden />
              {t('hr.add.title')}
            </Link>
          </>
        }
      />

      <HrTasks />
      <OverviewCards overview={overview} />

      <div className="mb-6 flex items-start gap-3 rounded-card bg-sky p-4 text-sky-text">
        <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
        <p>{t('hr.employees.privacy')}</p>
      </div>

      <section className="rounded-card border border-border bg-surface" aria-label={t('hr.employees.listAria')}>
        <div className="flex flex-wrap items-center gap-3 border-b border-border-soft p-4">
          <div className="flex flex-wrap gap-2" role="group" aria-label={t('common.filter')}>
            {FILTERS.map((f) => (
              <button
                key={f.value || 'all'}
                type="button"
                aria-pressed={filter === f.value}
                onClick={() => setFilters({ filter: f.value || null })}
                className={cn(
                  'h-11 rounded-full border px-4 text-[14px] font-semibold transition-colors',
                  filter === f.value ? 'border-accent bg-accent-soft text-accent-text' : 'border-border text-text hover:bg-rail',
                )}
              >
                {f.label}
              </button>
            ))}
          </div>
          <SearchInput
            value={search}
            onChange={(v) => {
              setSearch(v);
              if (filters.page) setFilters({ page: null });
            }}
            placeholder={t('hr.employees.searchPlaceholder')}
            className="min-w-[220px] flex-1 [&_input]:h-11 [&_input]:rounded-btn"
          />
          <Button variant="secondary" className={HR_BTN} loading={exporter.isPending} onClick={onExport}>
            <Download className="h-4 w-4" aria-hidden />
            {t('hr.employees.exportCsv')}
          </Button>
        </div>
        <DataTable
          caption={t('hr.employees.caption')}
          density="client"
          columns={columns}
          rows={list.data?.items}
          rowKey={(e) => e.id}
          loading={list.isLoading}
          error={list.isError ? list.error : undefined}
          onRetry={() => void list.refetch()}
          sort={sort}
          onSortChange={(s) => setFilters({ sort: formatSort(s) })}
          page={page}
          pageSize={PAGE_SIZE}
          total={list.data?.total}
          onPageChange={(p) => setFilters({ page: p > 1 ? p : null })}
          empty={
            hasFilters ? (
              <EmptyState
                title={t('hr.employees.notFound')}
                description={t('hr.employees.notFoundHint')}
                action={
                  <Button
                    variant="secondary"
                    className={HR_BTN}
                    onClick={() => {
                      setSearch('');
                      setFilters({ filter: null });
                    }}
                  >
                    {t('hr.employees.resetFilters')}
                  </Button>
                }
              />
            ) : (
              <EmptyState
                title={t('hr.employees.empty')}
                description={t('hr.employees.emptyHint')}
                action={
                  <Link to="/hr/employees/new" className={cn(buttonVariants({ variant: 'primary' }), HR_BTN)}>
                    {t('hr.add.title')}
                  </Link>
                }
              />
            )
          }
        />
      </section>

      {excluding && <ExcludeDialog employee={excluding} onClose={() => setExcluding(null)} />}
      {familyOf && <EmployeeFamilyDialog employee={familyOf} onClose={() => setFamilyOf(null)} />}
    </>
  );
}

function OverviewCards({ overview }: { overview: ReturnType<typeof useHrOverview> }) {
  const invite = useInvite();
  if (overview.isLoading) {
    return (
      <div className="mb-6 grid gap-4 md:grid-cols-3" role="status" aria-label={t('hr.stats.loading')}>
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-[168px] rounded-card" />
        ))}
      </div>
    );
  }
  if (overview.isError || !overview.data) {
    return <ErrorState className="mb-6 rounded-card border border-border bg-surface" error={overview.error} onRetry={() => void overview.refetch()} />;
  }
  const o: HrOverview = overview.data;
  const remind = () =>
    invite.mutate('all_not_in_app', {
      // The count the server reminded: nobody without a phone (a child lives in the parent's app).
      onSuccess: (r) => (r.invited > 0 ? toast.success(t('hr.employees.remindedN', { n: r.invited })) : toast.info(t('hr.employees.remindedNone'))),
      onError: (err) => toast.error(errorMessage(err)),
    });

  return (
    <div className="mb-6 grid gap-4 md:grid-cols-3">
      <HrCard className="flex flex-col gap-3">
        <p className="text-muted">{t('hr.employees.nextInvoice')}</p>
        {o.nextInvoice ? (
          <>
            <p className="font-heading text-[26px] font-semibold num">{formatMoney(o.nextInvoice.amount)}</p>
            <p className="text-muted">
              {t('hr.employees.payBy', { date: formatDate(o.nextInvoice.dueDate), relative: formatRelativeDays(o.nextInvoice.dueDate) })}
            </p>
            <Button
              variant="secondary"
              className={cn(HR_BTN, 'mt-auto self-start')}
              onClick={() => {
                downloadPdf(invoicePdf(o.nextInvoice!, o.companyName, o.companyLegalForm), pdfFileName('invoice'));
                toast.success(t('hr.docs.invoiceDownloaded'));
              }}
            >
              <Download className="h-4 w-4" aria-hidden />
              {t('common.download')}
            </Button>
          </>
        ) : (
          <p className="font-heading text-[20px] font-semibold">{t('hr.employees.noUnpaid')}</p>
        )}
      </HrCard>

      <HrCard className="flex flex-col gap-3">
        <p className="text-muted">{t('hr.employees.companyPolicy')}</p>
        {o.policy ? (
          <>
            <p className="font-heading text-[26px] font-semibold">{o.policy.programName}</p>
            <p className="text-muted">
              № <span className="num">{o.policy.number}</span> · {formatDate(o.policy.startDate)} – {formatDate(o.policy.endDate)}
            </p>
          </>
        ) : (
          <p className="font-heading text-[20px] font-semibold">{t('hr.employees.noPolicy')}</p>
        )}
        <Link to="/hr/documents" className={cn(buttonVariants({ variant: 'secondary' }), HR_BTN, 'mt-auto self-start')}>
          <FileText className="h-4 w-4" aria-hidden />
          {t('common.documents')}
        </Link>
      </HrCard>

      <HrCard tone="peach" className="flex flex-col gap-3">
        <p className="font-semibold">{t('hr.employees.app')}</p>
        <p className="font-heading text-[22px] font-semibold leading-snug">
          {o.notInApp > 0
            ? tp('hr.employees.notInApp', o.notInApp)
            : t('hr.employees.allInApp')}
        </p>
        <Button
          className={cn(HR_BTN, 'mt-auto self-start bg-peach-text text-white')}
          disabled={o.notInApp === 0}
          loading={invite.isPending}
          onClick={remind}
        >
          <BellRing className="h-4 w-4" aria-hidden />
          {t('hr.employees.remindAll')}
        </Button>
      </HrCard>
    </div>
  );
}

function ExcludeDialog({ employee, onClose }: { employee: HrEmployee; onClose: () => void }) {
  const exclude = useExcludeEmployee();
  const overview = useHrOverview();
  const group = overview.data?.group;
  // The list holds employees; their active family members leave with them.
  const leaving = { employees: 1, family: employee.family.filter((m) => m.status === 'active').length };
  const dropsBelow = group ? exclusionDropsBelow(group, leaving, group) : false;
  const [date, setDate] = useState(() => formatDate(todayISO()));
  const [error, setError] = useState<string | undefined>();

  const submit = () => {
    const parsed = hrExcludeSchema.safeParse({ excludeFrom: date });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? t('hr.employees.dateFormat'));
      return;
    }
    setError(undefined);
    exclude.mutate(
      { id: employee.id, excludeFrom: parsed.data.excludeFrom },
      {
        onSuccess: () => {
          toast.success(t('hr.employees.excludeSent'));
          onClose();
        },
        onError: (err) => setError(errorMessage(err)),
      },
    );
  };

  return (
    <ConfirmDialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title={t('hr.employees.excludeTitle')}
      description={t('hr.employees.excludeText', { name: employee.fullName })}
      confirmLabel={t('hr.employees.sendRequest')}
      danger
      loading={exclude.isPending}
      onConfirm={submit}
    >
      {group && dropsBelow && (
        <p role="alert" data-testid="exclude-below-min" className="mb-3 rounded-card bg-warning-soft px-3 py-2 text-[13px] text-warning-text">
          {t('hr.employees.belowMinWarning', { min: group.min, n: groupSize({ employees: group.employees - leaving.employees, family: group.family - leaving.family }, group) })}
        </p>
      )}
      <Field label={t('hr.employees.excludeDate')} error={tm(error) || undefined}>
        {(f) => <MaskedInput mask="date" {...f} value={date} onChange={setDate} className="h-12" />}
      </Field>
    </ConfirmDialog>
  );
}
