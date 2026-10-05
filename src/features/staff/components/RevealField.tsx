import { defineLabels, t } from '@/i18n';
import { useEffect, useState } from 'react';
import { Copy, Eye } from 'lucide-react';
import type { PiiField } from '@/shared/types';
import { useReveal, useRevealCopied } from '@/shared/api/queries/staff';
import { errorMessage } from '@/shared/api/client';
import { formatCountdown } from '@/shared/lib/format';
import { useCountdown } from '@/shared/lib/hooks';
import { Button } from '@/shared/ui/button';
import { Modal } from '@/shared/ui/dialog';
import { Field, Textarea } from '@/shared/ui/input';
import { toast } from '@/shared/ui/toast';

export const REVEAL_SECONDS = 30;
const FIELD_LABEL: Readonly<Record<PiiField, string>> = defineLabels('staff.reveal.field', ['pinfl', 'phone', 'birthDate', 'email']);

export interface RevealFieldProps {
  insuredId: string;
  field: PiiField;
  masked: string;
  canReveal: boolean;
  /** e.g. an open claim number for the quick reason «Обработка убытка №…». */
  claimNumber?: string;
  /** API prefix of the insured resource: MIG staff or the assistance portal. */
  apiBase?: string;
}

/**
 * Masked PII value with «Показать». The full value comes only from the reveal mutation (never the query
 * cache), lives in component state for 30 seconds, then is dropped.
 */
export function RevealField({ insuredId, field, masked, canReveal, claimNumber, apiBase }: RevealFieldProps) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState<string | null>(null);
  const [until, setUntil] = useState<number | null>(null);
  const left = useCountdown(until);
  const copied = useRevealCopied(apiBase);

  useEffect(() => {
    if (until === null) return;
    const timer = setTimeout(() => {
      setValue(null);
      setUntil(null);
    }, until - Date.now());
    return () => clearTimeout(timer);
  }, [until]);

  const label = FIELD_LABEL[field];
  return (
    <div className="flex items-center justify-between gap-2 py-1.5">
      <dt className="text-muted">{label}</dt>
      <dd className="flex items-center gap-2">
        {value ? (
          <>
            <span className="font-semibold num" data-testid={`revealed-${field}`}>
              {value}
            </span>
            <span className="rounded-sm bg-warning-soft px-1.5 text-[11px] text-warning-text num" aria-live="polite" aria-label={t('staff.reveal.hidesIn', { n: left })}>
              {formatCountdown(left)}
            </span>
            <Button
              size="icon"
              variant="ghost"
              aria-label={t('staff.reveal.copyAria', { label })}
              onClick={async () => {
                try {
                  await navigator.clipboard?.writeText(value);
                } catch {
                  /* clipboard may be unavailable */
                }
                copied.mutate({ insuredId, field });
                toast.success(t('staff.reveal.copied'));
              }}
            >
              <Copy className="h-3.5 w-3.5" />
            </Button>
          </>
        ) : (
          <>
            <span className="num" data-testid={`masked-${field}`}>
              {masked}
            </span>
            {canReveal && (
              <Button size="sm" variant="secondary" onClick={() => setOpen(true)} aria-label={t('staff.reveal.showAria', { label })}>
                <Eye className="h-3.5 w-3.5" aria-hidden /> {t('staff.reveal.show')}
              </Button>
            )}
          </>
        )}
      </dd>
      <RevealModal
        open={open}
        onOpenChange={setOpen}
        insuredId={insuredId}
        field={field}
        claimNumber={claimNumber}
        apiBase={apiBase}
        onRevealed={(v, sec) => {
          setValue(v);
          setUntil(Date.now() + sec * 1000);
        }}
      />
    </div>
  );
}

export function RevealModal({
  open,
  onOpenChange,
  insuredId,
  field,
  claimNumber,
  onRevealed,
  apiBase,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  insuredId: string;
  field: PiiField;
  claimNumber?: string;
  onRevealed: (value: string, seconds: number) => void;
  apiBase?: string;
}) {
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState(false);
  const reveal = useReveal(apiBase);
  const trimmed = reason.trim();
  const error = trimmed.length < 10 ? t('staff.medical.reasonMin') : undefined;
  const quick = [
    claimNumber ? t('staff.reveal.quickClaim', { number: claimNumber }) : t('staff.reveal.quickClaimEmpty'),
    t('staff.reveal.quickCall'),
    t('staff.reveal.quickClinic'),
  ];

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
      const res = await reveal.mutateAsync({ insuredId, field, reason: trimmed });
      onRevealed(res.value, Math.min(res.expiresInSec, REVEAL_SECONDS));
      onOpenChange(false);
      toast.success(t('staff.reveal.shown'));
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={t('staff.reveal.title', { label: FIELD_LABEL[field] })}
      description={t('staff.reveal.description')}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button onClick={() => void submit()} loading={reveal.isPending}>
            {t('staff.reveal.show')}
          </Button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div className="mb-2 flex flex-wrap gap-1.5">
          {quick.map((q) => (
            <button
              key={q}
              type="button"
              onClick={() => setReason(q)}
              className="rounded-btn border border-border px-2 py-1 text-[12px] hover:bg-rail"
            >
              {q}
            </button>
          ))}
        </div>
        <Field label={t('staff.reveal.reasonLabel')} error={touched ? error : undefined} hint={t('staff.reveal.reasonHint')}>
          {(a) => (
            <Textarea
              {...a}
              value={reason}
              maxLength={300}
              onChange={(e) => setReason(e.target.value)}
              onBlur={() => setTouched(true)}
              autoFocus
            />
          )}
        </Field>
      </form>
    </Modal>
  );
}
