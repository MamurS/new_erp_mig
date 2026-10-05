import { t, tm, tp, type I18nKey } from '@/i18n';
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
import { formatDateTime, formatMoney, formatMoneyShort, formatNumber, formatPercent } from '@/shared/lib/format';
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

const VIEWS = ['', 'mine', 'q4', 'loss'] as const;

function viewLabel(view: (typeof VIEWS)[number], lossWarn: number): string {
  if (view === 'mine') return t('staff.clients.view.mine');
  if (view === 'q4') return t('staff.clients.view.q4');
  if (view === 'loss') return t('staff.clients.view.loss', { pct: formatPercent(lossWarn) });
  return t('common.all');
}

const SORTS: { key: string; label: I18nKey }[] = [
  { key: 'name:asc', label: 'staff.clients.sort.name' },
  { key: 'premium:desc', label: 'staff.clients.sort.premium' },
  { key: 'renewalDate:asc', label: 'staff.clients.sort.renewal' },
  { key: 'lossRatio:desc', label: 'staff.clients.sort.loss' },
  { key: 'insuredCount:desc', label: 'staff.clients.sort.insured' },
];

const HIDEABLE: { key: string; label: I18nKey }[] = [
  { key: 'program', label: 'common.program' },
  { key: 'insured', label: 'staff.clients.col.insured' },
  { key: 'premium', label: 'common.premium' },
  { key: 'renewal', label: 'staff.clients.col.renewal' },
  { key: 'loss', label: 'staff.clients.col.loss' },
  { key: 'manager', label: 'common.manager' },
  { key: 'status', label: 'common.status' },
];

export default function ClientsPage() {
  useDocumentTitle(t('staff.clients.title'));
  const canWrite = useCan('clients.write');
  const lossWarn = useDmsParam('lossRatioWarn');
  const [createOpen, setCreateOpen] = useState(false);
  useTopbar(
    [{ label: t('staff.clients.title') }],
    canWrite ? (
      <Button onClick={() => setCreateOpen(true)}>
        <Plus className="h-3.5 w-3.5" aria-hidden /> {t('staff.clients.newClient')}
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
      header: t('common.client'),
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
    { key: 'program', header: t('common.program'), sortKey: 'program', cell: (c) => (c.program ? PROGRAM_LABEL[c.program] : <span className="text-muted">—</span>) },
    { key: 'insured', header: t('staff.clients.col.insured'), sortKey: 'insuredCount', align: 'right', cell: (c) => <span className="num">{formatNumber(c.insuredCount)}</span> },
    { key: 'premium', header: t('common.premium'), sortKey: 'premium', align: 'right', cell: (c) => <span className="num whitespace-nowrap">{c.premium ? formatMoneyShort(c.premium) : '—'}</span> },
    { key: 'renewal', header: t('staff.clients.col.renewal'), sortKey: 'renewalDate', cell: (c) => <RenewalCell date={c.renewalDate} /> },
    { key: 'loss', header: t('staff.clients.col.loss'), sortKey: 'lossRatio', cell: (c) => <LossBar ratio={c.lossRatio} /> },
    {
      key: 'manager',
      header: t('common.manager'),
      sortKey: 'managerName',
      cell: (c) => (
        <span className="flex items-center gap-1.5" title={c.managerName}>
          <Avatar name={c.managerName} className="h-6 w-6 text-[10px]" />
          <span className="hidden truncate 2xl:inline">{c.managerName}</span>
        </span>
      ),
    },
    { key: 'status', header: t('common.status'), sortKey: 'status', cell: (c) => <StatusDot tone={CLIENT_TONE[c.status]}>{CLIENT_STATUS_LABEL[c.status]}</StatusDot> },
  ];

  return (
    <div className="flex gap-0">
      <div className="min-w-0 flex-1">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-[22px] font-bold">{t('staff.clients.title')}</h1>
          <div className="flex items-center gap-2">
            <SearchInput value={search} onChange={setSearch} placeholder={t('staff.clients.searchPlaceholder')} slashFocus className="w-64" />
          </div>
        </div>
        <div role="tablist" aria-label={t('staff.clients.savedViews')} className="mb-3 flex flex-wrap gap-1">
          {VIEWS.map((v) => (
            <button
              key={v}
              role="tab"
              type="button"
              aria-selected={f.view === v}
              onClick={() => setF({ view: v })}
              className={cn('rounded-btn px-2.5 py-1', f.view === v ? 'bg-text text-white' : 'text-muted hover:bg-rail')}
            >
              {viewLabel(v, lossWarn)}
            </button>
          ))}
          {f.view === 'renewals' && (
            <button type="button" role="tab" aria-selected className="rounded-btn bg-text px-2.5 py-1 text-white">
              {t('staff.clients.view.renewals')}
            </button>
          )}
        </div>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <FilterChip
            label={t('common.status')}
            options={(Object.keys(CLIENT_STATUS_LABEL) as ClientStatus[]).map((s) => ({ value: s, label: CLIENT_STATUS_LABEL[s] }))}
            selected={f.status ? f.status.split(',') : []}
            onChange={(v) => setF({ status: v.join(',') })}
          />
          <FilterChip
            label={t('common.program')}
            options={(Object.keys(PROGRAM_LABEL) as ProgramCode[]).map((s) => ({ value: s, label: PROGRAM_LABEL[s] }))}
            selected={f.program ? f.program.split(',') : []}
            onChange={(v) => setF({ program: v.join(',') })}
          />
          <FilterChip label={t('common.manager')} options={managers} selected={f.managerId ? [f.managerId] : []} onChange={(v) => setF({ managerId: v[v.length - 1] ?? '' })} />
          <div className="ml-auto flex items-center gap-2">
            <Menu>
              <MenuTrigger asChild>
                <Button variant="secondary">
                  <ArrowDownUp className="h-3.5 w-3.5" aria-hidden /> {t('staff.clients.sortButton')}
                </Button>
              </MenuTrigger>
              <MenuContent>
                {SORTS.map((s) => (
                  <MenuItem key={s.key} onSelect={() => setF({ sort: s.key })} className={cn(formatSort(sort) === s.key && 'font-semibold')}>
                    {t(s.label)}
                  </MenuItem>
                ))}
              </MenuContent>
            </Menu>
            <Menu>
              <MenuTrigger asChild>
                <Button variant="secondary">
                  <Columns3 className="h-3.5 w-3.5" aria-hidden /> {t('staff.clients.columnsButton')}
                </Button>
              </MenuTrigger>
              <MenuContent>
                <MenuLabel>{t('staff.clients.showColumns')}</MenuLabel>
                {HIDEABLE.map((c) => (
                  <MenuCheckbox key={c.key} checked={!hidden.includes(c.key)} onCheckedChange={(v) => setHidden((h) => (v ? h.filter((x) => x !== c.key) : [...h, c.key]))}>
                    {t(c.label)}
                  </MenuCheckbox>
                ))}
              </MenuContent>
            </Menu>
            <ExportButton type="clients" />
          </div>
        </div>
        <div className="rounded-card border border-border bg-surface">
          <DataTable
            caption={t('staff.clients.title')}
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
                title={t('staff.clients.notFound')}
                description={t('staff.clients.notFoundHint')}
                action={
                  <Button variant="secondary" onClick={() => { setSearch(''); setF({ view: '', status: '', program: '', managerId: '' }); }}>
                    {t('staff.clients.resetFilters')}
                  </Button>
                }
              />
            }
            footer={
              list.data && (
                <span>
                  {tp('staff.clients.footer', list.data.total, { premium: formatMoney(list.data.totalPremium) })}
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
    <SidePanel open onClose={onClose} title={c?.name ?? t('common.client')} className="lg:ml-4 lg:rounded-card lg:border">
      {q.isLoading ? (
        <SkeletonRows rows={8} />
      ) : q.isError || !c ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-2">
            <StatusDot tone={CLIENT_TONE[c.status]}>{CLIENT_STATUS_LABEL[c.status]}</StatusDot>
            <span className="text-muted">{t('staff.clients.innLabel')}<span className="num">{c.inn}</span></span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <MiniKpi label={t('staff.clients.col.insured')} value={formatNumber(c.insuredCount)} />
            <MiniKpi label={t('common.premium')} value={c.premium ? formatMoneyShort(c.premium) : '—'} />
            <MiniKpi label={t('staff.clients.col.loss')} value={c.lossRatio === null ? '—' : formatPercent(c.lossRatio)} tone={(c.lossRatio ?? 0) >= lossWarn ? 'warning' : 'default'} />
            <MiniKpi label={t('common.program')} value={c.program ? PROGRAM_LABEL[c.program] : '—'} />
          </div>
          <section>
            <h3 className="mb-1 text-[14px] font-bold">{t('staff.clients.col.renewal')}</h3>
            <p className="mb-2 text-muted">
              {c.renewalDate ? (
                <>
                  {t('staff.clients.renewalPrefix')}
                  <RenewalCell date={c.renewalDate} />
                  {c.hasRenewalOffer ? t('staff.clients.offerReady') : t('staff.clients.offerMissing')}
                </>
              ) : (
                t('staff.clients.noActivePolicy')
              )}
            </p>
            <div className="flex flex-wrap gap-2">
              {canOffer && <Button onClick={() => navigate(kpNewPath(c.id, c.activePolicyId))}>{t('staff.dashboard.prepareOffer')}</Button>}
              <Button variant="secondary" onClick={() => setLetterOpen(true)}>
                <Mail className="h-3.5 w-3.5" aria-hidden /> {t('staff.hrLetter.title')}
              </Button>
            </div>
          </section>
          <section>
            <h3 className="mb-1 text-[14px] font-bold">{t('staff.clients.hrContact')}</h3>
            <dl>
              <Kv label={t('staff.clients.hrName')}>{c.hrContact.name}</Kv>
              <Kv label={t('common.phone')}><span className="num">{c.hrContact.phoneMasked}</span></Kv>
              <Kv label={t('common.email')}>{c.hrContact.emailMasked}</Kv>
            </dl>
          </section>
          <section>
            <h3 className="mb-1 text-[14px] font-bold">{t('staff.clients.activity')}</h3>
            <ol className="flex flex-col gap-2 border-l border-border pl-3">
              {c.activity.map((a, i) => (
                <li key={i}>
                  <div>{tm(a.text)}</div>
                  <div className="text-[12px] text-muted">{formatDateTime(a.at)}</div>
                </li>
              ))}
            </ol>
          </section>
          <Button variant="secondary" onClick={onOpen}>
            {t('staff.clients.openCard')}
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
  const form = useForm<NewClient>({
    resolver: zodResolver(clientCreateSchema),
    // eslint-disable-next-line mig/no-cyrillic-ui -- legal form is a data value sent to the server
    defaultValues: { legalForm: 'ООО', name: '', inn: '', status: 'draft' },
    mode: 'onTouched',
  });
  const onSubmit = form.handleSubmit(async (v) => {
    try {
      const c = await create.mutateAsync({ ...v, status: v.status ?? 'draft' });
      toast.success(t('staff.clients.added'));
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
      title={t('staff.clients.newClient')}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button onClick={() => void onSubmit()} loading={create.isPending}>
            {t('staff.clients.addClient')}
          </Button>
        </>
      }
    >
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-3">
        <div className="grid grid-cols-[120px_1fr] gap-3">
          <Field label={t('staff.clients.legalForm')}>
            {(a) => (
              <Select {...a} {...form.register('legalForm')}>
                {/* eslint-disable-next-line mig/no-cyrillic-ui -- legal forms are data values sent to the server */}
                {['ООО', 'АО', 'СП ООО', 'ЧП'].map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </Select>
            )}
          </Field>
          <Field label={t('common.name')} error={tm(form.formState.errors.name?.message)}>
            {(a) => <Input {...a} maxLength={120} {...form.register('name')} />}
          </Field>
        </div>
        <Field label={t('staff.clients.inn')} error={tm(form.formState.errors.inn?.message)}>
          {(a) => (
            <Controller
              control={form.control}
              name="inn"
              render={({ field }) => <MaskedInput {...a} mask="pinfl" placeholder={t('staff.clients.innPlaceholder')} value={field.value} onChange={(v) => field.onChange(maskPinfl(v).slice(0, 9))} onBlur={field.onBlur} />}
            />
          )}
        </Field>
        <Field label={t('common.status')}>
          {(a) => (
            <Select {...a} {...form.register('status')}>
              <option value="draft">{t('staff.clients.status.draft')}</option>
              <option value="negotiation">{t('staff.clients.status.negotiation')}</option>
            </Select>
          )}
        </Field>
      </form>
    </Modal>
  );
}

