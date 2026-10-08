import { t } from '@/i18n';
import { useEffect, useState } from 'react';
import { Lock, Stethoscope } from 'lucide-react';
import { useMedicalAccess, useMedicalRecords } from '@/shared/api/queries/staff';
import { errorMessage } from '@/shared/api/client';
import { useCan } from '@/shared/auth/guards';
import type { Action } from '@mig/domain/auth/permissions';
import { SPECIALTY_LABEL } from '@mig/domain/labels';
import { formatCountdown, formatDate } from '@mig/domain/lib/format';
import { useCountdown } from '@/shared/lib/hooks';
import { Button } from '@/shared/ui/button';
import { Modal } from '@/shared/ui/dialog';
import { Field, Textarea } from '@/shared/ui/input';
import { Card } from '@/shared/ui/page';
import { EmptyState, ErrorState, SkeletonRows } from '@/shared/ui/states';
import { toast } from '@/shared/ui/toast';
import { TableScroll } from '@/shared/ui/table-scroll';

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
    const timer = setTimeout(() => {
      setGrant(null);
      toast.info(t('staff.medical.expired'));
    }, grant.until - Date.now());
    return () => clearTimeout(timer);
  }, [grant]);

  if (!allowed) {
    return (
      <Card title={t('staff.medical.title')}>
        <div className="flex items-start gap-3 text-muted">
          <Lock className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
          <p>{t('staff.medical.closedForRole')}</p>
        </div>
      </Card>
    );
  }

  return (
    <Card
      title={t('staff.medical.title')}
      actions={
        grant ? (
          <span className="flex items-center gap-2">
            <span className="rounded-sm bg-warning-soft px-1.5 text-[12px] text-warning-text num" aria-live="polite" data-testid="medical-timer">
              {t('staff.medical.timeLeft', { time: formatCountdown(left) })}
            </span>
            <Button size="sm" variant="secondary" onClick={() => setGrant(null)}>
              {t('staff.medical.close')}
            </Button>
          </span>
        ) : null
      }
      bodyClassName={grant ? 'p-0' : undefined}
    >
      {!grant ? (
        <div className="flex flex-col items-start gap-2">
          <p className="text-muted">{t('staff.medical.hint')}</p>
          <Button onClick={() => setOpen(true)}>
            <Stethoscope className="h-3.5 w-3.5" aria-hidden /> {t('staff.medical.open')}
          </Button>
        </div>
      ) : records.isLoading ? (
        <SkeletonRows rows={4} />
      ) : records.isError ? (
        <ErrorState error={records.error} onRetry={() => void records.refetch()} />
      ) : records.data!.length === 0 ? (
        <EmptyState title={t('staff.medical.empty')} />
      ) : (
        <TableScroll>
        <table className="w-full">
          <caption className="sr-only">{t('staff.medical.caption')}</caption>
          <thead>
            <tr className="text-left text-[12px] text-muted">
              <th className="px-4 py-2 font-normal">{t('common.date')}</th>
              <th className="px-4 py-2 font-normal">{t('common.clinic')}</th>
              <th className="px-4 py-2 font-normal">{t('staff.medical.colDoctor')}</th>
              <th className="px-4 py-2 font-normal">{t('staff.medical.colIcd')}</th>
              <th className="px-4 py-2 font-normal">{t('staff.medical.colSummary')}</th>
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
        </TableScroll>
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
  const error = reason.trim().length < 10 ? t('staff.medical.reasonMin') : undefined;
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
      toast.success(t('staff.medical.opened'));
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={t('staff.medical.accessTitle')}
      description={t('staff.medical.accessText')}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button loading={access.isPending} onClick={() => void submit()}>
            {t('staff.medical.open')}
          </Button>
        </>
      }
    >
      <div className="mb-2 flex flex-wrap gap-1.5">
        {[t('staff.medical.quickClaim'), t('staff.medical.quickTreatment')].map((q) => (
          <button key={q} type="button" onClick={() => setReason(q)} className="rounded-btn border border-border px-2 py-1 text-[12px] hover:bg-rail">
            {q}
          </button>
        ))}
      </div>
      <Field label={t('staff.medical.reason')} error={touched ? error : undefined}>
        {(a) => <Textarea {...a} value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} onBlur={() => setTouched(true)} />}
      </Field>
    </Modal>
  );
}
