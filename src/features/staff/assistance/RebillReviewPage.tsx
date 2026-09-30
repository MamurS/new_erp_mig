/* One rebill for MIG: line decisions with automatic flags (curator), payment with four-eyes (accountant). */
import { useState } from 'react';
import { useParams } from 'react-router-dom';
import type { RebillLine } from '@/shared/types';
import { useDecideRebillLine, usePayRebill, useStaffRebill } from '@/shared/api/queries/assist';
import { errorMessage } from '@/shared/api/client';
import { useCan } from '@/shared/auth/guards';
import { useUser } from '@/shared/auth/session';
import { rebillLineDecisionSchema } from '@/shared/schemas/forms';
import { formatMoney } from '@/shared/lib/format';
import { useDocumentTitle } from '@/shared/lib/hooks';
import { Button } from '@/shared/ui/button';
import { ConfirmDialog } from '@/shared/ui/confirm-dialog';
import { Modal } from '@/shared/ui/dialog';
import { Field, Textarea } from '@/shared/ui/input';
import { QueryState } from '@/shared/ui/states';
import { toast } from '@/shared/ui/toast';
import { RebillLinesTable, RebillStatus, RebillSummaryBlock } from '@/features/assist/components';
import { useTopbar } from '../topbar';

export default function RebillReviewPage() {
  const { rebillId = '' } = useParams();
  const q = useStaffRebill(rebillId);
  useDocumentTitle('Счёт ассистанса');
  useTopbar([{ label: 'Счета ассистансов', to: '/staff/rebills' }, { label: q.data?.number ?? 'Счёт' }]);
  const user = useUser();
  const canReview = useCan('rebills.review');
  const canPayRole = useCan('rebills.pay');
  const decide = useDecideRebillLine();
  const pay = usePayRebill();
  const [rejecting, setRejecting] = useState<RebillLine | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string>();
  const [confirmPay, setConfirmPay] = useState(false);

  return (
    <QueryState query={q}>
      {(r) => {
        const reviewing = r.status === 'submitted' || r.status === 'in_review';
        const payable = r.status === 'accepted' || r.status === 'partially_accepted';
        const sameAsAcceptor = !!r.acceptedById && r.acceptedById === user?.id;
        const toPay = r.totals.accepted + r.totals.fee;
        const accept = async (l: RebillLine) => {
          try {
            await decide.mutateAsync({ id: r.id, lineId: l.id, body: { decision: 'accept' } });
            toast.success('Строка принята');
          } catch (e) {
            toast.error(errorMessage(e));
          }
        };
        return (
          <div>
            <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
              <div>
                <h1 className="text-[22px] font-bold">
                  {r.assistanceName}: счёт <span className="num">{r.number}</span>
                </h1>
                <p className="flex items-center gap-2 text-[12px] text-muted">
                  <span data-testid="rebill-status">
                    <RebillStatus status={r.status} />
                  </span>
                  Период {r.period}
                </p>
              </div>
              {canPayRole && payable && (
                <Button disabled={sameAsAcceptor} title={sameAsAcceptor ? 'Счёт принимали вы: оплачивает другой сотрудник' : undefined} onClick={() => setConfirmPay(true)}>
                  Оплатить {formatMoney(toPay)}
                </Button>
              )}
            </div>
            <RebillSummaryBlock r={r} />
            <RebillLinesTable
              lines={r.lines}
              actions={(l) =>
                canReview && (reviewing || l.status === 'disputed') && (l.status === 'pending' || l.status === 'disputed') ? (
                  <span className="flex justify-end gap-1">
                    <Button size="sm" variant="secondary" onClick={() => void accept(l)} aria-label={`Принять строку ${l.serviceName}`}>
                      Принять
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setRejecting(l)} aria-label={`Отклонить строку ${l.serviceName}`}>
                      Отклонить
                    </Button>
                  </span>
                ) : null
              }
            />
            {rejecting && (
              <Modal
                open
                onOpenChange={(o) => !o && setRejecting(null)}
                title="Отклонить строку счёта"
                description={`${rejecting.serviceName} · ${formatMoney(rejecting.amount)}`}
                footer={
                  <>
                    <Button variant="secondary" onClick={() => setRejecting(null)}>
                      Отмена
                    </Button>
                    <Button
                      variant="danger"
                      loading={decide.isPending}
                      onClick={async () => {
                        const parsed = rebillLineDecisionSchema.safeParse({ decision: 'reject', reason });
                        if (!parsed.success) {
                          setError(parsed.error.issues[0]?.message);
                          return;
                        }
                        try {
                          await decide.mutateAsync({ id: r.id, lineId: rejecting.id, body: parsed.data });
                          toast.success('Строка отклонена');
                          setRejecting(null);
                          setReason('');
                        } catch (e) {
                          toast.error(errorMessage(e));
                        }
                      }}
                    >
                      Отклонить
                    </Button>
                  </>
                }
              >
                <div className="mb-2 flex flex-wrap gap-1.5">
                  {rejecting.checks.map((c) => (
                    <button key={c.code} type="button" className="rounded-btn border border-border px-2 py-1 text-[12px] hover:bg-rail" onClick={() => setReason(c.message)}>
                      {c.message}
                    </button>
                  ))}
                </div>
                <Field label="Причина" error={error}>
                  {(a) => <Textarea {...a} rows={3} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />}
                </Field>
              </Modal>
            )}
            <ConfirmDialog
              open={confirmPay}
              onOpenChange={setConfirmPay}
              title="Оплатить счёт ассистанса?"
              description={`${formatMoney(r.totals.accepted)} по принятым строкам и вознаграждение ${formatMoney(r.totals.fee)}. Убытки по строкам перейдут в статус «Оплачен».`}
              confirmLabel="Оплатить"
              loading={pay.isPending}
              onConfirm={async () => {
                try {
                  await pay.mutateAsync(r.id);
                  toast.success('Счёт оплачен');
                  setConfirmPay(false);
                } catch (e) {
                  toast.error(errorMessage(e));
                }
              }}
            />
          </div>
        );
      }}
    </QueryState>
  );
}
