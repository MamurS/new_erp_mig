/* Assistance companies for MIG (ASSISTANCE_SPEC §7): insured, KPI, rebills to review, SLA breaches. */
import { useNavigate } from 'react-router-dom';
import type { AssistanceListItem } from '@/shared/types/dto';
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
import { formatNumber, formatPercent } from '@/shared/lib/format';
import { useDocumentTitle } from '@/shared/lib/hooks';
import { Chip } from '@/shared/ui/chips';
import { DataTable, type Column } from '@/shared/ui/data-table';
import { PageHeader } from '@/shared/ui/page';
import { useTopbar } from '../topbar';

function CreateDialog({ onClose }: { onClose: () => void }) {
  const create = useCreateAssistance();
  const navigate = useNavigate();
  const [v, setV] = useState({ name: '', phone24x7: '', integrationMode: 'portal', contractNumber: '', feeModel: 'pepm', feeValue: '15000', limit: '10000000', days: '10', adminName: '', adminEmail: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV((x) => ({ ...x, [k]: e.target.value }));
  const submit = async () => {
    const parsed = assistanceCreateSchema.safeParse({
      name: v.name,
      phone24x7: v.phone24x7,
      integrationMode: v.integrationMode,
      contractNumber: v.contractNumber,
      contract: {
        feeModel: v.feeModel,
        feeValue: Number(v.feeValue.replace(/\s/g, '').replace(',', '.')),
        guaranteeAuthorityLimit: Number(v.limit.replace(/\s/g, '')),
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
      toast.success('Ассистанс добавлен, первый администратор приглашён');
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
      title="Новый ассистанс"
      description="Компания, договор и первый администратор ассистанса: остальных пользователей он пригласит сам"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Отмена
          </Button>
          <Button loading={create.isPending} onClick={() => void submit()}>
            Добавить
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Название" error={errors.name}>
          {(a) => <Input {...a} maxLength={120} value={v.name} onChange={set('name')} />}
        </Field>
        <Field label="Телефон 24/7" error={errors.phone24x7}>
          {(a) => <Input {...a} maxLength={30} value={v.phone24x7} onChange={set('phone24x7')} placeholder="+998 71 200 00 00" />}
        </Field>
        <Field label="Подключение" error={errors.integrationMode}>
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
        <Field label="Номер договора" error={errors.contractNumber}>
          {(a) => <Input {...a} maxLength={40} value={v.contractNumber} onChange={set('contractNumber')} />}
        </Field>
        <Field label="Модель вознаграждения" error={errors['contract.feeModel']}>
          {(a) => (
            <Select {...a} value={v.feeModel} onChange={set('feeModel')}>
              {Object.entries(FEE_MODEL_LABEL).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={v.feeModel === 'percent_of_claims' ? 'Доля (0,07 = 7%)' : 'Сумма, UZS'} error={errors['contract.feeValue']}>
          {(a) => <Input {...a} inputMode="decimal" maxLength={14} value={v.feeValue} onChange={set('feeValue')} />}
        </Field>
        <Field label="Полномочия по ГП, UZS" error={errors['contract.guaranteeAuthorityLimit']}>
          {(a) => <Input {...a} inputMode="numeric" maxLength={14} value={v.limit} onChange={set('limit')} />}
        </Field>
        <Field label="Срок оплаты счёта, дней" error={errors['contract.rebillPaymentDays']}>
          {(a) => <Input {...a} inputMode="numeric" maxLength={3} value={v.days} onChange={set('days')} />}
        </Field>
        <Field label="ФИО администратора" error={errors['admin.fullName']}>
          {(a) => <Input {...a} maxLength={120} value={v.adminName} onChange={set('adminName')} />}
        </Field>
        <Field label="Email администратора" error={errors['admin.email']}>
          {(a) => <Input {...a} type="email" maxLength={254} value={v.adminEmail} onChange={set('adminEmail')} />}
        </Field>
      </div>
    </Modal>
  );
}

export default function AssistancesPage() {
  useDocumentTitle('Ассистансы');
  useTopbar([{ label: 'Ассистансы' }]);
  const navigate = useNavigate();
  const q = useAssistances();
  const canManage = useCan('assistance.manage');
  const [creating, setCreating] = useState(false);
  const columns: Column<AssistanceListItem>[] = [
    { key: 'name', header: 'Ассистанс', cell: (a) => <span className="font-medium">{a.name}</span> },
    { key: 'mode', header: 'Подключение', cell: (a) => INTEGRATION_MODE_LABEL[a.integrationMode] },
    { key: 'clients', header: 'Клиентов', align: 'right', cell: (a) => <span className="num">{a.clientsCount}</span> },
    { key: 'insured', header: 'Застрахованных', align: 'right', cell: (a) => <span className="num">{formatNumber(a.insuredCount)}</span> },
    { key: 'gp', header: 'ГП в срок', align: 'right', cell: (a) => <span className="num">{formatPercent(a.kpi.guaranteesOnTimeShare)}</span> },
    { key: 'qa', header: 'Согласие КК', align: 'right', cell: (a) => <span className={a.kpi.qaAgreementShare < 0.9 ? 'num text-warning-text' : 'num'}>{formatPercent(a.kpi.qaAgreementShare)}</span> },
    { key: 'loss', header: 'Убыточность', align: 'right', cell: (a) => <span className="num">{a.kpi.lossRatio === null ? '—' : formatPercent(a.kpi.lossRatio)}</span> },
    { key: 'rebills', header: 'Счета к проверке', align: 'right', cell: (a) => (a.rebillsToReview ? <Chip kind="warning">{a.rebillsToReview}</Chip> : <span className="text-muted">0</span>) },
    { key: 'sla', header: 'Нарушения SLA', align: 'right', cell: (a) => (a.slaBreaches ? <Chip kind="danger">{a.slaBreaches}</Chip> : <span className="text-muted">0</span>) },
  ];
  return (
    <>
      <PageHeader
        title="Ассистанс-компании"
        subtitle="Каждый ассистанс обслуживает своих клиентов. МИГ контролирует: эскалации, выборочный контроль качества, проверку и оплату счетов"
        actions={canManage && <Button onClick={() => setCreating(true)}>Добавить ассистанс</Button>}
      />
      <div className="rounded-card border border-border bg-surface">
        <DataTable
          caption="Ассистансы"
          columns={columns}
          rows={q.data}
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
