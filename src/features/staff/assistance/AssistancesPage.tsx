/* Assistance companies for MIG (ASSISTANCE_SPEC §7): insured, KPI, rebills to review, SLA breaches. */
import { useNavigate } from 'react-router-dom';
import type { AssistanceListItem } from '@/shared/types/dto';
import type { FeeModel } from '@/shared/types';
import { useState } from 'react';
import { useAssistances, useCreateAssistance } from '@/shared/api/queries/assist';
import { errorMessage } from '@/shared/api/client';
import { useCan } from '@/shared/auth/guards';
import { FEE_MODEL_LABEL } from '@/shared/domain/assistance';
import { assistanceCreateSchema } from '@/shared/schemas/forms';
import { Button } from '@/shared/ui/button';
import { Modal } from '@/shared/ui/dialog';
import { Field, Input, Select } from '@/shared/ui/input';
import { toast } from '@/shared/ui/toast';
import { INTEGRATION_MODE_LABEL } from '@/shared/domain/clinics';
import { t, tm } from '@/i18n';
import { formatNumber, formatPercent } from '@/shared/lib/format';
import { useDocumentTitle, useUrlFilters } from '@/shared/lib/hooks';
import { Chip } from '@/shared/ui/chips';
import { DataTable, formatSort, parseSort, type Column } from '@/shared/ui/data-table';
import { LegalFormOptions, formatLegalForms, legalFormColumn, parseLegalForms } from '@/shared/ui/legal-form';
import { PageHeader } from '@/shared/ui/page';
import { useTopbar } from '../topbar';
import { useDmsParam } from '@/shared/api/queries/params';
import { formatMoney } from '@/shared/lib/format';

function CreateDialog({ onClose }: { onClose: () => void }) {
  const defaultLimit = useDmsParam('assistanceGuaranteeAuthority');
  const create = useCreateAssistance();
  const navigate = useNavigate();
  const [v, setV] = useState({ legalForm: 'llc', name: '', phone24x7: '', integrationMode: 'portal', contractNumber: '', feeModel: 'pepm', feeValue: '15000', limit: '', days: '10', adminName: '', adminEmail: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV((x) => ({ ...x, [k]: e.target.value }));
  const submit = async () => {
    const parsed = assistanceCreateSchema.safeParse({
      legalForm: v.legalForm,
      name: v.name,
      phone24x7: v.phone24x7,
      integrationMode: v.integrationMode,
      contractNumber: v.contractNumber,
      contract: {
        feeModel: v.feeModel,
        feeValue: Number(v.feeValue.replace(/\s/g, '').replace(',', '.')),
        // Empty: no individual value, the DMS parameter applies.
        guaranteeAuthorityLimit: v.limit.trim() ? Number(v.limit.replace(/\s/g, '')) : undefined,
        rebillPaymentDays: Number(v.days),
      },
      admin: { fullName: v.adminName, email: v.adminEmail },
    });
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [i.path.join('.'), i.message])));
      return;
    }
    setErrors({});
    try {
      const a = await create.mutateAsync(parsed.data);
      toast.success(t('staffOps.assistances.created'));
      onClose();
      navigate(`/staff/assistance/${a.id}`);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  return (
    <Modal
      open
      wide
      onOpenChange={(o) => !o && onClose()}
      title={t('staffOps.assistances.newTitle')}
      description={t('staffOps.assistances.newText')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button loading={create.isPending} onClick={() => void submit()}>
            {t('common.add')}
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t('shell.legalForm.column')} error={tm(errors.legalForm) || undefined}>
          {(a) => (
            <Select {...a} value={v.legalForm} onChange={set('legalForm')}>
              <LegalFormOptions />
            </Select>
          )}
        </Field>
        <Field label={t('common.name')} error={tm(errors.name) || undefined}>
          {(a) => <Input {...a} maxLength={120} value={v.name} onChange={set('name')} />}
        </Field>
        <Field label={t('staffOps.assistances.phone247')} error={tm(errors.phone24x7) || undefined}>
          {(a) => <Input {...a} maxLength={30} value={v.phone24x7} onChange={set('phone24x7')} placeholder="+998 71 200 00 00" />}
        </Field>
        <Field label={t('staffOps.assistances.connection')} error={tm(errors.integrationMode) || undefined}>
          {(a) => (
            <Select {...a} value={v.integrationMode} onChange={set('integrationMode')}>
              {Object.entries(INTEGRATION_MODE_LABEL).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t('staffOps.clinicCard.contractNumber')} error={tm(errors.contractNumber) || undefined}>
          {(a) => <Input {...a} maxLength={40} value={v.contractNumber} onChange={set('contractNumber')} />}
        </Field>
        <Field label={t('staffOps.assistances.feeModel')} error={tm(errors['contract.feeModel']) || undefined}>
          {(a) => (
            <Select {...a} value={v.feeModel} onChange={set('feeModel')}>
              {(Object.keys(FEE_MODEL_LABEL) as FeeModel[]).map((k) => (
                <option key={k} value={k}>
                  {FEE_MODEL_LABEL[k]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={v.feeModel === 'percent_of_claims' ? t('staffOps.assistances.share') : t('staffOps.guarantees.amountUzs')} error={tm(errors['contract.feeValue']) || undefined}>
          {(a) => <Input {...a} inputMode="decimal" maxLength={14} value={v.feeValue} onChange={set('feeValue')} />}
        </Field>
        <Field label={t('staffOps.assistances.authority')} error={tm(errors['contract.guaranteeAuthorityLimit']) || undefined} hint={t('staffOps.assistances.authorityHint', { amount: formatMoney(defaultLimit) })}>
          {(a) => <Input {...a} inputMode="numeric" maxLength={14} value={v.limit} onChange={set('limit')} />}
        </Field>
        <Field label={t('staffOps.assistances.paymentDays')} error={tm(errors['contract.rebillPaymentDays']) || undefined}>
          {(a) => <Input {...a} inputMode="numeric" maxLength={3} value={v.days} onChange={set('days')} />}
        </Field>
        <Field label={t('staffOps.assistances.adminName')} error={tm(errors['admin.fullName']) || undefined}>
          {(a) => <Input {...a} maxLength={120} value={v.adminName} onChange={set('adminName')} />}
        </Field>
        <Field label={t('staffOps.assistances.adminEmail')} error={tm(errors['admin.email']) || undefined}>
          {(a) => <Input {...a} type="email" maxLength={254} value={v.adminEmail} onChange={set('adminEmail')} />}
        </Field>
      </div>
    </Modal>
  );
}

export default function AssistancesPage() {
  useDocumentTitle(t('staffOps.assistances.title'));
  useTopbar([{ label: t('staffOps.assistances.title') }]);
  const navigate = useNavigate();
  const [f, setF] = useUrlFilters(['form', 'sort'] as const);
  const forms = parseLegalForms(f.form);
  const sort = parseSort(f.sort);
  const q = useAssistances({
    ...(forms.length ? { form: forms.join(',') } : {}),
    ...(sort ? { sort: `${sort.key}:${sort.dir}` } : {}),
  });
  const canManage = useCan('assistance.manage');
  const [creating, setCreating] = useState(false);
  const columns: Column<AssistanceListItem>[] = [
    { key: 'name', header: t('staffOps.rebills.col.assistance'), sortKey: 'name', cell: (a) => <span className="font-medium">{a.name}</span> },
    legalFormColumn<AssistanceListItem>((a) => a.legalForm, { selected: forms, onChange: (v) => setF({ form: formatLegalForms(v) }) }),
    { key: 'mode', header: t('staffOps.assistances.connection'), cell: (a) => INTEGRATION_MODE_LABEL[a.integrationMode] },
    { key: 'clients', header: t('staffOps.assistances.col.clients'), sortKey: 'clientsCount', align: 'right', cell: (a) => <span className="num">{a.clientsCount}</span> },
    { key: 'insured', header: t('staffOps.assistances.col.insured'), sortKey: 'insuredCount', align: 'right', cell: (a) => <span className="num">{formatNumber(a.insuredCount)}</span> },
    { key: 'gp', header: t('staffOps.assistances.col.glOnTime'), align: 'right', cell: (a) => <span className="num">{formatPercent(a.kpi.guaranteesOnTimeShare)}</span> },
    { key: 'qa', header: t('staffOps.assistances.col.qa'), align: 'right', cell: (a) => <span className={a.kpi.qaAgreementShare < 0.9 ? 'num text-warning-text' : 'num'}>{formatPercent(a.kpi.qaAgreementShare)}</span> },
    { key: 'loss', header: t('staffOps.assistances.col.lossRatio'), align: 'right', cell: (a) => <span className="num">{a.kpi.lossRatio === null ? '—' : formatPercent(a.kpi.lossRatio)}</span> },
    { key: 'rebills', header: t('staffOps.assistances.col.rebills'), align: 'right', cell: (a) => (a.rebillsToReview ? <Chip kind="warning">{a.rebillsToReview}</Chip> : <span className="text-muted">0</span>) },
    { key: 'sla', header: t('staffOps.assistances.col.sla'), align: 'right', cell: (a) => (a.slaBreaches ? <Chip kind="danger">{a.slaBreaches}</Chip> : <span className="text-muted">0</span>) },
  ];
  return (
    <>
      <PageHeader
        title={t('staffOps.assistances.pageTitle')}
        subtitle={t('staffOps.assistances.subtitle')}
        actions={canManage && <Button onClick={() => setCreating(true)}>{t('staffOps.assistances.add')}</Button>}
      />
      <div className="rounded-card border border-border bg-surface">
        <DataTable
          caption={t('staffOps.assistances.title')}
          columns={columns}
          rows={q.data}
          sort={sort}
          onSortChange={(s) => setF({ sort: formatSort(s) })}
          loading={q.isLoading}
          error={q.error}
          onRetry={() => void q.refetch()}
          rowKey={(a) => a.id}
          onRowClick={(a) => navigate(`/staff/assistance/${a.id}`)}
          onRowOpen={(a) => navigate(`/staff/assistance/${a.id}`)}
        />
      </div>
      {creating && <CreateDialog onClose={() => setCreating(false)} />}
    </>
  );
}
