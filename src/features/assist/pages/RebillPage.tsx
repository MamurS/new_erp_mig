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

export default function RebillPage() {
  const { rebillId = '' } = useParams();
  const q = useAssistRebill(rebillId);
  useDocumentTitle('Счёт МИГ');
  useTopbar([{ label: 'Счета МИГ', to: '/assist/rebills' }, { label: q.data?.number ?? 'Счёт' }]);
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
              <h1 className="text-[22px] font-bold">
                Счёт <span className="num">{r.number}</span> за {r.period}
              </h1>
              <span data-testid="rebill-status">
                <RebillStatus status={r.status} />
              </span>
            </div>
            {r.status === 'draft' && (
              <div className="flex gap-2">
                <Button variant="secondary" loading={rebuild.isPending} onClick={() => void rebuild.mutateAsync(r.period).catch((e: unknown) => toast.error(errorMessage(e)))}>
                  Пересобрать из оплат
                </Button>
                <Button disabled={!r.lines.length} onClick={() => setConfirm(true)}>
                  Отправить в МИГ
                </Button>
              </div>
            )}
          </div>
          <RebillSummaryBlock r={r} />
          <RebillLinesTable
            lines={r.lines}
            actions={(l) =>
              l.status === 'rejected' && r.status !== 'paid' ? (
                <Button size="sm" variant="secondary" onClick={() => setDisputing(l)} aria-label={`Оспорить строку ${l.serviceName}`}>
                  Оспорить
                </Button>
              ) : null
            }
          />
          <ConfirmDialog
            open={confirm}
            onOpenChange={setConfirm}
            title="Отправить счёт в МИГ?"
            description={`${r.lines.length} строк на ${formatMoney(r.totals.claims)} и вознаграждение ${formatMoney(r.totals.fee)}. После отправки строки изменить нельзя.`}
            confirmLabel="Отправить"
            loading={submit.isPending}
            onConfirm={async () => {
              try {
                await submit.mutateAsync(r.id);
                toast.success('Счёт отправлен в МИГ');
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
              title="Оспорить отклонение"
              description={`${disputing.serviceName} · ${formatMoney(disputing.amount)} · МИГ: ${disputing.rejectionReason ?? ''}`}
              footer={
                <>
                  <Button variant="secondary" onClick={() => setDisputing(null)}>
                    Отмена
                  </Button>
                  <Button
                    loading={dispute.isPending}
                    onClick={async () => {
                      const parsed = rebillDisputeSchema.safeParse({ comment });
                      if (!parsed.success) {
                        setError(parsed.error.issues[0]?.message);
                        return;
                      }
                      try {
                        await dispute.mutateAsync({ id: r.id, lineId: disputing.id, comment: parsed.data.comment });
                        toast.success('Возражение отправлено в МИГ');
                        setDisputing(null);
                        setComment('');
                      } catch (e) {
                        toast.error(errorMessage(e));
                      }
                    }}
                  >
                    Оспорить
                  </Button>
                </>
              }
            >
              <Field label="Возражение" error={error}>
                {(a) => <Textarea {...a} rows={3} maxLength={1000} value={comment} onChange={(e) => setComment(e.target.value)} />}
              </Field>
            </Modal>
          )}
        </div>
      )}
    </QueryState>
  );
}
