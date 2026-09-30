/* One sub-registry: line review (doctor, billing), answers to disputes, payment to the clinic (billing). */
import { useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import type { RegistryLine } from '@/shared/types';
import { useAssistDecideLine, useAssistRegistry, useRecordPayment } from '@/shared/api/queries/assist';
import { errorMessage } from '@/shared/api/client';
import { useCan } from '@/shared/auth/guards';
import { REGISTRY_LINE_STATUS_LABEL, REGISTRY_STATUS_CHIP, REGISTRY_STATUS_LABEL } from '@/shared/domain/clinics';
import { clinicPaymentSchema, registryLineDecisionSchema } from '@/shared/schemas/forms';
import { formatDate, formatMoney, todayISO } from '@/shared/lib/format';
import { useDocumentTitle } from '@/shared/lib/hooks';
import { Button } from '@/shared/ui/button';
import { Chip } from '@/shared/ui/chips';
import { DataTable, type Column } from '@/shared/ui/data-table';
import { Modal } from '@/shared/ui/dialog';
import { Field, Input, Textarea } from '@/shared/ui/input';
import { QueryState } from '@/shared/ui/states';
import { toast } from '@/shared/ui/toast';
import { useTopbar } from '@/features/staff/topbar';
import { Stat } from '../components';

const LINE_CHIP = { pending: 'sky', accepted: 'success', rejected: 'danger', disputed: 'warning' } as const;

function PaymentDialog({ registryId, lines, onClose }: { registryId: string; lines: RegistryLine[]; onClose: () => void }) {
  const pay = useRecordPayment();
  const total = lines.reduce((s, l) => s + l.amount, 0);
  const [paidAt, setPaidAt] = useState(todayISO());
  const [orderNumber, setOrderNumber] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const submit = async () => {
    const parsed = clinicPaymentSchema.safeParse({ lineIds: lines.map((l) => l.id), paidAt, amount: total, orderNumber });
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])));
      return;
    }
    try {
      await pay.mutateAsync({ id: registryId, lineIds: parsed.data.lineIds, paidAt: parsed.data.paidAt, amount: total, orderNumber: parsed.data.orderNumber });
      toast.success(`Оплата ${formatMoney(total)} отмечена`);
      onClose();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title="Отметить оплату клинике"
      description={`Строк: ${lines.length} · ${formatMoney(total)}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Отмена
          </Button>
          <Button loading={pay.isPending} onClick={() => void submit()}>
            Отметить оплату
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Дата оплаты" error={errors.paidAt}>
          {(a) => <Input {...a} type="date" value={paidAt} max={todayISO()} onChange={(e) => setPaidAt(e.target.value)} />}
        </Field>
        <Field label="Номер платёжного поручения" error={errors.orderNumber}>
          {(a) => <Input {...a} maxLength={40} value={orderNumber} onChange={(e) => setOrderNumber(e.target.value)} placeholder="ПП-10452" />}
        </Field>
      </div>
    </Modal>
  );
}

export default function RegistryPage() {
  const { registryId = '' } = useParams();
  const q = useAssistRegistry(registryId);
  useDocumentTitle('Реестр клиники');
  useTopbar([{ label: 'Реестры клиник', to: '/assist/registries' }, { label: q.data ? `${q.data.clinicName} · ${q.data.period}` : 'Реестр' }]);
  const canReview = useCan('assist.registries.review');
  const canPay = useCan('assist.clinic_payments.record');
  const decide = useAssistDecideLine();
  const [rejecting, setRejecting] = useState<RegistryLine | null>(null);
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState<string>();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [paying, setPaying] = useState<RegistryLine[] | null>(null);
  const unpaid = useMemo(() => (q.data?.lines ?? []).filter((l) => l.status === 'accepted' && !l.payment), [q.data]);

  const accept = async (l: RegistryLine) => {
    try {
      await decide.mutateAsync({ id: registryId, lineId: l.id, body: { decision: 'accept' } });
      toast.success('Строка принята: лимит списан');
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  const reject = async () => {
    if (!rejecting) return;
    const parsed = registryLineDecisionSchema.safeParse({ decision: 'reject', reason });
    if (!parsed.success) {
      setReasonError(parsed.error.issues[0]?.message);
      return;
    }
    try {
      await decide.mutateAsync({ id: registryId, lineId: rejecting.id, body: parsed.data });
      toast.success('Строка отклонена');
      setRejecting(null);
      setReason('');
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <QueryState query={q}>
      {(r) => {
        const columns: Column<RegistryLine>[] = [
          ...(canPay
            ? [
                {
                  key: 'pick',
                  header: 'Выбор',
                  cell: (l: RegistryLine) =>
                    l.status === 'accepted' && !l.payment ? (
                      <input
                        type="checkbox"
                        aria-label={`Выбрать строку ${l.serviceName}`}
                        checked={selected.has(l.id)}
                        onChange={(e) => {
                          const next = new Set(selected);
                          if (e.target.checked) next.add(l.id);
                          else next.delete(l.id);
                          setSelected(next);
                        }}
                      />
                    ) : null,
                },
              ]
            : []),
          { key: 'date', header: 'Дата', cell: (l) => <span className="num whitespace-nowrap">{formatDate(l.serviceDate)}</span> },
          { key: 'who', header: 'Пациент', cell: (l) => l.insuredName },
          { key: 'svc', header: 'Услуга', cell: (l) => `${l.serviceCode} · ${l.serviceName}` },
          { key: 'icd', header: 'МКБ-10', cell: (l) => <span className="num">{l.icd10}</span> },
          { key: 'amount', header: 'Сумма', align: 'right', cell: (l) => <span className="num whitespace-nowrap">{formatMoney(l.amount)}</span> },
          {
            key: 'gp',
            header: 'ГП',
            cell: (l) => {
              if (!l.guaranteeNumber) return <span className="text-muted">—</span>;
              const check = r.guaranteeChecks[l.id];
              return (
                <span className="flex flex-col">
                  <span className="num">{l.guaranteeNumber}</span>
                  {check && <span className={check.ok ? 'text-[12px] text-success-text' : 'text-[12px] text-danger-text'}>{check.approvedAmount === null ? 'ГП не одобрено' : check.ok ? 'в пределах ГП' : `больше ГП ${formatMoney(check.approvedAmount)}`}</span>}
                </span>
              );
            },
          },
          {
            key: 'status',
            header: 'Проверка и оплата',
            cell: (l) => (
              <span className="flex flex-col gap-0.5">
                <Chip kind={LINE_CHIP[l.status]}>{REGISTRY_LINE_STATUS_LABEL[l.status]}</Chip>
                {l.rejectionReason && <span className="text-[12px] text-muted">{l.rejectionReason}</span>}
                {l.disputeComment && <span className="text-[12px] text-warning-text">Клиника: {l.disputeComment}</span>}
                {l.payment && (
                  <span className="text-[12px] text-success-text" data-testid="line-paid">
                    Оплачено {formatDate(l.payment.paidAt)} · {l.payment.orderNumber}
                  </span>
                )}
              </span>
            ),
          },
          {
            key: 'actions',
            header: '',
            align: 'right',
            cell: (l) =>
              canReview && r.status !== 'paid' && (l.status === 'pending' || l.status === 'disputed') ? (
                <span className="flex justify-end gap-1">
                  <Button size="sm" variant="secondary" onClick={() => void accept(l)} aria-label={`Принять строку ${l.serviceName}`}>
                    Принять
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setRejecting(l)} aria-label={`Отклонить строку ${l.serviceName}`}>
                    {l.status === 'disputed' ? 'Оставить отказ' : 'Отклонить'}
                  </Button>
                </span>
              ) : null,
          },
        ];
        const picked = unpaid.filter((l) => selected.has(l.id));
        return (
          <div>
            <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
              <div>
                <h1 className="text-[22px] font-bold">
                  {r.clinicName} · {r.period}
                </h1>
                <p className="flex items-center gap-2 text-[12px] text-muted">
                  <span data-testid="registry-status">
                    <Chip kind={REGISTRY_STATUS_CHIP[r.status]}>{REGISTRY_STATUS_LABEL[r.status]}</Chip>
                  </span>
                  Подреестр вашего ассистанса: {r.lineCount} строк
                </p>
              </div>
              {canPay && unpaid.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  <Button variant="secondary" disabled={!picked.length} onClick={() => setPaying(picked)}>
                    Оплатить выбранные ({picked.length})
                  </Button>
                  <Button onClick={() => setPaying(unpaid)}>Оплатить все принятые · {formatMoney(unpaid.reduce((s, l) => s + l.amount, 0))}</Button>
                </div>
              )}
            </div>
            <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
              <Stat label="Заявлено" value={formatMoney(r.totals.claimed)} />
              <Stat label="Принято" value={formatMoney(r.totals.accepted)} />
              <Stat label="Отклонено" value={formatMoney(r.totals.rejected)} />
              <Stat label="Оплачено клинике" value={formatMoney(r.totals.paid)} />
            </div>
            <div className="rounded-card border border-border bg-surface">
              <DataTable caption="Строки подреестра" columns={columns} rows={r.lines} rowKey={(l) => l.id} />
            </div>
            {rejecting && (
              <Modal
                open
                onOpenChange={(o) => !o && setRejecting(null)}
                title="Отклонить строку"
                description={`${rejecting.serviceName} · ${formatMoney(rejecting.amount)}`}
                footer={
                  <>
                    <Button variant="secondary" onClick={() => setRejecting(null)}>
                      Отмена
                    </Button>
                    <Button variant="danger" loading={decide.isPending} onClick={() => void reject()}>
                      Отклонить
                    </Button>
                  </>
                }
              >
                <Field label="Причина" error={reasonError}>
                  {(a) => <Textarea {...a} rows={3} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />}
                </Field>
              </Modal>
            )}
            {paying && (
              <PaymentDialog
                registryId={r.id}
                lines={paying}
                onClose={() => {
                  setPaying(null);
                  setSelected(new Set());
                }}
              />
            )}
          </div>
        );
      }}
    </QueryState>
  );
}
