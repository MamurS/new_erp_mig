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
import { defineLabels, t, tm } from '@/i18n';

const SOURCE_LABEL = defineLabels('assist.registry.source', ['portal', 'csv', 'api'] as const);
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
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), tm(i.message)])));
      return;
    }
    try {
      await pay.mutateAsync({ id: registryId, lineIds: parsed.data.lineIds, paidAt: parsed.data.paidAt, amount: total, orderNumber: parsed.data.orderNumber });
      toast.success(t('assist.registry.paymentMarked', { amount: formatMoney(total) }));
      onClose();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('assist.registry.payTitle')}
      description={t('assist.registry.payDescription', { n: lines.length, amount: formatMoney(total) })}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button loading={pay.isPending} onClick={() => void submit()}>
            {t('assist.registry.markPaid')}
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t('assist.registry.paidAt')} error={errors.paidAt}>
          {(a) => <Input {...a} type="date" value={paidAt} max={todayISO()} onChange={(e) => setPaidAt(e.target.value)} />}
        </Field>
        <Field label={t('assist.registry.orderNumber')} error={errors.orderNumber}>
          {(a) => <Input {...a} maxLength={40} value={orderNumber} onChange={(e) => setOrderNumber(e.target.value)} placeholder={t('assist.registry.orderPlaceholder')} />}
        </Field>
      </div>
    </Modal>
  );
}

export default function RegistryPage() {
  const { registryId = '' } = useParams();
  const q = useAssistRegistry(registryId);
  useDocumentTitle(t('assist.registry.docTitle'));
  useTopbar([{ label: t('assist.nav.registries'), to: '/assist/registries' }, { label: q.data ? `${q.data.clinicName} · ${q.data.period}` : t('assist.registry.crumb') }]);
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
      toast.success(t('assist.registry.lineAccepted'));
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  const reject = async () => {
    if (!rejecting) return;
    const parsed = registryLineDecisionSchema.safeParse({ decision: 'reject', reason });
    if (!parsed.success) {
      setReasonError(tm(parsed.error.issues[0]?.message));
      return;
    }
    try {
      await decide.mutateAsync({ id: registryId, lineId: rejecting.id, body: parsed.data });
      toast.success(t('assist.registry.lineRejected'));
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
                  header: t('assist.registry.pick'),
                  cell: (l: RegistryLine) =>
                    l.status === 'accepted' && !l.payment ? (
                      <input
                        type="checkbox"
                        aria-label={t('assist.registry.pickAria', { name: l.serviceName })}
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
          { key: 'date', header: t('common.date'), cell: (l) => <span className="num whitespace-nowrap">{formatDate(l.serviceDate)}</span> },
          { key: 'who', header: t('common.patient'), cell: (l) => l.insuredName },
          { key: 'svc', header: t('common.service'), cell: (l) => `${l.serviceCode} · ${l.serviceName}` },
          { key: 'icd', header: t('assist.guarantee.icd10'), cell: (l) => <span className="num">{l.icd10}</span> },
          { key: 'amount', header: t('common.amount'), align: 'right', cell: (l) => <span className="num whitespace-nowrap">{formatMoney(l.amount)}</span> },
          {
            key: 'gp',
            header: t('assist.case.guarantee'),
            cell: (l) => {
              if (!l.guaranteeNumber) return <span className="text-muted">—</span>;
              const check = r.guaranteeChecks[l.id];
              return (
                <span className="flex flex-col">
                  <span className="num">{l.guaranteeNumber}</span>
                  {check && <span className={check.ok ? 'text-[12px] text-success-text' : 'text-[12px] text-danger-text'}>{check.approvedAmount === null ? t('assist.registry.gpNotApproved') : check.ok ? t('assist.registry.withinGp') : t('assist.registry.overGp', { amount: formatMoney(check.approvedAmount) })}</span>}
                </span>
              );
            },
          },
          {
            key: 'status',
            header: t('assist.registry.checkAndPay'),
            cell: (l) => (
              <span className="flex flex-col gap-0.5">
                <Chip kind={LINE_CHIP[l.status]}>{REGISTRY_LINE_STATUS_LABEL[l.status]}</Chip>
                {l.rejectionReason && <span className="text-[12px] text-muted">{l.rejectionReason}</span>}
                {l.disputeComment && <span className="text-[12px] text-warning-text">{t('assist.registry.clinicDispute', { text: l.disputeComment })}</span>}
                {l.payment && (
                  <span className="text-[12px] text-success-text" data-testid="line-paid">
                    {t('assist.registry.linePaid', { date: formatDate(l.payment.paidAt), order: l.payment.orderNumber })}
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
                  <Button size="sm" variant="secondary" onClick={() => void accept(l)} aria-label={t('assist.registry.acceptAria', { name: l.serviceName })}>
                    {t('assist.registry.accept')}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setRejecting(l)} aria-label={t('assist.registry.rejectAria', { name: l.serviceName })}>
                    {l.status === 'disputed' ? t('assist.registry.keepRejection') : t('common.reject')}
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
                  <span>{t('assist.registry.source', { source: SOURCE_LABEL[r.source] })}</span>
                  <span>{t('assist.registry.subRegistry', { n: r.lineCount })}</span>
                </p>
              </div>
              {canPay && unpaid.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  <Button variant="secondary" disabled={!picked.length} onClick={() => setPaying(picked)}>
                    {t('assist.registry.paySelected', { n: picked.length })}
                  </Button>
                  <Button onClick={() => setPaying(unpaid)}>{t('assist.registry.payAll', { amount: formatMoney(unpaid.reduce((s, l) => s + l.amount, 0)) })}</Button>
                </div>
              )}
            </div>
            <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
              <Stat label={t('assist.registry.claimed')} value={formatMoney(r.totals.claimed)} />
              <Stat label={t('assist.registry.accepted')} value={formatMoney(r.totals.accepted)} />
              <Stat label={t('assist.registry.rejected')} value={formatMoney(r.totals.rejected)} />
              <Stat label={t('assist.registry.paidToClinic')} value={formatMoney(r.totals.paid)} />
            </div>
            <div className="rounded-card border border-border bg-surface">
              <DataTable caption={t('assist.registry.caption')} columns={columns} rows={r.lines} rowKey={(l) => l.id} />
            </div>
            {rejecting && (
              <Modal
                open
                onOpenChange={(o) => !o && setRejecting(null)}
                title={t('assist.registry.rejectTitle')}
                description={`${rejecting.serviceName} · ${formatMoney(rejecting.amount)}`}
                footer={
                  <>
                    <Button variant="secondary" onClick={() => setRejecting(null)}>
                      {t('common.cancel')}
                    </Button>
                    <Button variant="danger" loading={decide.isPending} onClick={() => void reject()}>
                      {t('common.reject')}
                    </Button>
                  </>
                }
              >
                <Field label={t('common.reason')} error={reasonError}>
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
