/* «Доп. соглашения» (LIFECYCLE_SPEC §11): change requests accumulate, then become endorsements. */
import { defineLabels, t, tm } from '@/i18n';
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
import { useCreateIntent } from '@/shared/lib/createIntent';
import { Button } from '@/shared/ui/button';
import { Chip } from '@/shared/ui/chips';
import { DataTable, formatSort, parseSort, type Column } from '@/shared/ui/data-table';
import { formatLegalForms, legalFormColumn, parseLegalForms } from '@/shared/ui/legal-form';
import { Modal } from '@/shared/ui/dialog';
import { Field, Input, Select } from '@/shared/ui/input';
import { PageHeader } from '@/shared/ui/page';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/ui/tabs';
import { EmptyState } from '@/shared/ui/states';
import { toast } from '@/shared/ui/toast';
import { HelpMore, roleName } from '@/features/next/NextActions';
import { useTopbar } from '../topbar';

const REQUEST_STATUS = defineLabels('staffLc.changeRequestStatus', ['pending', 'included', 'cancelled'] as const);
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
      toast.success(t('staffLc.endorsements.requestCreated'));
      onClose();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('staffLc.endorsements.request')}
      description={t('staffLc.endorsements.requestDesc')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button loading={create.isPending} onClick={() => void submit()}>
            {t('staffLc.endorsements.createRequest')}
          </Button>
        </>
      }
    >
      <div className="grid gap-3">
        <Field label={t('common.contract')} error={tm(errors.contractId) || undefined}>
          {(a) => (
            <Select {...a} value={v.contractId} onChange={(e) => setV({ ...v, contractId: e.target.value })}>
              <option value="">{t('staffLc.endorsements.chooseContract')}</option>
              {(contracts.data ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.number} · {c.clientName}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t('staffLc.endorsements.change')} error={tm(errors.type) || undefined}>
          {(a) => (
            <Select {...a} value={v.type} onChange={(e) => setV({ ...v, type: e.target.value as 'change_program' | 'other' })}>
              <option value="change_program">{CHANGE_TYPE_LABEL.change_program}</option>
              <option value="other">{CHANGE_TYPE_LABEL.other}</option>
            </Select>
          )}
        </Field>
        <Field label={t('staffLc.endorsements.effectiveDate')} error={tm(errors.effectiveDate) || undefined}>
          {(a) => <Input {...a} type="date" value={v.effectiveDate} onChange={(e) => setV({ ...v, effectiveDate: e.target.value })} />}
        </Field>
        {v.type === 'change_program' ? (
          <Field label={t('staffLc.endorsements.newProgram')} error={tm(errors.program) || undefined}>
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
            <Field label={t('staffLc.endorsements.description')} error={tm(errors.description) || undefined}>
              {(a) => <Input {...a} maxLength={300} value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} />}
            </Field>
            <Field label={t('staffLc.endorsements.amountLabel')} hint={t('staffLc.endorsements.amountHint')} error={tm(errors.amount) || undefined}>
              {(a) => <Input {...a} inputMode="numeric" maxLength={14} value={v.amount} onChange={(e) => setV({ ...v, amount: e.target.value })} />}
            </Field>
          </>
        )}
      </div>
    </Modal>
  );
}

export default function EndorsementsPage() {
  useDocumentTitle(t('staffLc.contract.endorsements'));
  useTopbar([{ label: t('staffLc.contract.endorsements') }]);
  const navigate = useNavigate();
  const [f, setF] = useUrlFilters(['tab', 'form', 'sort', 'rform'] as const);
  const tab = f.tab === 'requests' ? 'requests' : 'endorsements';
  const forms = parseLegalForms(f.form);
  const reqForms = parseLegalForms(f.rform);
  const sort = parseSort(f.sort);
  const requests = useChangeRequests();
  const requestRows = useChangeRequests(reqForms.length ? { form: reqForms.join(',') } : {});
  const endorsements = useEndorsements({
    ...(forms.length ? { form: forms.join(',') } : {}),
    ...(sort ? { sort: `${sort.key}:${sort.dir}` } : {}),
  });
  const createEnd = useCreateEndorsements();
  const canManage = useCan('endorsements.manage');
  const periodicity = PERIODICITIES[useDmsParam('endorsementPeriodicity')] ?? 'monthly';
  const [newReq, setNewReq] = useState(false);
  useCreateIntent('request', canManage, setNewReq, true);

  const pendingByContract = new Map<string, ChangeRequestView[]>();
  for (const r of requests.data ?? []) if (r.status === 'pending') pendingByContract.set(r.contractId, [...(pendingByContract.get(r.contractId) ?? []), r]);

  const form = async (contractId: string) => {
    try {
      const out = await createEnd.mutateAsync({ contractId });
      toast.success(out.length === 1 ? t('staffLc.endorsements.formedOne', { number: out[0]!.number }) : t('staffLc.endorsements.formedMany', { n: out.length }));
      if (out.length === 1) navigate(`/staff/endorsements/${out[0]!.id}`);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const requestButton = canManage ? (
    <Button variant="secondary" onClick={() => setNewReq(true)}>
      <Plus className="h-4 w-4" aria-hidden /> {t('emptyStaff.requests.create')}
    </Button>
  ) : null;
  const endEmpty = forms.length ? undefined : (
    <EmptyState
      testId="endorsements-next"
      title={t('emptyStaff.endorsements.title')}
      why={t('emptyStaff.endorsements.why')}
      next={t('emptyStaff.endorsements.next', { role: roleName('sales_manager') })}
      actions={requestButton}
      help={<HelpMore article="servicing" section="endorsement" />}
    />
  );
  const reqEmpty = reqForms.length ? undefined : (
    <EmptyState
      testId="change-requests-next"
      title={t('emptyStaff.requests.title')}
      why={t('emptyStaff.requests.why')}
      next={t('emptyStaff.requests.next', { role: roleName('sales_manager') })}
      actions={requestButton}
      help={<HelpMore article="servicing" section="endorsement" />}
    />
  );

  const reqColumns: Column<ChangeRequestView>[] = [
    { key: 'date', header: t('staffLc.endorsements.effectiveDate'), cell: (r) => <span className="num">{formatDate(r.effectiveDate)}</span> },
    { key: 'contract', header: t('common.contract'), cell: (r) => <span className="num">{r.contractNumber}</span> },
    { key: 'client', header: t('common.client'), cell: (r) => r.clientName },
    legalFormColumn<ChangeRequestView>((r) => r.clientLegalForm, { selected: reqForms, onChange: (v) => setF({ rform: formatLegalForms(v) }) }),
    { key: 'type', header: t('common.type'), cell: (r) => CHANGE_TYPE_LABEL[r.type] },
    { key: 'desc', header: t('staffLc.endorsements.description'), cell: (r) => r.description ?? '—' },
    { key: 'by', header: t('staffLc.endorsements.requester'), cell: (r) => r.requestedBy.name ?? (r.requestedBy.role === 'hr' ? t('staffLc.endorsements.clientHr') : t('common.mig')) },
    { key: 'status', header: t('common.status'), cell: (r) => <Chip kind={REQUEST_CHIP[r.status]}>{r.endorsementNumber ?? REQUEST_STATUS[r.status]}</Chip> },
  ];
  const endColumns: Column<EndorsementView>[] = [
    { key: 'num', header: t('staffLc.endorsements.endorsement'), sortKey: 'number', cell: (e) => <span className="num font-medium">{e.number}</span> },
    { key: 'client', header: t('common.client'), sortKey: 'clientName', cell: (e) => e.clientName },
    legalFormColumn<EndorsementView>((e) => e.clientLegalForm, { selected: forms, onChange: (v) => setF({ form: formatLegalForms(v) }) }),
    { key: 'kind', header: t('staffLc.endorsements.kind'), cell: (e) => (e.kind === 'termination' ? t('staffLc.endorsements.termination') : t('staffLc.endorsements.changesCount', { n: e.lines.length })) },
    { key: 'total', header: t('common.amount'), align: 'right', cell: (e) => <span className={e.total < 0 ? 'num text-success-text' : 'num'}>{e.total < 0 ? t('staffLc.endorsements.refund', { amount: formatMoney(-e.total) }) : formatMoney(e.total)}</span> },
    { key: 'status', header: t('common.status'), cell: (e) => <Chip kind={e.status === 'signed' ? 'success' : e.status === 'draft' ? 'neutral' : 'warning'}>{ENDORSEMENT_STATUS_LABEL[e.status]}</Chip> },
    { key: 'date', header: t('common.created'), cell: (e) => (e.createdAt ? <span className="num">{formatDate(e.createdAt)}</span> : '—') },
  ];

  return (
    <>
      <PageHeader
        title={t('staffLc.contract.endorsements')}
        subtitle={periodicity === 'monthly' ? t('staffLc.endorsements.subtitleMonthly') : t('staffLc.endorsements.subtitleEach')}
        actions={
          canManage && (
            <Button onClick={() => setNewReq(true)}>
              <Plus className="h-4 w-4" aria-hidden /> {t('staffLc.endorsements.request')}
            </Button>
          )
        }
      />
      {canManage && pendingByContract.size > 0 && (
        <div className="mb-3 flex flex-col gap-2" data-testid="pending-requests">
          {[...pendingByContract].map(([contractId, list]) => (
            <div key={contractId} className="flex flex-wrap items-center justify-between gap-2 rounded-card border border-warning/40 bg-warning-soft px-3 py-2 text-[13px] text-warning-text">
              <span>
                <span className="num font-medium">{list[0]!.contractNumber}</span> {t('staffLc.endorsements.pendingLine', { client: list[0]!.clientName, n: list.length })}
              </span>
              <Button size="sm" loading={createEnd.isPending && createEnd.variables?.contractId === contractId} onClick={() => void form(contractId)}>
                {t('staffLc.endorsements.form')}
              </Button>
            </div>
          ))}
        </div>
      )}
      <Tabs value={tab} onValueChange={(v) => setF({ tab: v === 'requests' ? 'requests' : null })}>
        <TabsList>
          <TabsTrigger value="endorsements">{t('staffLc.contract.endorsements')}</TabsTrigger>
          <TabsTrigger value="requests">{t('staffLc.endorsements.requests')}</TabsTrigger>
        </TabsList>
        <TabsContent value="endorsements">
          <div className="rounded-card border border-border bg-surface">
            <DataTable caption={t('staffLc.contract.endorsements')} columns={endColumns} rows={endorsements.data} sort={sort} onSortChange={(s) => setF({ sort: formatSort(s) })} loading={endorsements.isLoading} error={endorsements.error} rowKey={(e) => e.id} onRowClick={(e) => navigate(`/staff/endorsements/${e.id}`)} empty={endEmpty} />
          </div>
        </TabsContent>
        <TabsContent value="requests">
          <div className="rounded-card border border-border bg-surface">
            <DataTable caption={t('staffLc.endorsements.requests')} columns={reqColumns} rows={requestRows.data} loading={requestRows.isLoading} error={requestRows.error} rowKey={(r) => r.id} empty={reqEmpty} />
          </div>
        </TabsContent>
      </Tabs>
      {newReq && <NewRequestDialog onClose={() => setNewReq(false)} />}
    </>
  );
}
