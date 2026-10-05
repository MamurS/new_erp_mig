/* «Сделки» (LIFECYCLE_SPEC §3): the sales funnel as a board by stages, or a table; new leads. */
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
import { DataTable, type Column } from '@/shared/ui/data-table';
import { Modal } from '@/shared/ui/dialog';
import { Field, Input, Select } from '@/shared/ui/input';
import { PageHeader } from '@/shared/ui/page';
import { QueryState } from '@/shared/ui/states';
import { toast } from '@/shared/ui/toast';
import { useTopbar } from '../topbar';

const EMPTY_LEAD = {
  legalForm: 'ООО',
  name: '',
  inn: '',
  bank: '',
  account: '',
  mfo: '',
  director: '',
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
      toast.success(`Лид создан: сделка ${deal.number}`);
      navigate(`/staff/deals/${deal.id}`);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  const f = (key: keyof typeof EMPTY_LEAD, label: string, err: string, extra: { maxLength?: number; inputMode?: 'numeric' | 'email' | 'tel'; placeholder?: string } = {}) => (
    <Field label={label} error={errors[err]}>
      {(a) => <Input {...a} {...extra} value={v[key]} onChange={set(key)} />}
    </Field>
  );
  return (
    <Modal
      open
      wide
      onOpenChange={(o) => !o && onClose()}
      title="Новый лид"
      description="Компания, реквизиты для договора и контакт. Данные сотрудников на этом этапе не нужны"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Отмена
          </Button>
          <Button loading={create.isPending} onClick={() => void submit()}>
            Создать лид
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Форма" error={errors.legalForm}>
          {(a) => (
            <Select {...a} value={v.legalForm} onChange={set('legalForm')}>
              {['ООО', 'АО', 'СП ООО', 'ЧП'].map((x) => (
                <option key={x}>{x}</option>
              ))}
            </Select>
          )}
        </Field>
        <div className="sm:col-span-2">{f('name', 'Название', 'name', { maxLength: 120 })}</div>
        {f('inn', 'ИНН', 'inn', { maxLength: 11, inputMode: 'numeric' })}
        {f('estimatedHeadcount', 'Численность, примерно', 'estimatedHeadcount', { maxLength: 6, inputMode: 'numeric' })}
        {f('currentInsurer', 'Текущий страховщик', 'currentInsurer', { maxLength: 120 })}
        {f('bank', 'Банк', 'requisites.bank', { maxLength: 120 })}
        {f('account', 'Расчётный счёт', 'requisites.account', { maxLength: 24, inputMode: 'numeric' })}
        {f('mfo', 'МФО', 'requisites.mfo', { maxLength: 5, inputMode: 'numeric' })}
        {f('director', 'Руководитель', 'requisites.director', { maxLength: 120 })}
        {f('directorBasis', 'Основание полномочий', 'requisites.directorBasis', { maxLength: 120 })}
        {f('expectedStart', 'Желаемое начало (ДД.ММ.ГГГГ)', 'expectedStart', { maxLength: 10 })}
        {f('contactName', 'Контактное лицо', 'contactName', { maxLength: 120 })}
        {f('contactPhone', 'Телефон контакта', 'contactPhone', { maxLength: 20, inputMode: 'tel' })}
        {f('contactEmail', 'Email контакта', 'contactEmail', { maxLength: 254, inputMode: 'email' })}
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
      aria-label={`Сделка ${d.number}: ${d.clientName}`}
    >
      <span className="block truncate font-semibold">{d.clientName}</span>
      <span className="mt-0.5 flex items-center justify-between gap-2 text-[12px] text-muted">
        <span className="num">{d.number}</span>
        {d.type === 'renewal' && <Chip kind="renewal">продление</Chip>}
      </span>
      <span className="mt-1 flex items-center justify-between gap-2 text-[12px]">
        <span className="truncate text-muted">{d.ownerName}</span>
        <span className="num font-medium">{d.premium ? formatMoneyShort(d.premium) : '—'}</span>
      </span>
    </Link>
  );
}

export default function DealsPage() {
  useDocumentTitle('Сделки');
  useTopbar([{ label: 'Сделки' }]);
  const navigate = useNavigate();
  const canCreate = useCan('leads.manage');
  const [f, setF] = useUrlFilters(['view', 'owner', 'type'] as const);
  const q = useDeals({ ...(f.owner ? { ownerId: f.owner } : {}), ...(f.type ? { type: f.type } : {}) });
  const directory = useStaffDirectory();
  const managers = (directory.data ?? []).filter((s) => s.role === 'sales_manager');
  const [lead, setLead] = useState(false);
  const view = f.view === 'table' ? 'table' : 'board';

  const columns: Column<DealView>[] = [
    { key: 'num', header: 'Сделка', cell: (d) => <span className="num font-medium">{d.number}</span> },
    { key: 'client', header: 'Клиент', cell: (d) => d.clientName },
    { key: 'type', header: 'Тип', cell: (d) => (d.type === 'renewal' ? 'Продление' : 'Новый клиент') },
    { key: 'stage', header: 'Этап', cell: (d) => <Chip kind={d.stage === 'lost' ? 'danger' : d.stage === 'active' ? 'success' : 'accent'}>{DEAL_STAGE_LABEL[d.stage]}</Chip> },
    { key: 'owner', header: 'Менеджер', cell: (d) => d.ownerName },
    { key: 'premium', header: 'Премия', align: 'right', cell: (d) => <span className="num whitespace-nowrap">{d.premium ? formatMoney(d.premium) : '—'}</span> },
    { key: 'start', header: 'Начало', cell: (d) => (d.expectedStart ? <span className="num">{formatDate(d.expectedStart)}</span> : '—') },
  ];

  return (
    <>
      <PageHeader
        title="Сделки"
        subtitle="Путь клиента: лид → данные для оценки → котировка → КП → договор → подписание → оплата → полис"
        actions={
          <>
            <div className="flex rounded-btn border border-border" role="group" aria-label="Вид">
              <button type="button" className={cn('flex items-center gap-1 px-2.5 py-1 text-[13px]', view === 'board' && 'bg-accent-soft font-semibold text-accent-text')} onClick={() => setF({ view: null })} aria-pressed={view === 'board'}>
                <LayoutGrid className="h-3.5 w-3.5" aria-hidden /> Доска
              </button>
              <button type="button" className={cn('flex items-center gap-1 px-2.5 py-1 text-[13px]', view === 'table' && 'bg-accent-soft font-semibold text-accent-text')} onClick={() => setF({ view: 'table' })} aria-pressed={view === 'table'}>
                <Table2 className="h-3.5 w-3.5" aria-hidden /> Таблица
              </button>
            </div>
            {canCreate && (
              <Button onClick={() => setLead(true)}>
                <Plus className="h-4 w-4" aria-hidden /> Новый лид
              </Button>
            )}
          </>
        }
      />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Select aria-label="Менеджер" className="h-8 w-56" value={f.owner ?? ''} onChange={(e) => setF({ owner: e.target.value || null })}>
          <option value="">Все менеджеры</option>
          {managers.map((m) => (
            <option key={m.id} value={m.id}>
              {m.fullName}
            </option>
          ))}
        </Select>
        <Select aria-label="Тип сделки" className="h-8 w-48" value={f.type ?? ''} onChange={(e) => setF({ type: e.target.value || null })}>
          <option value="">Все сделки</option>
          <option value="new">Новые клиенты</option>
          <option value="renewal">Продления</option>
        </Select>
      </div>
      {view === 'table' ? (
        <div className="rounded-card border border-border bg-surface">
          <DataTable caption="Сделки" columns={columns} rows={q.data} loading={q.isLoading} error={q.error} onRetry={() => void q.refetch()} rowKey={(d) => d.id} onRowClick={(d) => navigate(`/staff/deals/${d.id}`)} empty="Сделок нет" />
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
                      {!items.length && <p className="px-1 py-3 text-center text-[12px] text-muted">Пусто</p>}
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
