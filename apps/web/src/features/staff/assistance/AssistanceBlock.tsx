/*
 * «Ассистанс» of a policy with its history (ASSISTANCE_SPEC §3, §7). The underwriter changes the
 * assistance from a date: new requests from that date go to the new company.
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAssign, useAssignments, useAssistances } from '@/shared/api/queries/assist';
import { errorMessage } from '@/shared/api/client';
import { useCan } from '@/shared/auth/guards';
import { assignmentSchema } from '@mig/contracts/forms';
import { t, tm } from '@/i18n';
import { formatDate, todayISO } from '@mig/domain/lib/format';
import { Button } from '@/shared/ui/button';
import { Modal } from '@/shared/ui/dialog';
import { Field, Input, Select } from '@/shared/ui/input';
import { Card } from '@/shared/ui/page';
import { SkeletonRows } from '@/shared/ui/states';
import { toast } from '@/shared/ui/toast';

function ChangeDialog({ policyId, current, onClose }: { policyId: string; current: string | null; onClose: () => void }) {
  const list = useAssistances();
  const assign = useAssign();
  const [assistanceId, setAssistanceId] = useState(current ?? '');
  const [from, setFrom] = useState(todayISO());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const submit = async () => {
    const parsed = assignmentSchema.safeParse({ assistanceId: assistanceId || null, from });
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])));
      return;
    }
    try {
      await assign.mutateAsync({ policyId, ...parsed.data });
      toast.success(t('staffOps.assistBlock.changed'));
      onClose();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('staffOps.assistBlock.changeTitle')}
      description={t('staffOps.assistBlock.changeText')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button loading={assign.isPending} onClick={() => void submit()}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t('staffOps.rebills.col.assistance')} error={tm(errors.assistanceId) || undefined}>
          {(a) => (
            <Select {...a} value={assistanceId} onChange={(e) => setAssistanceId(e.target.value)}>
              <option value="">{t('staffOps.assistBlock.none')}</option>
              {(list.data ?? []).map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t('common.from')} error={tm(errors.from) || undefined}>
          {(a) => <Input {...a} type="date" min={todayISO()} value={from} onChange={(e) => setFrom(e.target.value)} />}
        </Field>
      </div>
    </Modal>
  );
}

export function AssistanceBlock({ policyId }: { policyId: string }) {
  const q = useAssignments(policyId);
  const canAssign = useCan('assistance.assign');
  const [open, setOpen] = useState(false);
  const today = todayISO();
  const current = q.data?.find((a) => a.from <= today && (!a.to || a.to >= today));
  return (
    <Card
      title={t('staffOps.rebills.col.assistance')}
      actions={
        canAssign ? (
          <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
            {t('staffOps.assistBlock.changeFrom')}
          </Button>
        ) : undefined
      }
    >
      {q.isLoading ? (
        <SkeletonRows rows={2} />
      ) : (
        <div className="flex flex-col gap-2" data-testid="assistance-block">
          <p>
            {t('staffOps.assistBlock.now')}{' '}
            {current?.assistanceId ? (
              <Link className="font-semibold text-accent-text hover:underline" to={`/staff/assistance/${current.assistanceId}`}>
                {current.assistanceName}
              </Link>
            ) : (
              <span className="font-semibold">{t('staffOps.assistBlock.noneNow')}</span>
            )}
          </p>
          {(q.data?.length ?? 0) > 0 && (
            <ul className="flex flex-col gap-1 text-[13px]" aria-label={t('staffOps.assistBlock.history')}>
              {q.data!.map((a) => (
                <li key={`${a.from}-${a.assistanceId ?? 'mig'}`} className="flex flex-wrap gap-x-2 text-muted">
                  <span className="num">
                    {formatDate(a.from)} — {a.to ? formatDate(a.to) : t('staffOps.assistBlock.present')}
                  </span>
                  <span className="text-text">{a.assistanceName ?? t('common.mig')}</span>
                  <span>{t('staffOps.assistBlock.setBy', { name: a.setByName })}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {open && <ChangeDialog policyId={policyId} current={current?.assistanceId ?? null} onClose={() => setOpen(false)} />}
    </Card>
  );
}
