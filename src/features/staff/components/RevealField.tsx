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
const FIELD_LABEL: Record<PiiField, string> = { pinfl: 'ПИНФЛ', phone: 'Телефон', birthDate: 'Дата рождения', email: 'Email' };

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
    const t = setTimeout(() => {
      setValue(null);
      setUntil(null);
    }, until - Date.now());
    return () => clearTimeout(t);
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
            <span className="rounded bg-warning-soft px-1.5 text-[11px] text-warning-text num" aria-live="polite" aria-label={`Скроется через ${left} секунд`}>
              {formatCountdown(left)}
            </span>
            <Button
              size="icon"
              variant="ghost"
              aria-label={`Копировать ${label}`}
              onClick={async () => {
                try {
                  await navigator.clipboard?.writeText(value);
                } catch {
                  /* clipboard may be unavailable */
                }
                copied.mutate({ insuredId, field });
                toast.success('Скопировано. Копирование записано в журнал');
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
              <Button size="sm" variant="secondary" onClick={() => setOpen(true)} aria-label={`Показать ${label}`}>
                <Eye className="h-3.5 w-3.5" aria-hidden /> Показать
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
  const error = trimmed.length < 10 ? 'Опишите причину: минимум 10 символов' : undefined;
  const quick = [claimNumber ? `Обработка убытка №${claimNumber}` : 'Обработка убытка №', 'Звонок застрахованного', 'Запрос клиники'];

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
      toast.success('Данные показаны на 30 секунд');
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={`Показать: ${FIELD_LABEL[field]}`}
      description="Значение будет видно 30 секунд. Просмотр и причина попадут в журнал аудита."
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Отмена
          </Button>
          <Button onClick={() => void submit()} loading={reveal.isPending}>
            Показать
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
        <Field label="Причина просмотра" error={touched ? error : undefined} hint="Минимум 10 символов">
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
