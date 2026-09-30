/* Guarantee letters queue (CLINIC_SPEC §5): doctor_expert approves / rejects / requests documents; four-eyes above the threshold. */
import { useState } from 'react';
import { Download } from 'lucide-react';
import type { GuaranteeStatus } from '@/shared/types';
import type { GuaranteeView } from '@/shared/types/dto';
import { useDecideGuarantee, useStaffGuarantees } from '@/shared/api/queries/clinic';
import { errorMessage } from '@/shared/api/client';
import { downloadFile } from '@/shared/api/files';
import { useUser } from '@/shared/auth/session';
import { can } from '@/shared/auth/permissions';
import { GUARANTEE_DUAL_APPROVAL_THRESHOLD, GUARANTEE_STATUS_CHIP, GUARANTEE_STATUS_LABEL, needsSecondApproval } from '@/shared/domain/clinics';
import { guaranteeDecisionSchema } from '@/shared/schemas/forms';
import { addDaysISO, formatDate, formatDateTime, formatMoney, todayISO } from '@/shared/lib/format';
import { useDocumentTitle, useUrlFilters } from '@/shared/lib/hooks';
import { Button } from '@/shared/ui/button';
import { Chip } from '@/shared/ui/chips';
import { DataTable, type Column } from '@/shared/ui/data-table';
import { Modal } from '@/shared/ui/dialog';
import { Field, Input, Textarea } from '@/shared/ui/input';
import { Kv } from '@/shared/ui/page';
import { EmptyState } from '@/shared/ui/states';
import { Tabs, TabsList, TabsTrigger } from '@/shared/ui/tabs';
import { toast } from '@/shared/ui/toast';
import { useTopbar } from '../topbar';

const TABS: [string, string][] = [
  ['requested', 'Ждут решения'],
  ['info_requested', 'Ждут документы'],
  ['approved,used', 'Одобрены'],
  ['rejected,expired', 'Отклонены и истекли'],
  ['all', 'Все'],
];

type Mode = 'approve' | 'reject' | 'request_info';

function DecisionDialog({ g, onClose }: { g: GuaranteeView; onClose: () => void }) {
  const user = useUser()!;
  const decide = useDecideGuarantee();
  const canDecide = can(user, 'guarantees.decide') && g.status === 'requested';
  const firstApproval = g.approvals[0];
  const alreadyApprovedByMe = g.approvals.some((a) => a.byId === user.id);
  const [mode, setMode] = useState<Mode>('approve');
  const [amount, setAmount] = useState(String(g.approvedAmount ?? g.estimatedCost));
  const [validUntil, setValidUntil] = useState(g.validUntil ?? addDaysISO(todayISO(), 30));
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const amountNum = Number(amount.replace(/\s/g, ''));

  const submit = async () => {
    const raw = mode === 'approve' ? { action: mode, amount: amountNum, validUntil } : { action: mode, reason };
    const parsed = guaranteeDecisionSchema.safeParse(raw);
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])));
      return;
    }
    setErrors({});
    try {
      const res = await decide.mutateAsync({ id: g.id, body: parsed.data });
      toast.success(
        res.status === 'approved' ? 'Письмо одобрено' : res.status === 'requested' ? 'Первое одобрение сохранено — нужно одобрение второго врача-эксперта' : res.status === 'rejected' ? 'Письмо отклонено' : 'Клинике отправлен запрос документов',
      );
      onClose();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <Modal
      open
      wide
      onOpenChange={(o) => !o && onClose()}
      title={`Гарантийное письмо ${g.number}`}
      description={`${g.clinicName} · ${formatDateTime(g.createdAt)}`}
      footer={
        canDecide ? (
          <>
            <Button variant="secondary" onClick={onClose}>
              Отмена
            </Button>
            <Button loading={decide.isPending} disabled={mode === 'approve' && alreadyApprovedByMe} onClick={() => void submit()}>
              {mode === 'approve' ? 'Одобрить' : mode === 'reject' ? 'Отклонить' : 'Запросить документы'}
            </Button>
          </>
        ) : (
          <Button variant="secondary" onClick={onClose}>
            Закрыть
          </Button>
        )
      }
    >
      <div className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
        <Kv label="Пациент">{g.insuredName}</Kv>
        <Kv label="Статус">
          <Chip kind={GUARANTEE_STATUS_CHIP[g.status]}>{GUARANTEE_STATUS_LABEL[g.status]}</Chip>
        </Kv>
        <Kv label="Услуга">
          {g.serviceCode} · {g.serviceName}
        </Kv>
        <Kv label="МКБ-10">{g.icd10}</Kv>
        <Kv label="Оценка стоимости">
          <span className="num">{formatMoney(g.estimatedCost)}</span>
        </Kv>
        {g.approvedAmount !== undefined && (
          <Kv label="Одобренная сумма">
            <span className="num">{formatMoney(g.approvedAmount)}</span>
            {g.validUntil ? ` до ${formatDate(g.validUntil)}` : ''}
          </Kv>
        )}
      </div>
      {g.comment && <p className="mt-3 rounded-btn bg-rail px-3 py-2 text-[13px]">Комментарий клиники: {g.comment}</p>}
      {g.infoComment && <p className="mt-2 rounded-btn bg-rail px-3 py-2 text-[13px]">Ответ клиники на запрос документов: {g.infoComment}</p>}
      {g.reason && <p className="mt-2 text-[13px] text-muted">Причина решения: {g.reason}</p>}
      {g.attachments.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-2">
          {g.attachments.map((a) => (
            <li key={a.id}>
              <Button size="sm" variant="secondary" onClick={() => void downloadFile(a.id, a.fileName).catch((e: unknown) => toast.error(errorMessage(e)))}>
                <Download className="h-3.5 w-3.5" aria-hidden /> {a.fileName}
              </Button>
            </li>
          ))}
        </ul>
      )}
      {firstApproval && g.status === 'requested' && (
        <p className="mt-3 rounded-btn bg-warning-soft px-3 py-2 text-[13px] text-warning-text" data-testid="four-eyes-note">
          Первое одобрение: {firstApproval.byName}, {formatDateTime(firstApproval.at)}. Сумма выше {formatMoney(GUARANTEE_DUAL_APPROVAL_THRESHOLD)} — нужно одобрение второго врача-эксперта.
          {alreadyApprovedByMe && ' Вы уже одобрили это письмо.'}
        </p>
      )}
      {canDecide && (
        <div className="mt-4 flex flex-col gap-3 border-t border-border-soft pt-4">
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Решение">
            {(
              [
                ['approve', 'Одобрить'],
                ['reject', 'Отклонить'],
                ['request_info', 'Запросить документы'],
              ] as const
            ).map(([m, label]) => (
              <label key={m} className="flex items-center gap-1.5">
                <input type="radio" name="decision" checked={mode === m} onChange={() => setMode(m)} />
                {label}
              </label>
            ))}
          </div>
          {mode === 'approve' ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Сумма, UZS" error={errors.amount} hint={needsSecondApproval(amountNum) ? 'Выше порога — понадобится второй врач-эксперт' : undefined}>
                {(a) => <Input {...a} inputMode="numeric" maxLength={14} value={amount} onChange={(e) => setAmount(e.target.value)} />}
              </Field>
              <Field label="Действует до" error={errors.validUntil}>
                {(a) => <Input {...a} type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />}
              </Field>
            </div>
          ) : (
            <Field label={mode === 'reject' ? 'Причина отказа' : 'Какие документы нужны'} error={errors.reason}>
              {(a) => <Textarea {...a} rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />}
            </Field>
          )}
        </div>
      )}
    </Modal>
  );
}

export default function GuaranteesQueuePage() {
  useDocumentTitle('Гарантийные письма');
  useTopbar([{ label: 'Гарантийные письма' }]);
  const [f, setF] = useUrlFilters(['status', 'clinicId'] as const);
  const status = TABS.some(([k]) => k === f.status) ? f.status : 'requested';
  const list = useStaffGuarantees({ ...(status === 'all' ? {} : { status }), ...(f.clinicId ? { clinicId: f.clinicId } : {}) });
  const [open, setOpen] = useState<GuaranteeView | null>(null);
  const cols: Column<GuaranteeView>[] = [
    { key: 'num', header: 'Номер', cell: (g) => <span className="num font-medium">{g.number}</span> },
    { key: 'created', header: 'Создано', cell: (g) => <span className="num text-muted">{formatDateTime(g.createdAt)}</span> },
    { key: 'clinic', header: 'Клиника', cell: (g) => g.clinicName },
    { key: 'patient', header: 'Пациент', cell: (g) => g.insuredName },
    { key: 'service', header: 'Услуга', cell: (g) => <span className="line-clamp-2">{g.serviceName}</span> },
    { key: 'cost', header: 'Сумма', align: 'right', cell: (g) => <span className="num whitespace-nowrap">{formatMoney(g.approvedAmount ?? g.estimatedCost)}</span> },
    {
      key: 'status',
      header: 'Статус',
      cell: (g: GuaranteeView) => (
        <span className="flex flex-wrap items-center gap-1">
          <Chip kind={GUARANTEE_STATUS_CHIP[g.status as GuaranteeStatus]}>{GUARANTEE_STATUS_LABEL[g.status]}</Chip>
          {g.status === 'requested' && g.approvals.length > 0 && <Chip kind="warning">1 из 2 одобрений</Chip>}
        </span>
      ),
    },
  ];
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-[22px] font-bold">Гарантийные письма</h1>
        <p className="text-[12px] text-muted">Выше {formatMoney(GUARANTEE_DUAL_APPROVAL_THRESHOLD)} письмо одобряют два врача-эксперта</p>
      </div>
      <Tabs value={status} onValueChange={(v) => setF({ status: v === 'requested' ? null : v })}>
        <TabsList>
          {TABS.map(([k, label]) => (
            <TabsTrigger key={k} value={k}>
              {label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <div className="mt-3 rounded-card border border-border bg-surface">
        <DataTable
          caption="Гарантийные письма"
          columns={cols}
          rows={list.data}
          rowKey={(g) => g.id}
          onRowClick={setOpen}
          loading={list.isLoading}
          error={list.error}
          onRetry={() => void list.refetch()}
          empty={<EmptyState title="Писем нет" />}
        />
      </div>
      {open && <DecisionDialog key={open.id} g={open} onClose={() => setOpen(null)} />}
    </div>
  );
}
