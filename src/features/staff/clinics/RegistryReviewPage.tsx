/* One clinic registry for MIG: line review (operator), guarantee reconciliation, payment (accountant). */
import { useState } from 'react';
import { useParams } from 'react-router-dom';
import type { RegistryLine } from '@/shared/types';
import { useDecideLine, usePayRegistry, useStaffRegistry } from '@/shared/api/queries/clinic';
import { errorMessage } from '@/shared/api/client';
import { useCan } from '@/shared/auth/guards';
import { REGISTRY_LINE_STATUS_LABEL, REGISTRY_STATUS_CHIP, REGISTRY_STATUS_LABEL } from '@/shared/domain/clinics';
import { registryLineDecisionSchema } from '@/shared/schemas/forms';
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
const SOURCE_LABEL = { portal: 'кабинет клиники', csv: 'CSV', api: 'API МИС' } as const;

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
      toast.success('Строка отклонена');
      onClose();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title={line.status === 'disputed' ? 'Оставить отклонение' : 'Отклонить строку'}
      description={`${line.serviceName} · ${formatMoney(line.amount)}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Отмена
          </Button>
          <Button variant="danger" loading={decide.isPending} onClick={() => void send()}>
            Отклонить
          </Button>
        </>
      }
    >
      {line.disputeComment && <p className="mb-3 rounded-btn bg-rail px-3 py-2 text-[13px]">Клиника: {line.disputeComment}</p>}
      <Field label="Причина" error={error}>
        {(a) => <Textarea {...a} rows={3} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />}
      </Field>
    </Modal>
  );
}

export default function RegistryReviewPage() {
  useDocumentTitle('Реестр клиники');
  const { registryId = '' } = useParams();
  const q = useStaffRegistry(registryId);
  useTopbar([{ label: 'Реестры клиник', to: '/staff/registries' }, { label: q.data ? `${q.data.clinicName} · ${q.data.period}` : 'Реестр' }]);
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
      toast.success('Строка принята');
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  const doPay = async () => {
    try {
      await pay.mutateAsync(r.id);
      toast.success('Реестр оплачен');
      setConfirmPay(false);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const columns: Column<RegistryLine>[] = [
    { key: 'date', header: 'Дата', cell: (l) => <span className="num whitespace-nowrap">{formatDate(l.serviceDate)}</span> },
    { key: 'who', header: 'Пациент', cell: (l) => l.insuredName },
    { key: 'svc', header: 'Услуга', cell: (l) => <span>{l.serviceCode} · {l.serviceName}</span> },
    { key: 'icd', header: 'МКБ-10', cell: (l) => <span className="num">{l.icd10}</span> },
    { key: 'amount', header: 'Сумма', align: 'right', cell: (l) => <span className="num whitespace-nowrap">{l.quantity > 1 ? `${l.quantity} × ${formatMoney(l.price, false)} = ` : ''}{formatMoney(l.amount)}</span> },
    {
      key: 'gp',
      header: 'ГП',
      cell: (l) => {
        if (!l.guaranteeNumber) return <span className="text-muted">—</span>;
        const check = r.guaranteeChecks[l.id];
        return (
          <span className="flex flex-col">
            <span className="num">{l.guaranteeNumber}</span>
            {check && (
              <span className={check.ok ? 'text-[12px] text-success-text' : 'text-[12px] text-danger-text'} data-testid="gp-check">
                {check.approvedAmount === null ? 'ГП не одобрено' : check.ok ? `в пределах ${formatMoney(check.approvedAmount)}` : `больше одобренных ${formatMoney(check.approvedAmount)}`}
              </span>
            )}
          </span>
        );
      },
    },
    {
      key: 'status',
      header: 'Статус',
      cell: (l) => (
        <span className="flex flex-col gap-0.5">
          <Chip kind={LINE_CHIP[l.status]}>{REGISTRY_LINE_STATUS_LABEL[l.status]}</Chip>
          {l.rejectionReason && <span className="text-[12px] text-muted">{l.rejectionReason}</span>}
          {l.disputeComment && <span className="text-[12px] text-warning-text">Клиника: {l.disputeComment}</span>}
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

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="text-[22px] font-bold">
            Реестр {r.clinicName} за {r.period}
          </h1>
          <p className="flex flex-wrap items-center gap-2 text-[12px] text-muted">
            <span data-testid="registry-status">
              <Chip kind={REGISTRY_STATUS_CHIP[r.status]}>{REGISTRY_STATUS_LABEL[r.status]}</Chip>
            </span>
            <span>источник: {SOURCE_LABEL[r.source]}</span>
            {r.submittedAt && <span>отправлен {formatDateTime(r.submittedAt)}</span>}
          </p>
        </div>
        {canPay && open && (
          <Button disabled={!payable} onClick={() => setConfirmPay(true)} title={payable ? undefined : disputed ? 'Есть оспоренные строки' : 'Реестр ещё проверяется'}>
            Оплатить {formatMoney(r.totals.accepted)}
          </Button>
        )}
      </div>
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-5">
        {[
          ['Заявлено', formatMoney(r.totals.claimed)],
          ['Принято', formatMoney(r.totals.accepted)],
          ['Отклонено', formatMoney(r.totals.rejected)],
          ['Оплачено', formatMoney(r.totals.paid)],
          ['Дата оплаты', r.paidAt ? formatDate(r.paidAt) : '—'],
        ].map(([label, value]) => (
          <div key={label} className="rounded-card border border-border bg-surface p-3">
            <div className="text-[12px] text-muted">{label}</div>
            <div className="num font-semibold">{value}</div>
          </div>
        ))}
      </div>
      <div className="rounded-card border border-border bg-surface">
        <DataTable caption="Строки реестра" columns={columns} rows={r.lines} rowKey={(l) => l.id} />
      </div>
      {rejecting && <RejectDialog registryId={r.id} line={rejecting} onClose={() => setRejecting(null)} />}
      <ConfirmDialog
        open={confirmPay}
        onOpenChange={setConfirmPay}
        title="Оплатить реестр?"
        description={`К оплате ${formatMoney(r.totals.accepted)} — принятые строки. Убытки по ним перейдут в статус «Оплачен».`}
        confirmLabel="Оплатить"
        loading={pay.isPending}
        onConfirm={() => void doPay()}
      />
    </div>
  );
}
