/*
 * «Ассистанс» of a policy with its history (ASSISTANCE_SPEC §3, §7). The underwriter changes the
 * assistance from a date: new requests from that date go to the new company.
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAssign, useAssignments, useAssistances } from '@/shared/api/queries/assist';
import { errorMessage } from '@/shared/api/client';
import { useCan } from '@/shared/auth/guards';
import { assignmentSchema } from '@/shared/schemas/forms';
import { formatDate, todayISO } from '@/shared/lib/format';
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
      toast.success('Ассистанс изменён');
      onClose();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title="Сменить ассистанс"
      description="С этой даты новые обращения пойдут новому ассистансу. Прежний 12 месяцев видит свои дела только на чтение"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Отмена
          </Button>
          <Button loading={assign.isPending} onClick={() => void submit()}>
            Сохранить
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Ассистанс" error={errors.assistanceId}>
          {(a) => (
            <Select {...a} value={assistanceId} onChange={(e) => setAssistanceId(e.target.value)}>
              <option value="">Без ассистанса (обслуживает МИГ)</option>
              {(list.data ?? []).map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="С даты" error={errors.from}>
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
      title="Ассистанс"
      actions={
        canAssign ? (
          <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
            Сменить с даты
          </Button>
        ) : undefined
      }
    >
      {q.isLoading ? (
        <SkeletonRows rows={2} />
      ) : (
        <div className="flex flex-col gap-2" data-testid="assistance-block">
          <p>
            Сейчас:{' '}
            {current?.assistanceId ? (
              <Link className="font-semibold text-accent-text hover:underline" to={`/staff/assistance/${current.assistanceId}`}>
                {current.assistanceName}
              </Link>
            ) : (
              <span className="font-semibold">без ассистанса, обслуживает МИГ</span>
            )}
          </p>
          {(q.data?.length ?? 0) > 0 && (
            <ul className="flex flex-col gap-1 text-[13px]" aria-label="История закреплений">
              {q.data!.map((a) => (
                <li key={`${a.from}-${a.assistanceId ?? 'mig'}`} className="flex flex-wrap gap-x-2 text-muted">
                  <span className="num">
                    {formatDate(a.from)} — {a.to ? formatDate(a.to) : 'сейчас'}
                  </span>
                  <span className="text-text">{a.assistanceName ?? 'МИГ'}</span>
                  <span>· назначил {a.setByName}</span>
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
