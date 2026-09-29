import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Download, FileText, MoreHorizontal, Plus, Send, ShieldCheck, Upload, UserMinus, BellRing } from 'lucide-react';
import type { HrEmployee, HrOverview } from '@/shared/types/dto';
import { useExcludeEmployee, useHrEmployees, useHrOverview, useInvite } from '@/shared/api/queries/hr';
import { useExport } from '@/shared/api/queries/staff';
import { errorMessage } from '@/shared/api/client';
import { hrExcludeSchema } from '@/shared/schemas/forms';
import { PROGRAM_LABEL } from '@/shared/domain/labels';
import { formatDate, formatMoney, formatNumber, formatRelativeDays, plural, todayISO } from '@/shared/lib/format';
import { downloadText, exportFileName } from '@/shared/lib/csv';
import { useDebounced, useDocumentTitle, useUrlFilters } from '@/shared/lib/hooks';
import { Button, buttonVariants } from '@/shared/ui/button';
import { Avatar } from '@/shared/ui/chips';
import { DataTable, formatSort, parseSort, type Column } from '@/shared/ui/data-table';
import { Menu, MenuContent, MenuItem, MenuTrigger } from '@/shared/ui/dropdown';
import { SearchInput } from '@/shared/ui/search-input';
import { EmptyState, ErrorState, Skeleton } from '@/shared/ui/states';
import { ConfirmDialog } from '@/shared/ui/confirm-dialog';
import { Field } from '@/shared/ui/input';
import { MaskedInput } from '@/shared/ui/masked-input';
import { toast } from '@/shared/ui/toast';
import { cn } from '@/shared/lib/cn';
import { invoicePdf, downloadPdf, pdfFileName } from '../pdf';
import { AppStatusChip, HR_BTN, HrCard, HrHeader } from '../ui';

const PAGE_SIZE = 25;
const FILTER_KEYS = ['filter', 'page', 'sort'] as const;
const FILTERS = [
  { value: '', label: 'Все' },
  { value: 'not_in_app', label: 'Не в приложении' },
  { value: 'recent', label: 'Добавлены недавно' },
] as const;

export default function EmployeesPage() {
  useDocumentTitle('Сотрудники');
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

  const onInvite = (e: HrEmployee) =>
    invite.mutate([e.id], {
      onSuccess: () => toast.success('Приглашение отправлено'),
      onError: (err) => toast.error(errorMessage(err)),
    });

  const onExport = () =>
    exporter.mutate('hr_employees', {
      onSuccess: (csv) => {
        downloadText(csv, exportFileName('employees'));
        toast.success('Список экспортирован в CSV');
      },
      onError: (err) => toast.error(errorMessage(err)),
    });

  const columns: Column<HrEmployee>[] = [
    {
      key: 'name',
      header: 'Сотрудник',
      sortKey: 'fullName',
      cell: (e) => (
        <div className={cn('flex items-center gap-3 py-2', e.status === 'excluded' && 'opacity-60')}>
          <Avatar name={e.fullName} className="h-10 w-10 text-[13px]" />
          <div className="min-w-0">
            <p className="truncate font-semibold">{e.fullName}</p>
            <p className="truncate text-[13px] text-muted">
              {e.status === 'excluded' && e.excludedFrom ? `Исключён с ${formatDate(e.excludedFrom)}` : e.position}
            </p>
          </div>
        </div>
      ),
    },
    { key: 'program', header: 'Программа', cell: (e) => <span className={cn(e.status === 'excluded' && 'text-muted')}>{PROGRAM_LABEL[e.program]}</span> },
    { key: 'from', header: 'Застрахован с', sortKey: 'insuredFrom', cell: (e) => <span className="num">{formatDate(e.insuredFrom)}</span> },
    {
      key: 'family',
      header: 'Семья',
      sortKey: 'familyMembersCount',
      cell: (e) =>
        e.familyMembersCount > 0 ? `${e.familyMembersCount} ${plural(e.familyMembersCount, ['человек', 'человека', 'человек'])}` : <span className="text-muted">—</span>,
    },
    {
      key: 'app',
      header: 'Приложение',
      sortKey: 'appStatus',
      cell: (e) => (e.status === 'excluded' ? <span className="text-muted">Исключён</span> : <AppStatusChip status={e.appStatus} />),
    },
    {
      key: 'menu',
      header: '',
      align: 'right',
      className: 'w-14',
      cell: (e) =>
        e.status === 'excluded' ? null : (
          <Menu>
            <MenuTrigger asChild>
              <Button variant="ghost" size="icon-lg" aria-label="Действия с сотрудником">
                <MoreHorizontal className="h-5 w-5" aria-hidden />
              </Button>
            </MenuTrigger>
            <MenuContent>
              <MenuItem className="min-h-11" disabled={e.appStatus === 'active'} onSelect={() => onInvite(e)}>
                <Send className="h-4 w-4" aria-hidden />
                Пригласить
              </MenuItem>
              <MenuItem className="min-h-11" danger onSelect={() => setExcluding(e)}>
                <UserMinus className="h-4 w-4" aria-hidden />
                Исключить с даты…
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
        title="Сотрудники"
        subtitle={
          overview.data ? (
            `${formatNumber(overview.data.insuredCount)} застрахованы · ${formatNumber(overview.data.notInApp)} ещё не установили приложение`
          ) : (
            <Skeleton className="h-4 w-72" />
          )
        }
        actions={
          <>
            <Link to="/hr/import" className={cn(buttonVariants({ variant: 'secondary' }), HR_BTN)}>
              <Upload className="h-4 w-4" aria-hidden />
              Загрузить из CSV
            </Link>
            <Link to="/hr/employees/new" className={cn(buttonVariants({ variant: 'primary' }), HR_BTN)}>
              <Plus className="h-4 w-4" aria-hidden />
              Добавить сотрудника
            </Link>
          </>
        }
      />

      <OverviewCards overview={overview} />

      <div className="mb-6 flex items-start gap-3 rounded-card bg-sky p-4 text-sky-text">
        <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
        <p>Вы видите, кто застрахован, но не видите диагнозы, визиты и возмещения сотрудников. Это медицинская тайна, и доступа к ней у работодателя нет</p>
      </div>

      <section className="rounded-card border border-border bg-surface" aria-label="Список сотрудников">
        <div className="flex flex-wrap items-center gap-3 border-b border-border-soft p-4">
          <div className="flex flex-wrap gap-2" role="group" aria-label="Фильтр">
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
            placeholder="Поиск по ФИО или должности"
            className="min-w-[220px] flex-1 [&_input]:h-11 [&_input]:rounded-btn"
          />
          <Button variant="secondary" className={HR_BTN} loading={exporter.isPending} onClick={onExport}>
            <Download className="h-4 w-4" aria-hidden />
            Экспорт в CSV
          </Button>
        </div>
        <DataTable
          caption="Сотрудники компании"
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
                title="Никого не нашли"
                description="Измените запрос или сбросьте фильтр"
                action={
                  <Button
                    variant="secondary"
                    className={HR_BTN}
                    onClick={() => {
                      setSearch('');
                      setFilters({ filter: null });
                    }}
                  >
                    Сбросить фильтры
                  </Button>
                }
              />
            ) : (
              <EmptyState
                title="Сотрудников пока нет"
                description="Добавьте сотрудников по одному или загрузите список из CSV"
                action={
                  <Link to="/hr/employees/new" className={cn(buttonVariants({ variant: 'primary' }), HR_BTN)}>
                    Добавить сотрудника
                  </Link>
                }
              />
            )
          }
        />
      </section>

      {excluding && <ExcludeDialog employee={excluding} onClose={() => setExcluding(null)} />}
    </>
  );
}

function OverviewCards({ overview }: { overview: ReturnType<typeof useHrOverview> }) {
  const invite = useInvite();
  if (overview.isLoading) {
    return (
      <div className="mb-6 grid gap-4 md:grid-cols-3" role="status" aria-label="Загрузка">
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
      onSuccess: () => toast.success('Напоминание отправлено'),
      onError: (err) => toast.error(errorMessage(err)),
    });

  return (
    <div className="mb-6 grid gap-4 md:grid-cols-3">
      <HrCard className="flex flex-col gap-3">
        <p className="text-muted">Следующий счёт</p>
        {o.nextInvoice ? (
          <>
            <p className="font-heading text-[26px] font-semibold num">{formatMoney(o.nextInvoice.amount)}</p>
            <p className="text-muted">
              Оплатить до {formatDate(o.nextInvoice.dueDate)} · {formatRelativeDays(o.nextInvoice.dueDate)}
            </p>
            <Button
              variant="secondary"
              className={cn(HR_BTN, 'mt-auto self-start')}
              onClick={() => {
                downloadPdf(invoicePdf(o.nextInvoice!, o.companyName), pdfFileName('invoice'));
                toast.success('Счёт скачан');
              }}
            >
              <Download className="h-4 w-4" aria-hidden />
              Скачать
            </Button>
          </>
        ) : (
          <p className="font-heading text-[20px] font-semibold">Неоплаченных счетов нет</p>
        )}
      </HrCard>

      <HrCard className="flex flex-col gap-3">
        <p className="text-muted">Полис компании</p>
        {o.policy ? (
          <>
            <p className="font-heading text-[26px] font-semibold">{o.policy.programName}</p>
            <p className="text-muted">
              № <span className="num">{o.policy.number}</span> · {formatDate(o.policy.startDate)} – {formatDate(o.policy.endDate)}
            </p>
          </>
        ) : (
          <p className="font-heading text-[20px] font-semibold">Действующего полиса нет</p>
        )}
        <Link to="/hr/documents" className={cn(buttonVariants({ variant: 'secondary' }), HR_BTN, 'mt-auto self-start')}>
          <FileText className="h-4 w-4" aria-hidden />
          Документы
        </Link>
      </HrCard>

      <HrCard tone="peach" className="flex flex-col gap-3">
        <p className="font-semibold">Приложение</p>
        <p className="font-heading text-[22px] font-semibold leading-snug">
          {o.notInApp > 0
            ? `${formatNumber(o.notInApp)} ${plural(o.notInApp, ['сотрудник', 'сотрудника', 'сотрудников'])} ещё не в приложении`
            : 'Все сотрудники уже в приложении'}
        </p>
        <Button
          className={cn(HR_BTN, 'mt-auto self-start bg-peach-text text-white')}
          disabled={o.notInApp === 0}
          loading={invite.isPending}
          onClick={remind}
        >
          <BellRing className="h-4 w-4" aria-hidden />
          Напомнить всем
        </Button>
      </HrCard>
    </div>
  );
}

function ExcludeDialog({ employee, onClose }: { employee: HrEmployee; onClose: () => void }) {
  const exclude = useExcludeEmployee();
  const [date, setDate] = useState(() => formatDate(todayISO()));
  const [error, setError] = useState<string | undefined>();

  const submit = () => {
    const parsed = hrExcludeSchema.safeParse({ excludeFrom: date });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Дата в формате ДД.ММ.ГГГГ');
      return;
    }
    setError(undefined);
    exclude.mutate(
      { id: employee.id, excludeFrom: parsed.data.excludeFrom },
      {
        onSuccess: () => {
          toast.success('Сотрудник исключён');
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
      title="Исключить сотрудника?"
      description={
        <>
          {employee.fullName} перестанет быть застрахованным с выбранной даты: полис и карточка для клиники перестанут действовать, записи к врачу
          и новые возмещения станут недоступны. Отменить исключение можно только через менеджера МИГ.
        </>
      }
      confirmLabel="Исключить"
      danger
      loading={exclude.isPending}
      onConfirm={submit}
    >
      <Field label="Дата исключения" error={error}>
        {(f) => <MaskedInput mask="date" {...f} value={date} onChange={setDate} className="h-12" />}
      </Field>
    </ConfirmDialog>
  );
}
