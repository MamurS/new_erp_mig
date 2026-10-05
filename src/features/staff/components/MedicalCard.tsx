import { useEffect, useState } from 'react';
import { Lock, Stethoscope } from 'lucide-react';
import { useMedicalAccess, useMedicalRecords } from '@/shared/api/queries/staff';
import { errorMessage } from '@/shared/api/client';
import { useCan } from '@/shared/auth/guards';
import type { Action } from '@/shared/auth/permissions';
import { SPECIALTY_LABEL } from '@/shared/domain/labels';
import { formatCountdown, formatDate } from '@/shared/lib/format';
import { useCountdown } from '@/shared/lib/hooks';
import { Button } from '@/shared/ui/button';
import { Modal } from '@/shared/ui/dialog';
import { Field, Textarea } from '@/shared/ui/input';
import { Card } from '@/shared/ui/page';
import { EmptyState, ErrorState, SkeletonRows } from '@/shared/ui/states';
import { toast } from '@/shared/ui/toast';

/**
 * Medical record block. Closed for roles without `medical.read`. The doctor states a reason and gets a
 * 15-minute grant kept only in this component's memory; the block closes itself when it expires.
 */
export function MedicalCard({ insuredId, apiBase, action = 'medical.read' }: { insuredId: string; apiBase?: string; action?: Action }) {
  const allowed = useCan(action);
  const [grant, setGrant] = useState<{ id: string; until: number } | null>(null);
  const [open, setOpen] = useState(false);
  const left = useCountdown(grant?.until ?? null);
  const records = useMedicalRecords(insuredId, grant?.id ?? null, apiBase);

  useEffect(() => {
    if (!grant) return;
    const t = setTimeout(() => {
      setGrant(null);
      toast.info('Доступ к медкарте истёк');
    }, grant.until - Date.now());
    return () => clearTimeout(t);
  }, [grant]);

  if (!allowed) {
    return (
      <Card title="Медицинская карта">
        <div className="flex items-start gap-3 text-muted">
          <Lock className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
          <p>Закрыто для вашей роли. Открыть может врач-эксперт с указанием причины</p>
        </div>
      </Card>
    );
  }

  return (
    <Card
      title="Медицинская карта"
      actions={
        grant ? (
          <span className="flex items-center gap-2">
            <span className="rounded-sm bg-warning-soft px-1.5 text-[12px] text-warning-text num" aria-live="polite" data-testid="medical-timer">
              Доступ ещё {formatCountdown(left)}
            </span>
            <Button size="sm" variant="secondary" onClick={() => setGrant(null)}>
              Закрыть медкарту
            </Button>
          </span>
        ) : null
      }
      bodyClassName={grant ? 'p-0' : undefined}
    >
      {!grant ? (
        <div className="flex flex-col items-start gap-2">
          <p className="text-muted">Доступ выдаётся на 15 минут по причине и записывается в журнал аудита.</p>
          <Button onClick={() => setOpen(true)}>
            <Stethoscope className="h-3.5 w-3.5" aria-hidden /> Открыть медкарту
          </Button>
        </div>
      ) : records.isLoading ? (
        <SkeletonRows rows={4} />
      ) : records.isError ? (
        <ErrorState error={records.error} onRetry={() => void records.refetch()} />
      ) : records.data!.length === 0 ? (
        <EmptyState title="Записей нет" />
      ) : (
        <table className="w-full">
          <caption className="sr-only">Медицинские записи</caption>
          <thead>
            <tr className="border-b border-border text-left text-[12px] text-muted">
              <th className="px-4 py-2 font-normal">Дата</th>
              <th className="px-4 py-2 font-normal">Клиника</th>
              <th className="px-4 py-2 font-normal">Врач</th>
              <th className="px-4 py-2 font-normal">МКБ-10</th>
              <th className="px-4 py-2 font-normal">Заключение</th>
            </tr>
          </thead>
          <tbody>
            {records.data!.map((r) => (
              <tr key={r.id} className="border-b border-border-soft align-top">
                <td className="whitespace-nowrap px-4 py-2">{formatDate(r.date)}</td>
                <td className="px-4 py-2">{r.clinicName}</td>
                <td className="px-4 py-2">{SPECIALTY_LABEL[r.specialty]}</td>
                <td className="px-4 py-2 num">{r.diagnosisCode}</td>
                <td className="px-4 py-2">{r.summary}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <MedicalReasonModal
        open={open}
        onOpenChange={setOpen}
        insuredId={insuredId}
        apiBase={apiBase}
        onGranted={(id, until) => setGrant({ id, until })}
      />
    </Card>
  );
}

function MedicalReasonModal({
  open,
  onOpenChange,
  insuredId,
  onGranted,
  apiBase,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  insuredId: string;
  onGranted: (grantId: string, until: number) => void;
  apiBase?: string;
}) {
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState(false);
  const access = useMedicalAccess(apiBase);
  const error = reason.trim().length < 10 ? 'Опишите причину: минимум 10 символов' : undefined;
  useEffect(() => {
    if (open) {
      setReason('');
      setTouched(false);
    }
  }, [open]);
  const submit = async () => {
    setTouched(true);
    if (error) return;
    try {
      const g = await access.mutateAsync({ insuredId, reason: reason.trim() });
      onGranted(g.grantId, Math.min(Date.parse(g.expiresAt), Date.now() + 15 * 60_000));
      onOpenChange(false);
      toast.success('Медкарта открыта на 15 минут');
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Доступ к медкарте"
      description="Укажите причину. Доступ действует 15 минут и записывается в журнал аудита."
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Отмена
          </Button>
          <Button loading={access.isPending} onClick={() => void submit()}>
            Открыть медкарту
          </Button>
        </>
      }
    >
      <div className="mb-2 flex flex-wrap gap-1.5">
        {['Медэкспертиза по убытку', 'Проверка обоснованности лечения'].map((q) => (
          <button key={q} type="button" onClick={() => setReason(q)} className="rounded-btn border border-border px-2 py-1 text-[12px] hover:bg-rail">
            {q}
          </button>
        ))}
      </div>
      <Field label="Причина" error={touched ? error : undefined}>
        {(a) => <Textarea {...a} value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} onBlur={() => setTouched(true)} />}
      </Field>
    </Modal>
  );
}
