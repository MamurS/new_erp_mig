/* One rebill for MIG: line decisions with automatic flags (curator), payment with four-eyes (accountant). */
import { useState } from 'react';
import { useParams } from 'react-router-dom';
import type { RebillLine } from '@mig/contracts';
import { useDecideRebillLine, usePayRebill, useStaffRebill } from '@/shared/api/queries/assist';
import { errorMessage } from '@/shared/api/client';
import { useCan } from '@/shared/auth/guards';
import { useUser } from '@/shared/auth/session';
import { rebillLineDecisionSchema } from '@mig/contracts/forms';
import { t, tm } from '@/i18n';
import { formatMoney } from '@mig/domain/lib/format';
import { useDocumentTitle } from '@/shared/lib/hooks';
import { Button } from '@/shared/ui/button';
import { ConfirmDialog } from '@/shared/ui/confirm-dialog';
import { Modal } from '@/shared/ui/dialog';
import { Field, Textarea } from '@/shared/ui/input';
import { QueryState } from '@/shared/ui/states';
import { toast } from '@/shared/ui/toast';
import { RebillLinesTable, RebillStatus, RebillSummaryBlock } from '@/features/assist/components';
import { useTopbar } from '../topbar';
import { useAiStatus, useRebillPrecheck } from '@/shared/api/queries/ai';
import { Sparkles } from 'lucide-react';

export default function RebillReviewPage() {
  const { rebillId = '' } = useParams();
  const q = useStaffRebill(rebillId);
  useDocumentTitle(t('staffOps.rebill.docTitle'));
  useTopbar([{ label: t('staffOps.rebills.title'), to: '/staff/rebills' }, { label: q.data?.number ?? t('staffOps.rebill.crumb') }]);
  const user = useUser();
  const canReview = useCan('rebills.review');
  const canPayRole = useCan('rebills.pay');
  const decide = useDecideRebillLine();
  const pay = usePayRebill();
  const [rejecting, setRejecting] = useState<RebillLine | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string>();
  const [confirmPay, setConfirmPay] = useState(false);
  const aiStatus = useAiStatus();
  const precheck = useRebillPrecheck();
  const canAi = useCan('ai.coverage.mig') && canReview && !!aiStatus.data?.scenarios.rebill;

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
            toast.success(t('staffOps.registry.lineAccepted'));
          } catch (e) {
            toast.error(errorMessage(e));
          }
        };
        return (
          <div>
            <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
              <div>
                <h1 className="text-[22px] font-bold">
                  {t('staffOps.rebill.heading', { name: r.assistanceName })} <span className="num">{r.number}</span>
                </h1>
                <p className="flex items-center gap-2 text-[12px] text-muted">
                  <span data-testid="rebill-status">
                    <RebillStatus status={r.status} />
                  </span>
                  {t('staffOps.rebill.period', { period: r.period })}
                </p>
              </div>
              {canAi && reviewing && (
                <Button
                  variant="secondary"
                  loading={precheck.isPending}
                  onClick={() =>
                    void precheck
                      .mutateAsync(r.id)
                      .then((x) => toast.success(t('staffOps.rebill.precheckDone', { checked: x.checked, flagged: x.flagged })))
                      .catch((e: unknown) => toast.error(errorMessage(e)))
                  }
                >
                  <Sparkles className="h-4 w-4" aria-hidden /> {t('staffOps.rebill.precheck')}
                </Button>
              )}
              {canPayRole && payable && (
                <Button disabled={sameAsAcceptor} title={sameAsAcceptor ? t('staffOps.rebill.sameAsAcceptor') : undefined} onClick={() => setConfirmPay(true)}>
                  {t('staffOps.registry.payAmount', { amount: formatMoney(toPay) })}
                </Button>
              )}
            </div>
            <RebillSummaryBlock r={r} />
            <RebillLinesTable
              lines={r.lines}
              actions={(l) =>
                canReview && (reviewing || l.status === 'disputed') && (l.status === 'pending' || l.status === 'disputed') ? (
                  <span className="flex justify-end gap-1">
                    <Button size="sm" variant="secondary" onClick={() => void accept(l)} aria-label={t('staffOps.registry.acceptLineAria', { name: l.serviceName })}>
                      {t('staffOps.registry.accept')}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setRejecting(l)} aria-label={t('staffOps.registry.rejectLineAria', { name: l.serviceName })}>
                      {t('common.reject')}
                    </Button>
                  </span>
                ) : null
              }
            />
            {rejecting && (
              <Modal
                open
                onOpenChange={(o) => !o && setRejecting(null)}
                title={t('staffOps.rebill.rejectLine')}
                description={`${rejecting.serviceName} · ${formatMoney(rejecting.amount)}`}
                footer={
                  <>
                    <Button variant="secondary" onClick={() => setRejecting(null)}>
                      {t('common.cancel')}
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
                          toast.success(t('staffOps.registry.lineRejected'));
                          setRejecting(null);
                          setReason('');
                        } catch (e) {
                          toast.error(errorMessage(e));
                        }
                      }}
                    >
                      {t('common.reject')}
                    </Button>
                  </>
                }
              >
                <div className="mb-2 flex flex-wrap gap-1.5">
                  {rejecting.checks.map((c) => (
                    <button key={c.code} type="button" className="rounded-btn border border-border px-2 py-1 text-[12px] hover:bg-rail" onClick={() => setReason(tm(c.message))}>
                      {tm(c.message)}
                    </button>
                  ))}
                </div>
                <Field label={t('common.reason')} error={tm(error) || undefined}>
                  {(a) => <Textarea {...a} rows={3} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />}
                </Field>
              </Modal>
            )}
            <ConfirmDialog
              open={confirmPay}
              onOpenChange={setConfirmPay}
              title={t('staffOps.rebill.confirmTitle')}
              description={t('staffOps.rebill.confirmText', { accepted: formatMoney(r.totals.accepted), fee: formatMoney(r.totals.fee) })}
              confirmLabel={t('staffOps.registry.pay')}
              loading={pay.isPending}
              onConfirm={async () => {
                try {
                  await pay.mutateAsync(r.id);
                  toast.success(t('staffOps.rebill.paid'));
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
