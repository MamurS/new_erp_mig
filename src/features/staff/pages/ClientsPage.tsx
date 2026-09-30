import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowDownUp, Columns3, Mail, Plus } from 'lucide-react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { z } from 'zod';
import type { Client, ClientStatus, ProgramCode } from '@/shared/types';
import { clientCreateSchema } from '@/shared/schemas/forms';
import { useClient, useClients, useCreateClient } from '@/shared/api/queries/staff';
import { errorMessage } from '@/shared/api/client';
import { useCan } from '@/shared/auth/guards';
import { CLIENT_STATUS_LABEL, PROGRAM_LABEL } from '@/shared/domain/labels';
import { formatDateTime, formatMoney, formatMoneyShort, formatNumber, formatPercent, plural } from '@/shared/lib/format';
import { useDebounced, useDocumentTitle, useUrlFilters } from '@/shared/lib/hooks';
import { cn } from '@/shared/lib/cn';
import { maskPinfl } from '@/shared/lib/masks';
import { Button } from '@/shared/ui/button';
import { Avatar, StatusDot } from '@/shared/ui/chips';
import { DataTable, formatSort, parseSort, type Column } from '@/shared/ui/data-table';
import { Modal } from '@/shared/ui/dialog';
import { Menu, MenuCheckbox, MenuContent, MenuItem, MenuLabel, MenuTrigger } from '@/shared/ui/dropdown';
import { FilterChip } from '@/shared/ui/filter-chip';
import { Field, Input, Select } from '@/shared/ui/input';
import { MaskedInput } from '@/shared/ui/masked-input';
import { Kv } from '@/shared/ui/page';
import { SearchInput } from '@/shared/ui/search-input';
import { SidePanel } from '@/shared/ui/side-panel';
import { EmptyState, ErrorState, SkeletonRows } from '@/shared/ui/states';
import { toast } from '@/shared/ui/toast';
import { CLIENT_TONE } from '../components/tones';
import { ExportButton } from '../components/ExportButton';
import { MiniKpi } from '../components/KpiCard';
import { kpNewPath } from '@/features/kp/paths';
import { useTopbar } from '../topbar';
import { HrLetterDialog } from '../components/HrLetterDialog';
import { LossBar, RenewalCell } from '../components/cells';
import { useDmsParam } from '@/shared/api/queries/params';

const VIEWS = [
  { key: '', label: 'Все' },
  { key: 'mine', label: 'Мои' },
  { key: 'q4', label: 'Продления Q4' },
  { key: 'loss', label: 'Убыточность > 80%' },
] as const;

const SORTS = [
  { key: 'name:asc', label: 'По названию' },
  { key: 'premium:desc', label: 'По премии' },
  { key: 'renewalDate:asc', label: 'По дате продления' },
  { key: 'lossRatio:desc', label: 'По убыточности' },
  { key: 'insuredCount:desc', label: 'По числу застрахованных' },
];

const HIDEABLE = [
  { key: 'program', label: 'Программа' },
  { key: 'insured', label: 'Застрахованных' },
  { key: 'premium', label: 'Премия' },
  { key: 'renewal', label: 'Продление' },
  { key: 'loss', label: 'Убыточность' },
  { key: 'manager', label: 'Менеджер' },
  { key: 'status', label: 'Статус' },
];

export default function ClientsPage() {
  useDocumentTitle('Клиенты');
  const canWrite = useCan('clients.write');
  const [createOpen, setCreateOpen] = useState(false);
  useTopbar(
    [{ label: 'Клиенты' }],
    canWrite ? (
      <Button onClick={() => setCreateOpen(true)}>
        <Plus className="h-3.5 w-3.5" aria-hidden /> Новый клиент
      </Button>
    ) : null,
  );
  const [f, setF] = useUrlFilters(['view', 'status', 'program', 'managerId', 'sort', 'page', 'panel'] as const);
  const [search, setSearch] = useState('');
  const q = useDebounced(search.trim());
  const [hidden, setHidden] = useState<string[]>([]);
  const page = Number(f.page) || 1;
  const sort = parseSort(f.sort || 'name:asc');
  const params = { view: f.view, status: f.status, program: f.program, managerId: f.managerId, sort: formatSort(sort), page, pageSize: 25, q };
  const list = useClients(params);
  const all = useClients({ pageSize: 100 });
  const managers = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of all.data?.items ?? []) m.set(c.managerId, c.managerName);
    return [...m.entries()].map(([value, label]) => ({ value, label }));
  }, [all.data]);
  const panelId = f.panel || null;
  const navigate = useNavigate();

  const columns: Column<Client>[] = [
    {
      key: 'name',
      header: 'Клиент',
      sortKey: 'name',
      cell: (c) => (
        <span className="flex items-center gap-2">
          <Avatar name={c.name} square />
          <span className="min-w-0">
            <span className="block truncate font-medium">{c.name}</span>
            <span className="block text-[12px] text-muted">{c.legalForm}</span>
          </span>
        </span>
      ),
    },
    { key: 'program', header: 'Программа', sortKey: 'program', cell: (c) => (c.program ? PROGRAM_LABEL[c.program] : <span className="text-muted">—</span>) },
    { key: 'insured', header: 'Застрахованных', sortKey: 'insuredCount', align: 'right', cell: (c) => <span className="num">{formatNumber(c.insuredCount)}</span> },
    { key: 'premium', header: 'Премия', sortKey: 'premium', align: 'right', cell: (c) => <span className="num whitespace-nowrap">{c.premium ? formatMoneyShort(c.premium) : '—'}</span> },
    { key: 'renewal', header: 'Продление', sortKey: 'renewalDate', cell: (c) => <RenewalCell date={c.renewalDate} /> },
    { key: 'loss', header: 'Убыточность', sortKey: 'lossRatio', cell: (c) => <LossBar ratio={c.lossRatio} /> },
    {
      key: 'manager',
      header: 'Менеджер',
      sortKey: 'managerName',
      cell: (c) => (
        <span className="flex items-center gap-1.5" title={c.managerName}>
          <Avatar name={c.managerName} className="h-6 w-6 text-[10px]" />
          <span className="hidden truncate 2xl:inline">{c.managerName}</span>
        </span>
      ),
    },
    { key: 'status', header: 'Статус', sortKey: 'status', cell: (c) => <StatusDot tone={CLIENT_TONE[c.status]}>{CLIENT_STATUS_LABEL[c.status]}</StatusDot> },
  ];

  return (
    <div className="flex gap-0">
      <div className="min-w-0 flex-1">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-[22px] font-bold">Клиенты</h1>
          <div className="flex items-center gap-2">
            <SearchInput value={search} onChange={setSearch} placeholder="Название или ИНН" slashFocus className="w-64" />
          </div>
        </div>
        <div role="tablist" aria-label="Сохранённые виды" className="mb-3 flex flex-wrap gap-1">
          {VIEWS.map((v) => (
            <button
              key={v.key}
              role="tab"
              type="button"
              aria-selected={f.view === v.key}
              onClick={() => setF({ view: v.key })}
              className={cn('rounded-btn px-2.5 py-1', f.view === v.key ? 'bg-text text-white' : 'text-muted hover:bg-rail')}
            >
              {v.label}
            </button>
          ))}
          {f.view === 'renewals' && (
            <button type="button" role="tab" aria-selected className="rounded-btn bg-text px-2.5 py-1 text-white">
              Продления &lt; 30 дн без КП
            </button>
          )}
        </div>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <FilterChip
            label="Статус"
            options={(Object.keys(CLIENT_STATUS_LABEL) as ClientStatus[]).map((s) => ({ value: s, label: CLIENT_STATUS_LABEL[s] }))}
            selected={f.status ? f.status.split(',') : []}
            onChange={(v) => setF({ status: v.join(',') })}
          />
          <FilterChip
            label="Программа"
            options={(Object.keys(PROGRAM_LABEL) as ProgramCode[]).map((s) => ({ value: s, label: PROGRAM_LABEL[s] }))}
            selected={f.program ? f.program.split(',') : []}
            onChange={(v) => setF({ program: v.join(',') })}
          />
          <FilterChip label="Менеджер" options={managers} selected={f.managerId ? [f.managerId] : []} onChange={(v) => setF({ managerId: v[v.length - 1] ?? '' })} />
          <div className="ml-auto flex items-center gap-2">
            <Menu>
              <MenuTrigger asChild>
                <Button variant="secondary">
                  <ArrowDownUp className="h-3.5 w-3.5" aria-hidden /> Сортировка
                </Button>
              </MenuTrigger>
              <MenuContent>
                {SORTS.map((s) => (
                  <MenuItem key={s.key} onSelect={() => setF({ sort: s.key })} className={cn(formatSort(sort) === s.key && 'font-semibold')}>
                    {s.label}
                  </MenuItem>
                ))}
              </MenuContent>
            </Menu>
            <Menu>
              <MenuTrigger asChild>
                <Button variant="secondary">
                  <Columns3 className="h-3.5 w-3.5" aria-hidden /> Колонки
                </Button>
              </MenuTrigger>
              <MenuContent>
                <MenuLabel>Показать колонки</MenuLabel>
                {HIDEABLE.map((c) => (
                  <MenuCheckbox key={c.key} checked={!hidden.includes(c.key)} onCheckedChange={(v) => setHidden((h) => (v ? h.filter((x) => x !== c.key) : [...h, c.key]))}>
                    {c.label}
                  </MenuCheckbox>
                ))}
              </MenuContent>
            </Menu>
            <ExportButton type="clients" />
          </div>
        </div>
        <div className="rounded-card border border-border bg-surface">
          <DataTable
            caption="Клиенты"
            columns={columns}
            hiddenColumns={hidden}
            rows={list.data?.items}
            rowKey={(c) => c.id}
            loading={list.isLoading}
            error={list.error}
            onRetry={() => void list.refetch()}
            sort={sort}
            onSortChange={(s) => setF({ sort: formatSort(s) })}
            onRowClick={(c) => setF({ panel: c.id }, false)}
            onEscape={() => setF({ panel: null }, false)}
            activeKey={panelId}
            page={page}
            pageSize={25}
            total={list.data?.total}
            onPageChange={(p) => setF({ page: p }, false)}
            empty={
              <EmptyState
                title="Клиенты не найдены"
                description="Измените фильтры или строку поиска"
                action={
                  <Button variant="secondary" onClick={() => { setSearch(''); setF({ view: '', status: '', program: '', managerId: '' }); }}>
                    Сбросить фильтры
                  </Button>
                }
              />
            }
            footer={
              list.data && (
                <span>
                  {formatNumber(list.data.total)} {plural(list.data.total, ['клиент', 'клиента', 'клиентов'])} · премия всего {formatMoney(list.data.totalPremium)}
                </span>
              )
            }
          />
        </div>
      </div>
      {panelId && <ClientPanel id={panelId} onClose={() => setF({ panel: null }, false)} onOpen={() => navigate(`/staff/clients/${panelId}`)} />}
      <CreateClientDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}

function ClientPanel({ id, onClose, onOpen }: { id: string; onClose: () => void; onOpen: () => void }) {
  const q = useClient(id);
  const lossWarn = useDmsParam('lossRatioWarn');
  const canOffer = useCan('kp.create');
  const navigate = useNavigate();
  const [letterOpen, setLetterOpen] = useState(false);
  const c = q.data;
  return (
    <SidePanel open onClose={onClose} title={c?.name ?? 'Клиент'} className="lg:ml-4 lg:rounded-card lg:border">
      {q.isLoading ? (
        <SkeletonRows rows={8} />
      ) : q.isError || !c ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-2">
            <StatusDot tone={CLIENT_TONE[c.status]}>{CLIENT_STATUS_LABEL[c.status]}</StatusDot>
            <span className="text-muted">· ИНН <span className="num">{c.inn}</span></span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <MiniKpi label="Застрахованных" value={formatNumber(c.insuredCount)} />
            <MiniKpi label="Премия" value={c.premium ? formatMoneyShort(c.premium) : '—'} />
            <MiniKpi label="Убыточность" value={c.lossRatio === null ? '—' : formatPercent(c.lossRatio)} tone={(c.lossRatio ?? 0) >= lossWarn ? 'warning' : 'default'} />
            <MiniKpi label="Программа" value={c.program ? PROGRAM_LABEL[c.program] : '—'} />
          </div>
          <section>
            <h3 className="mb-1 text-[14px] font-bold">Продление</h3>
            <p className="mb-2 text-muted">
              {c.renewalDate ? (
                <>
                  Продление <RenewalCell date={c.renewalDate} />
                  {c.hasRenewalOffer ? ' · КП подготовлено' : ' · КП ещё нет'}
                </>
              ) : (
                'Нет действующего полиса'
              )}
            </p>
            <div className="flex flex-wrap gap-2">
              {canOffer && <Button onClick={() => navigate(kpNewPath(c.id, c.activePolicyId))}>Подготовить КП</Button>}
              <Button variant="secondary" onClick={() => setLetterOpen(true)}>
                <Mail className="h-3.5 w-3.5" aria-hidden /> Письмо HR
              </Button>
            </div>
          </section>
          <section>
            <h3 className="mb-1 text-[14px] font-bold">Контакт HR</h3>
            <dl>
              <Kv label="Имя">{c.hrContact.name}</Kv>
              <Kv label="Телефон"><span className="num">{c.hrContact.phoneMasked}</span></Kv>
              <Kv label="Email">{c.hrContact.emailMasked}</Kv>
            </dl>
          </section>
          <section>
            <h3 className="mb-1 text-[14px] font-bold">Активность</h3>
            <ol className="flex flex-col gap-2 border-l border-border pl-3">
              {c.activity.map((a, i) => (
                <li key={i}>
                  <div>{a.text}</div>
                  <div className="text-[12px] text-muted">{formatDateTime(a.at)}</div>
                </li>
              ))}
            </ol>
          </section>
          <Button variant="secondary" onClick={onOpen}>
            Открыть карточку
          </Button>
          <HrLetterDialog open={letterOpen} onOpenChange={setLetterOpen} clientId={c.id} clientName={c.name} />
        </div>
      )}
    </SidePanel>
  );
}

type NewClient = z.input<typeof clientCreateSchema>;

function CreateClientDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const create = useCreateClient();
  const navigate = useNavigate();
  const form = useForm<NewClient>({ resolver: zodResolver(clientCreateSchema), defaultValues: { legalForm: 'ООО', name: '', inn: '', status: 'draft' }, mode: 'onTouched' });
  const onSubmit = form.handleSubmit(async (v) => {
    try {
      const c = await create.mutateAsync({ ...v, status: v.status ?? 'draft' });
      toast.success('Клиент добавлен');
      onOpenChange(false);
      form.reset();
      navigate(`/staff/clients/${c.id}`);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  });
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Новый клиент"
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Отмена
          </Button>
          <Button onClick={() => void onSubmit()} loading={create.isPending}>
            Добавить клиента
          </Button>
        </>
      }
    >
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-3">
        <div className="grid grid-cols-[120px_1fr] gap-3">
          <Field label="Форма">
            {(a) => (
              <Select {...a} {...form.register('legalForm')}>
                {['ООО', 'АО', 'СП ООО', 'ЧП'].map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Название" error={form.formState.errors.name?.message}>
            {(a) => <Input {...a} maxLength={120} {...form.register('name')} />}
          </Field>
        </div>
        <Field label="ИНН" error={form.formState.errors.inn?.message}>
          {(a) => (
            <Controller
              control={form.control}
              name="inn"
              render={({ field }) => <MaskedInput {...a} mask="pinfl" placeholder="9 цифр" value={field.value} onChange={(v) => field.onChange(maskPinfl(v).slice(0, 9))} onBlur={field.onBlur} />}
            />
          )}
        </Field>
        <Field label="Статус">
          {(a) => (
            <Select {...a} {...form.register('status')}>
              <option value="draft">Черновик</option>
              <option value="negotiation">Переговоры</option>
            </Select>
          )}
        </Field>
      </form>
    </Modal>
  );
}

