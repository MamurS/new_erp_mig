/* «Доп. соглашения» (LIFECYCLE_SPEC §11): change requests accumulate, then become endorsements. */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus } from 'lucide-react';
import type { ProgramCode } from '@/shared/types';
import type { ChangeRequestView, EndorsementView } from '@/shared/types/dto';
import { useChangeRequests, useContracts, useCreateChangeRequest, useCreateEndorsements, useEndorsements } from '@/shared/api/queries/lifecycle';
import { useDmsParam } from '@/shared/api/queries/params';
import { errorMessage } from '@/shared/api/client';
import { useCan } from '@/shared/auth/guards';
import { ENDORSEMENT_STATUS_LABEL } from '@/shared/domain/contracts';
import { CHANGE_TYPE_LABEL, PERIODICITIES } from '@/shared/domain/endorsements';
import { PROGRAM_LABEL } from '@/shared/domain/labels';
import { changeRequestCreateSchema } from '@/shared/schemas/forms';
import { formatDate, formatMoney } from '@/shared/lib/format';
import { useDocumentTitle, useUrlFilters } from '@/shared/lib/hooks';
import { Button } from '@/shared/ui/button';
import { Chip } from '@/shared/ui/chips';
import { DataTable, type Column } from '@/shared/ui/data-table';
import { Modal } from '@/shared/ui/dialog';
import { Field, Input, Select } from '@/shared/ui/input';
import { PageHeader } from '@/shared/ui/page';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/ui/tabs';
import { toast } from '@/shared/ui/toast';
import { useTopbar } from '../topbar';

const REQUEST_STATUS = { pending: 'Ждёт ДС', included: 'В доп. соглашении', cancelled: 'Отменена' } as const;
const REQUEST_CHIP = { pending: 'warning', included: 'success', cancelled: 'neutral' } as const;
const PROGRAMS: ProgramCode[] = ['basic', 'standard', 'standard_plus', 'premium'];

function NewRequestDialog({ onClose }: { onClose: () => void }) {
  const contracts = useContracts({ status: 'active' });
  const create = useCreateChangeRequest();
  const [v, setV] = useState({ contractId: '', type: 'change_program' as 'change_program' | 'other', effectiveDate: '', program: 'premium' as ProgramCode, description: '', amount: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const submit = async () => {
    const parsed = changeRequestCreateSchema.safeParse({
      contractId: v.contractId,
      type: v.type,
      effectiveDate: v.effectiveDate,
      ...(v.type === 'change_program' ? { program: v.program } : { description: v.description, amount: Number(v.amount.replace(/\s/g, '')) }),
    });
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [i.path.join('.'), i.message])));
      return;
    }
    try {
      await create.mutateAsync(parsed.data);
      toast.success('Заявка на изменение создана');
      onClose();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title="Заявка на изменение"
      description="Изменение от МИГ: смена программы или прочие условия. Включение и исключение сотрудников оформляет HR."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Отмена
          </Button>
          <Button loading={create.isPending} onClick={() => void submit()}>
            Создать заявку
          </Button>
        </>
      }
    >
      <div className="grid gap-3">
        <Field label="Договор" error={errors.contractId}>
          {(a) => (
            <Select {...a} value={v.contractId} onChange={(e) => setV({ ...v, contractId: e.target.value })}>
              <option value="">Выберите договор</option>
              {(contracts.data ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.number} · {c.clientName}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Изменение" error={errors.type}>
          {(a) => (
            <Select {...a} value={v.type} onChange={(e) => setV({ ...v, type: e.target.value as 'change_program' | 'other' })}>
              <option value="change_program">{CHANGE_TYPE_LABEL.change_program}</option>
              <option value="other">{CHANGE_TYPE_LABEL.other}</option>
            </Select>
          )}
        </Field>
        <Field label="Дата изменения" error={errors.effectiveDate}>
          {(a) => <Input {...a} type="date" value={v.effectiveDate} onChange={(e) => setV({ ...v, effectiveDate: e.target.value })} />}
        </Field>
        {v.type === 'change_program' ? (
          <Field label="Новая программа" error={errors.program}>
            {(a) => (
              <Select {...a} value={v.program} onChange={(e) => setV({ ...v, program: e.target.value as ProgramCode })}>
                {PROGRAMS.map((p) => (
                  <option key={p} value={p}>
                    {PROGRAM_LABEL[p]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        ) : (
          <>
            <Field label="Описание" error={errors.description}>
              {(a) => <Input {...a} maxLength={300} value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} />}
            </Field>
            <Field label="Сумма (минус — возврат)" hint="Сумму утверждает андеррайтер" error={errors.amount}>
              {(a) => <Input {...a} inputMode="numeric" maxLength={14} value={v.amount} onChange={(e) => setV({ ...v, amount: e.target.value })} />}
            </Field>
          </>
        )}
      </div>
    </Modal>
  );
}

export default function EndorsementsPage() {
  useDocumentTitle('Доп. соглашения');
  useTopbar([{ label: 'Доп. соглашения' }]);
  const navigate = useNavigate();
  const [f, setF] = useUrlFilters(['tab'] as const);
  const tab = f.tab === 'requests' ? 'requests' : 'endorsements';
  const requests = useChangeRequests();
  const endorsements = useEndorsements();
  const createEnd = useCreateEndorsements();
  const canManage = useCan('endorsements.manage');
  const periodicity = PERIODICITIES[useDmsParam('endorsementPeriodicity')] ?? 'monthly';
  const [newReq, setNewReq] = useState(false);

  const pendingByContract = new Map<string, ChangeRequestView[]>();
  for (const r of requests.data ?? []) if (r.status === 'pending') pendingByContract.set(r.contractId, [...(pendingByContract.get(r.contractId) ?? []), r]);

  const form = async (contractId: string) => {
    try {
      const out = await createEnd.mutateAsync({ contractId });
      toast.success(out.length === 1 ? `Сформировано ${out[0]!.number}` : `Сформировано доп. соглашений: ${out.length}`);
      if (out.length === 1) navigate(`/staff/endorsements/${out[0]!.id}`);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const reqColumns: Column<ChangeRequestView>[] = [
    { key: 'date', header: 'Дата изменения', cell: (r) => <span className="num">{formatDate(r.effectiveDate)}</span> },
    { key: 'contract', header: 'Договор', cell: (r) => <span className="num">{r.contractNumber}</span> },
    { key: 'client', header: 'Клиент', cell: (r) => r.clientName },
    { key: 'type', header: 'Тип', cell: (r) => CHANGE_TYPE_LABEL[r.type] },
    { key: 'desc', header: 'Описание', cell: (r) => r.description ?? '—' },
    { key: 'by', header: 'Заявитель', cell: (r) => r.requestedBy.name ?? (r.requestedBy.role === 'hr' ? 'HR клиента' : 'МИГ') },
    { key: 'status', header: 'Статус', cell: (r) => <Chip kind={REQUEST_CHIP[r.status]}>{r.endorsementNumber ?? REQUEST_STATUS[r.status]}</Chip> },
  ];
  const endColumns: Column<EndorsementView>[] = [
    { key: 'num', header: 'Доп. соглашение', cell: (e) => <span className="num font-medium">{e.number}</span> },
    { key: 'client', header: 'Клиент', cell: (e) => e.clientName },
    { key: 'kind', header: 'Вид', cell: (e) => (e.kind === 'termination' ? 'Расторжение' : `Изменения: ${e.lines.length}`) },
    { key: 'total', header: 'Сумма', align: 'right', cell: (e) => <span className={e.total < 0 ? 'num text-success-text' : 'num'}>{e.total < 0 ? `возврат ${formatMoney(-e.total)}` : formatMoney(e.total)}</span> },
    { key: 'status', header: 'Статус', cell: (e) => <Chip kind={e.status === 'signed' ? 'success' : e.status === 'draft' ? 'neutral' : 'warning'}>{ENDORSEMENT_STATUS_LABEL[e.status]}</Chip> },
    { key: 'date', header: 'Создано', cell: (e) => (e.createdAt ? <span className="num">{formatDate(e.createdAt)}</span> : '—') },
  ];

  return (
    <>
      <PageHeader
        title="Доп. соглашения"
        subtitle={`Заявки на изменение копятся и оформляются доп. соглашением: ${periodicity === 'monthly' ? 'одно ДС по итогам месяца' : 'ДС на каждое изменение'} (параметр ДМС)`}
        actions={
          canManage && (
            <Button onClick={() => setNewReq(true)}>
              <Plus className="h-4 w-4" aria-hidden /> Заявка на изменение
            </Button>
          )
        }
      />
      {canManage && pendingByContract.size > 0 && (
        <div className="mb-3 flex flex-col gap-2" data-testid="pending-requests">
          {[...pendingByContract].map(([contractId, list]) => (
            <div key={contractId} className="flex flex-wrap items-center justify-between gap-2 rounded-card border border-warning/40 bg-warning-soft px-3 py-2 text-[13px] text-warning-text">
              <span>
                <span className="num font-medium">{list[0]!.contractNumber}</span> · {list[0]!.clientName}: заявок без доп. соглашения — {list.length}
              </span>
              <Button size="sm" loading={createEnd.isPending && createEnd.variables?.contractId === contractId} onClick={() => void form(contractId)}>
                Сформировать ДС
              </Button>
            </div>
          ))}
        </div>
      )}
      <Tabs value={tab} onValueChange={(t) => setF({ tab: t === 'requests' ? 'requests' : null })}>
        <TabsList>
          <TabsTrigger value="endorsements">Доп. соглашения</TabsTrigger>
          <TabsTrigger value="requests">Заявки на изменение</TabsTrigger>
        </TabsList>
        <TabsContent value="endorsements">
          <div className="rounded-card border border-border bg-surface">
            <DataTable caption="Доп. соглашения" columns={endColumns} rows={endorsements.data} loading={endorsements.isLoading} error={endorsements.error} rowKey={(e) => e.id} onRowClick={(e) => navigate(`/staff/endorsements/${e.id}`)} empty="Доп. соглашений нет" />
          </div>
        </TabsContent>
        <TabsContent value="requests">
          <div className="rounded-card border border-border bg-surface">
            <DataTable caption="Заявки на изменение" columns={reqColumns} rows={requests.data} loading={requests.isLoading} error={requests.error} rowKey={(r) => r.id} empty="Заявок нет" />
          </div>
        </TabsContent>
      </Tabs>
      {newReq && <NewRequestDialog onClose={() => setNewReq(false)} />}
    </>
  );
}
