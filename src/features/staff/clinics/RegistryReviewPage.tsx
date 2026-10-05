/* One clinic registry for MIG: line review (operator), guarantee reconciliation, payment (accountant). */
import { useState } from 'react';
import { useParams } from 'react-router-dom';
import type { RegistryLine } from '@/shared/types';
import { useDecideLine, usePayRegistry, useStaffRegistry } from '@/shared/api/queries/clinic';
import { errorMessage } from '@/shared/api/client';
import { useCan } from '@/shared/auth/guards';
import { REGISTRY_LINE_STATUS_LABEL, REGISTRY_STATUS_CHIP, REGISTRY_STATUS_LABEL } from '@/shared/domain/clinics';
import { registryLineDecisionSchema } from '@/shared/schemas/forms';
import { t, tm } from '@/i18n';
import { formatDate, formatDateTime, formatMoney } from '@/shared/lib/format';
import { useDocumentTitle } from '@/shared/lib/hooks';
import { Button } from '@/shared/ui/button';
import { Chip } from '@/shared/ui/chips';
import { ConfirmDialog } from '@/shared/ui/confirm-dialog';
import { DataTable, type Column } from '@/shared/ui/data-table';
import { Modal } from '@/shared/ui/dialog';
import { Field, Textarea } from '@/shared/ui/input';
import { ErrorState, SkeletonRows } from '@/shared/ui/states';
import { toast } from '@/shared/ui/toast';
import { useTopbar } from '../topbar';

const LINE_CHIP = { pending: 'sky', accepted: 'success', rejected: 'danger', disputed: 'warning' } as const;
const sourceLabel = (s: 'portal' | 'csv' | 'api'): string => (s === 'portal' ? t('staffOps.registry.source.portal') : s === 'csv' ? 'CSV' : t('staffOps.registry.source.api'));

function RejectDialog({ registryId, line, onClose }: { registryId: string; line: RegistryLine; onClose: () => void }) {
  const decide = useDecideLine();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string>();
  const send = async () => {
    const parsed = registryLineDecisionSchema.safeParse({ decision: 'reject', reason });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message);
      return;
    }
    try {
      await decide.mutateAsync({ id: registryId, lineId: line.id, body: parsed.data });
      toast.success(t('staffOps.registry.lineRejected'));
      onClose();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title={line.status === 'disputed' ? t('staffOps.registry.keepRejection') : t('staffOps.registry.rejectLine')}
      description={`${line.serviceName} · ${formatMoney(line.amount)}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="danger" loading={decide.isPending} onClick={() => void send()}>
            {t('common.reject')}
          </Button>
        </>
      }
    >
      {line.disputeComment && <p className="mb-3 rounded-btn bg-rail px-3 py-2 text-[13px]">{t('staffOps.registry.clinicSays', { text: line.disputeComment })}</p>}
      <Field label={t('common.reason')} error={tm(error) || undefined}>
        {(a) => <Textarea {...a} rows={3} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />}
      </Field>
    </Modal>
  );
}

export default function RegistryReviewPage() {
  useDocumentTitle(t('staffOps.registry.docTitle'));
  const { registryId = '' } = useParams();
  const q = useStaffRegistry(registryId);
  useTopbar([{ label: t('staffOps.registries.title'), to: '/staff/registries' }, { label: q.data ? `${q.data.clinicName} · ${q.data.period}` : t('staffOps.registry.crumb') }]);
  const canReview = useCan('registries.review');
  const canPay = useCan('registries.pay');
  const decide = useDecideLine();
  const pay = usePayRegistry();
  const [rejecting, setRejecting] = useState<RegistryLine | null>(null);
  const [confirmPay, setConfirmPay] = useState(false);

  if (q.isLoading) return <SkeletonRows rows={8} />;
  if (q.isError || !q.data) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const r = q.data;
  const open = r.status !== 'paid';
  const disputed = r.lines.filter((l) => l.status === 'disputed').length;
  const payable = (r.status === 'accepted' || r.status === 'partially_accepted') && disputed === 0;

  const accept = async (l: RegistryLine) => {
    try {
      await decide.mutateAsync({ id: r.id, lineId: l.id, body: { decision: 'accept' } });
      toast.success(t('staffOps.registry.lineAccepted'));
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  const doPay = async () => {
    try {
      await pay.mutateAsync(r.id);
      toast.success(t('staffOps.registry.paidToast'));
      setConfirmPay(false);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const columns: Column<RegistryLine>[] = [
    { key: 'date', header: t('common.date'), cell: (l) => <span className="num whitespace-nowrap">{formatDate(l.serviceDate)}</span> },
    { key: 'who', header: t('common.patient'), cell: (l) => l.insuredName },
    { key: 'svc', header: t('common.service'), cell: (l) => <span>{l.serviceCode} · {l.serviceName}</span> },
    { key: 'icd', header: t('staffOps.registry.col.icd'), cell: (l) => <span className="num">{l.icd10}</span> },
    { key: 'amount', header: t('common.amount'), align: 'right', cell: (l) => <span className="num whitespace-nowrap">{l.quantity > 1 ? `${l.quantity} × ${formatMoney(l.price, false)} = ` : ''}{formatMoney(l.amount)}</span> },
    {
      key: 'gp',
      header: t('staffOps.registry.col.gl'),
      cell: (l) => {
        if (!l.guaranteeNumber) return <span className="text-muted">—</span>;
        const check = r.guaranteeChecks[l.id];
        return (
          <span className="flex flex-col">
            <span className="num">{l.guaranteeNumber}</span>
            {check && (
              <span className={check.ok ? 'text-[12px] text-success-text' : 'text-[12px] text-danger-text'} data-testid="gp-check">
                {check.approvedAmount === null ? t('staffOps.registry.glNotApproved') : check.ok ? t('staffOps.registry.glWithin', { amount: formatMoney(check.approvedAmount) }) : t('staffOps.registry.glOver', { amount: formatMoney(check.approvedAmount) })}
              </span>
            )}
          </span>
        );
      },
    },
    {
      key: 'status',
      header: t('common.status'),
      cell: (l) => (
        <span className="flex flex-col gap-0.5">
          <Chip kind={LINE_CHIP[l.status]}>{REGISTRY_LINE_STATUS_LABEL[l.status]}</Chip>
          {l.rejectionReason && <span className="text-[12px] text-muted">{l.rejectionReason}</span>}
          {l.disputeComment && <span className="text-[12px] text-warning-text">{t('staffOps.registry.clinicSays', { text: l.disputeComment })}</span>}
        </span>
      ),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      cell: (l) =>
        canReview && open && (l.status === 'pending' || l.status === 'disputed') ? (
          <span className="flex justify-end gap-1">
            <Button size="sm" variant="secondary" onClick={() => void accept(l)} aria-label={t('staffOps.registry.acceptLineAria', { name: l.serviceName })}>
              {t('staffOps.registry.accept')}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setRejecting(l)} aria-label={t('staffOps.registry.rejectLineAria', { name: l.serviceName })}>
              {l.status === 'disputed' ? t('staffOps.registry.keepDenial') : t('common.reject')}
            </Button>
          </span>
        ) : null,
    },
  ];

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="text-[22px] font-bold">
            {t('staffOps.registry.heading', { clinic: r.clinicName, period: r.period })}
          </h1>
          <p className="flex flex-wrap items-center gap-2 text-[12px] text-muted">
            <span data-testid="registry-status">
              <Chip kind={REGISTRY_STATUS_CHIP[r.status]}>{REGISTRY_STATUS_LABEL[r.status]}</Chip>
            </span>
            <span>{t('staffOps.registry.sourceLine', { source: sourceLabel(r.source) })}</span>
            {r.submittedAt && <span>{t('staffOps.registry.sentAt', { date: formatDateTime(r.submittedAt) })}</span>}
          </p>
        </div>
        {canPay && open && (
          <Button disabled={!payable} onClick={() => setConfirmPay(true)} title={payable ? undefined : disputed ? t('staffOps.registry.hasDisputed') : t('staffOps.registry.stillReviewing')}>
            {t('staffOps.registry.payAmount', { amount: formatMoney(r.totals.accepted) })}
          </Button>
        )}
      </div>
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-5">
        {[
          [t('staffOps.registries.claimed'), formatMoney(r.totals.claimed)],
          [t('staffOps.registries.accepted'), formatMoney(r.totals.accepted)],
          [t('staffOps.registry.rejectedTotal'), formatMoney(r.totals.rejected)],
          [t('staffOps.registry.paidTotal'), formatMoney(r.totals.paid)],
          [t('staffOps.registry.paidAt'), r.paidAt ? formatDate(r.paidAt) : '—'],
        ].map(([label, value]) => (
          <div key={label} className="rounded-card border border-border bg-surface p-3">
            <div className="text-[12px] text-muted">{label}</div>
            <div className="num font-semibold">{value}</div>
          </div>
        ))}
      </div>
      <div className="rounded-card border border-border bg-surface">
        <DataTable caption={t('staffOps.registry.linesCaption')} columns={columns} rows={r.lines} rowKey={(l) => l.id} />
      </div>
      {rejecting && <RejectDialog registryId={r.id} line={rejecting} onClose={() => setRejecting(null)} />}
      <ConfirmDialog
        open={confirmPay}
        onOpenChange={setConfirmPay}
        title={t('staffOps.registry.confirmTitle')}
        description={t('staffOps.registry.confirmText', { amount: formatMoney(r.totals.accepted) })}
        confirmLabel={t('staffOps.registry.pay')}
        loading={pay.isPending}
        onConfirm={() => void doPay()}
      />
    </div>
  );
}
