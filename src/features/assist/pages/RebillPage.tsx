/* One rebill for the assistance: draft → submit, the checks of MIG, disputes of rejected lines, payment status. */
import { useState } from 'react';
import { useParams } from 'react-router-dom';
import type { RebillLine } from '@/shared/types';
import { useAssistRebill, useBuildRebill, useDisputeRebillLine, useSubmitRebill } from '@/shared/api/queries/assist';
import { errorMessage } from '@/shared/api/client';
import { rebillDisputeSchema } from '@/shared/schemas/forms';
import { formatMoney } from '@/shared/lib/format';
import { useDocumentTitle } from '@/shared/lib/hooks';
import { Button } from '@/shared/ui/button';
import { ConfirmDialog } from '@/shared/ui/confirm-dialog';
import { Modal } from '@/shared/ui/dialog';
import { Field, Textarea } from '@/shared/ui/input';
import { QueryState } from '@/shared/ui/states';
import { toast } from '@/shared/ui/toast';
import { useTopbar } from '@/features/staff/topbar';
import { RebillLinesTable, RebillStatus, RebillSummaryBlock } from '../components';
import { t, tm } from '@/i18n';

export default function RebillPage() {
  const { rebillId = '' } = useParams();
  const q = useAssistRebill(rebillId);
  useDocumentTitle(t('assist.rebill.docTitle'));
  useTopbar([{ label: t('assist.nav.rebills'), to: '/assist/rebills' }, { label: q.data?.number ?? t('assist.rebill.crumb') }]);
  const submit = useSubmitRebill();
  const rebuild = useBuildRebill();
  const dispute = useDisputeRebillLine();
  const [confirm, setConfirm] = useState(false);
  const [disputing, setDisputing] = useState<RebillLine | null>(null);
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string>();

  return (
    <QueryState query={q}>
      {(r) => (
        <div>
          <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-[22px] font-bold">{t('assist.rebill.heading', { number: r.number, period: r.period })}</h1>
              <span data-testid="rebill-status">
                <RebillStatus status={r.status} />
              </span>
            </div>
            {r.status === 'draft' && (
              <div className="flex gap-2">
                <Button variant="secondary" loading={rebuild.isPending} onClick={() => void rebuild.mutateAsync(r.period).catch((e: unknown) => toast.error(errorMessage(e)))}>
                  {t('assist.rebill.rebuild')}
                </Button>
                <Button disabled={!r.lines.length} onClick={() => setConfirm(true)}>
                  {t('assist.rebill.sendToMig')}
                </Button>
              </div>
            )}
          </div>
          <RebillSummaryBlock r={r} />
          <RebillLinesTable
            lines={r.lines}
            actions={(l) =>
              l.status === 'rejected' && r.status !== 'paid' ? (
                <Button size="sm" variant="secondary" onClick={() => setDisputing(l)} aria-label={t('assist.rebill.disputeAria', { name: l.serviceName })}>
                  {t('assist.rebill.dispute')}
                </Button>
              ) : null
            }
          />
          <ConfirmDialog
            open={confirm}
            onOpenChange={setConfirm}
            title={t('assist.rebill.confirmTitle')}
            description={t('assist.rebill.confirmDescription', { n: r.lines.length, claims: formatMoney(r.totals.claims), fee: formatMoney(r.totals.fee) })}
            confirmLabel={t('common.send')}
            loading={submit.isPending}
            onConfirm={async () => {
              try {
                await submit.mutateAsync(r.id);
                toast.success(t('assist.rebill.sent'));
                setConfirm(false);
              } catch (e) {
                toast.error(errorMessage(e));
              }
            }}
          />
          {disputing && (
            <Modal
              open
              onOpenChange={(o) => !o && setDisputing(null)}
              title={t('assist.rebill.disputeTitle')}
              description={t('assist.rebill.disputeDescription', { service: disputing.serviceName, amount: formatMoney(disputing.amount), reason: disputing.rejectionReason ?? '' })}
              footer={
                <>
                  <Button variant="secondary" onClick={() => setDisputing(null)}>
                    {t('common.cancel')}
                  </Button>
                  <Button
                    loading={dispute.isPending}
                    onClick={async () => {
                      const parsed = rebillDisputeSchema.safeParse({ comment });
                      if (!parsed.success) {
                        setError(tm(parsed.error.issues[0]?.message));
                        return;
                      }
                      try {
                        await dispute.mutateAsync({ id: r.id, lineId: disputing.id, comment: parsed.data.comment });
                        toast.success(t('assist.rebill.disputeSent'));
                        setDisputing(null);
                        setComment('');
                      } catch (e) {
                        toast.error(errorMessage(e));
                      }
                    }}
                  >
                    {t('assist.rebill.dispute')}
                  </Button>
                </>
              }
            >
              <Field label={t('assist.rebill.objection')} error={error}>
                {(a) => <Textarea {...a} rows={3} maxLength={1000} value={comment} onChange={(e) => setComment(e.target.value)} />}
              </Field>
            </Modal>
          )}
        </div>
      )}
    </QueryState>
  );
}
