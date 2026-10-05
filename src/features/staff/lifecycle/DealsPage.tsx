/* «Сделки» (LIFECYCLE_SPEC §3): the sales funnel as a board by stages, or a table; new leads. */
import { t, tm } from '@/i18n';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { LayoutGrid, Plus, Table2 } from 'lucide-react';
import type { DealView } from '@/shared/types/dto';
import { useCreateLead, useDeals, useStaffDirectory } from '@/shared/api/queries/lifecycle';
import { errorMessage } from '@/shared/api/client';
import { useCan } from '@/shared/auth/guards';
import { DEAL_STAGE_LABEL, DEAL_STAGES } from '@/shared/domain/contracts';
import { leadCreateSchema } from '@/shared/schemas/forms';
import { formatDate, formatMoney, formatMoneyShort } from '@/shared/lib/format';
import { useDocumentTitle, useUrlFilters } from '@/shared/lib/hooks';
import { cn } from '@/shared/lib/cn';
import { Button } from '@/shared/ui/button';
import { Chip } from '@/shared/ui/chips';
import { DataTable, formatSort, parseSort, type Column } from '@/shared/ui/data-table';
import { LegalFormChip, LegalFormOptions, formatLegalForms, legalFormColumn, parseLegalForms } from '@/shared/ui/legal-form';
import { Modal } from '@/shared/ui/dialog';
import { Field, Input, Select } from '@/shared/ui/input';
import { PageHeader } from '@/shared/ui/page';
import { QueryState } from '@/shared/ui/states';
import { toast } from '@/shared/ui/toast';
import { useTopbar } from '../topbar';

const EMPTY_LEAD = {
  legalForm: 'llc',
  name: '',
  inn: '',
  bank: '',
  account: '',
  mfo: '',
  director: '',
  // eslint-disable-next-line mig/no-cyrillic-ui -- default basis is contract data (goes into the document)
  directorBasis: 'Устав',
  contactName: '',
  contactPhone: '',
  contactEmail: '',
  estimatedHeadcount: '',
  currentInsurer: '',
  expectedStart: '',
};

function LeadDialog({ onClose }: { onClose: () => void }) {
  const create = useCreateLead();
  const navigate = useNavigate();
  const [v, setV] = useState(EMPTY_LEAD);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = (k: keyof typeof EMPTY_LEAD) => (e: { target: { value: string } }) => setV((x) => ({ ...x, [k]: e.target.value }));
  const submit = async () => {
    const parsed = leadCreateSchema.safeParse({
      legalForm: v.legalForm,
      name: v.name,
      inn: v.inn,
      requisites: { bank: v.bank, account: v.account, mfo: v.mfo, director: v.director, directorBasis: v.directorBasis },
      contactName: v.contactName,
      contactPhone: v.contactPhone,
      contactEmail: v.contactEmail,
      estimatedHeadcount: Number(v.estimatedHeadcount),
      currentInsurer: v.currentInsurer || undefined,
      expectedStart: v.expectedStart || undefined,
    });
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [i.path.join('.'), i.message])));
      return;
    }
    setErrors({});
    try {
      const deal = await create.mutateAsync(parsed.data);
      toast.success(t('staffLc.deals.leadCreated', { number: deal.number }));
      navigate(`/staff/deals/${deal.id}`);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  const f = (key: keyof typeof EMPTY_LEAD, label: string, err: string, extra: { maxLength?: number; inputMode?: 'numeric' | 'email' | 'tel'; placeholder?: string } = {}) => (
    <Field label={label} error={tm(errors[err]) || undefined}>
      {(a) => <Input {...a} {...extra} value={v[key]} onChange={set(key)} />}
    </Field>
  );
  return (
    <Modal
      open
      wide
      onOpenChange={(o) => !o && onClose()}
      title={t('staffLc.deals.newLead')}
      description={t('staffLc.deals.newLeadDesc')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button loading={create.isPending} onClick={() => void submit()}>
            {t('staffLc.deals.createLead')}
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label={t('staffLc.deals.legalForm')} error={tm(errors.legalForm) || undefined}>
          {(a) => (
            <Select {...a} value={v.legalForm} onChange={set('legalForm')}>
              <LegalFormOptions />
            </Select>
          )}
        </Field>
        <div className="sm:col-span-2">{f('name', t('common.name'), 'name', { maxLength: 120 })}</div>
        {f('inn', t('staffLc.deals.inn'), 'inn', { maxLength: 11, inputMode: 'numeric' })}
        {f('estimatedHeadcount', t('staffLc.deals.headcount'), 'estimatedHeadcount', { maxLength: 6, inputMode: 'numeric' })}
        {f('currentInsurer', t('staffLc.deals.currentInsurer'), 'currentInsurer', { maxLength: 120 })}
        {f('bank', t('staffLc.deals.bank'), 'requisites.bank', { maxLength: 120 })}
        {f('account', t('staffLc.deals.account'), 'requisites.account', { maxLength: 24, inputMode: 'numeric' })}
        {f('mfo', t('staffLc.deals.mfo'), 'requisites.mfo', { maxLength: 5, inputMode: 'numeric' })}
        {f('director', t('staffLc.deals.director'), 'requisites.director', { maxLength: 120 })}
        {f('directorBasis', t('staffLc.deals.directorBasis'), 'requisites.directorBasis', { maxLength: 120 })}
        {f('expectedStart', t('staffLc.deals.expectedStart'), 'expectedStart', { maxLength: 10 })}
        {f('contactName', t('staffLc.deals.contactName'), 'contactName', { maxLength: 120 })}
        {f('contactPhone', t('staffLc.deals.contactPhone'), 'contactPhone', { maxLength: 20, inputMode: 'tel' })}
        {f('contactEmail', t('staffLc.deals.contactEmail'), 'contactEmail', { maxLength: 254, inputMode: 'email' })}
      </div>
    </Modal>
  );
}

function DealCardTile({ d }: { d: DealView }) {
  return (
    <Link
      to={`/staff/deals/${d.id}`}
      className="block rounded-btn border border-border bg-surface p-2.5 text-[13px] shadow-xs hover:border-accent"
      data-testid="deal-card"
      aria-label={t('staffLc.deals.tileAria', { number: d.number, client: d.clientName })}
    >
      <span className="flex items-center gap-1.5">
        <span className="min-w-0 truncate font-semibold">{d.clientName}</span>
        <LegalFormChip code={d.clientLegalForm} />
      </span>
      <span className="mt-0.5 flex items-center justify-between gap-2 text-[12px] text-muted">
        <span className="num">{d.number}</span>
        {d.type === 'renewal' && <Chip kind="renewal">{t('staffLc.deals.renewalChip')}</Chip>}
      </span>
      <span className="mt-1 flex items-center justify-between gap-2 text-[12px]">
        <span className="truncate text-muted">{d.ownerName}</span>
        <span className="num font-medium">{d.premium ? formatMoneyShort(d.premium) : '—'}</span>
      </span>
    </Link>
  );
}

export default function DealsPage() {
  useDocumentTitle(t('staffLc.deals.title'));
  useTopbar([{ label: t('staffLc.deals.title') }]);
  const navigate = useNavigate();
  const canCreate = useCan('leads.manage');
  const [f, setF] = useUrlFilters(['view', 'owner', 'type', 'form', 'sort'] as const);
  const view = f.view === 'table' ? 'table' : 'board';
  // The form filter and the sort live in the table's header: the board always shows the whole funnel.
  const forms = view === 'table' ? parseLegalForms(f.form) : [];
  const sort = view === 'table' && f.sort ? parseSort(f.sort) : null;
  const q = useDeals({
    ...(f.owner ? { ownerId: f.owner } : {}),
    ...(f.type ? { type: f.type } : {}),
    ...(forms.length ? { form: forms.join(',') } : {}),
    ...(sort ? { sort: formatSort(sort) } : {}),
  });
  const directory = useStaffDirectory();
  const managers = (directory.data ?? []).filter((s) => s.role === 'sales_manager');
  const [lead, setLead] = useState(false);

  const columns: Column<DealView>[] = [
    { key: 'num', header: t('staffLc.deal.fallback'), cell: (d) => <span className="num font-medium">{d.number}</span> },
    { key: 'client', header: t('common.client'), sortKey: 'clientName', cell: (d) => d.clientName },
    legalFormColumn<DealView>((d) => d.clientLegalForm, { selected: forms, onChange: (v) => setF({ form: formatLegalForms(v) }) }),
    { key: 'type', header: t('common.type'), cell: (d) => (d.type === 'renewal' ? t('staffLc.deals.typeRenewal') : t('staffLc.deals.typeNew')) },
    { key: 'stage', header: t('staffLc.deals.stage'), cell: (d) => <Chip kind={d.stage === 'lost' ? 'danger' : d.stage === 'active' ? 'success' : 'accent'}>{DEAL_STAGE_LABEL[d.stage]}</Chip> },
    { key: 'owner', header: t('common.manager'), cell: (d) => d.ownerName },
    { key: 'premium', header: t('common.premium'), align: 'right', cell: (d) => <span className="num whitespace-nowrap">{d.premium ? formatMoney(d.premium) : '—'}</span> },
    { key: 'start', header: t('common.start'), cell: (d) => (d.expectedStart ? <span className="num">{formatDate(d.expectedStart)}</span> : '—') },
  ];

  return (
    <>
      <PageHeader
        title={t('staffLc.deals.title')}
        subtitle={t('staffLc.deals.subtitle')}
        actions={
          <>
            <div className="flex rounded-btn border border-border" role="group" aria-label={t('staffLc.deals.view')}>
              <button type="button" className={cn('flex items-center gap-1 px-2.5 py-1 text-[13px]', view === 'board' && 'bg-accent-soft font-semibold text-accent-text')} onClick={() => setF({ view: null })} aria-pressed={view === 'board'}>
                <LayoutGrid className="h-3.5 w-3.5" aria-hidden /> {t('staffLc.deals.board')}
              </button>
              <button type="button" className={cn('flex items-center gap-1 px-2.5 py-1 text-[13px]', view === 'table' && 'bg-accent-soft font-semibold text-accent-text')} onClick={() => setF({ view: 'table' })} aria-pressed={view === 'table'}>
                <Table2 className="h-3.5 w-3.5" aria-hidden /> {t('staffLc.deals.table')}
              </button>
            </div>
            {canCreate && (
              <Button onClick={() => setLead(true)}>
                <Plus className="h-4 w-4" aria-hidden /> {t('staffLc.deals.newLead')}
              </Button>
            )}
          </>
        }
      />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Select aria-label={t('common.manager')} className="h-8 w-56" value={f.owner ?? ''} onChange={(e) => setF({ owner: e.target.value || null })}>
          <option value="">{t('staffLc.deals.allManagers')}</option>
          {managers.map((m) => (
            <option key={m.id} value={m.id}>
              {m.fullName}
            </option>
          ))}
        </Select>
        <Select aria-label={t('staffLc.deals.dealType')} className="h-8 w-48" value={f.type ?? ''} onChange={(e) => setF({ type: e.target.value || null })}>
          <option value="">{t('staffLc.deals.allDeals')}</option>
          <option value="new">{t('staffLc.deals.newClients')}</option>
          <option value="renewal">{t('staffLc.deals.renewals')}</option>
        </Select>
      </div>
      {view === 'table' ? (
        <div className="rounded-card border border-border bg-surface">
          <DataTable caption={t('staffLc.deals.title')} columns={columns} rows={q.data} sort={sort ?? undefined} onSortChange={(s) => setF({ sort: formatSort(s) })} loading={q.isLoading} error={q.error} onRetry={() => void q.refetch()} rowKey={(d) => d.id} onRowClick={(d) => navigate(`/staff/deals/${d.id}`)} empty={t('staffLc.deals.empty')} />
        </div>
      ) : (
        <QueryState query={q}>
          {(deals) => (
            <div className="flex gap-3 overflow-x-auto pb-3" data-testid="deals-board">
              {[...DEAL_STAGES, 'lost' as const].map((stage) => {
                const items = deals.filter((d) => d.stage === stage);
                const sum = items.reduce((s, d) => s + (d.premium ?? 0), 0);
                return (
                  <section key={stage} aria-label={DEAL_STAGE_LABEL[stage]} className="flex w-60 shrink-0 flex-col rounded-card border border-border bg-rail/60">
                    <header className="border-b border-border px-3 py-2">
                      <p className="text-[13px] font-semibold">{DEAL_STAGE_LABEL[stage]}</p>
                      <p className="num text-[12px] text-muted" data-testid={`stage-${stage}`}>
                        {items.length} · {formatMoneyShort(sum)}
                      </p>
                    </header>
                    <div className="flex max-h-[calc(100vh-17rem)] flex-col gap-2 overflow-y-auto p-2">
                      {items.map((d) => (
                        <DealCardTile key={d.id} d={d} />
                      ))}
                      {!items.length && <p className="px-1 py-3 text-center text-[12px] text-muted">{t('staffLc.deals.emptyColumn')}</p>}
                    </div>
                  </section>
                );
              })}
            </div>
          )}
        </QueryState>
      )}
      {lead && <LeadDialog onClose={() => setLead(false)} />}
    </>
  );
}
