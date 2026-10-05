/* Small pieces shared by the lifecycle screens: a reason dialog and a stage stepper. */
import { t, tm } from '@/i18n';
import { useState } from 'react';
import { Check, FileUp } from 'lucide-react';
import type { ZodType, ZodTypeDef } from 'zod';
import { errorMessage } from '@/shared/api/client';
import { cn } from '@/shared/lib/cn';
import { Field, Textarea } from '@/shared/ui/input';
import { ConfirmDialog } from '@/shared/ui/confirm-dialog';
import { toast } from '@/shared/ui/toast';

/** A confirm dialog with one text field validated by a form schema (`{ reason }`, `{ comment }` …). */
export function ReasonDialog<K extends string>({
  open,
  onClose,
  title,
  description,
  label,
  field,
  schema,
  confirmLabel,
  danger,
  optional,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description: string;
  label: string;
  field: K;
  schema: ZodType<Partial<Record<K, string>>, ZodTypeDef, unknown>;
  confirmLabel: string;
  danger?: boolean;
  optional?: boolean;
  onSubmit: (value: string) => Promise<unknown>;
}) {
  const [text, setText] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const confirm = async () => {
    const parsed = schema.safeParse({ [field]: optional && !text.trim() ? undefined : text });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message);
      return;
    }
    setBusy(true);
    try {
      await onSubmit(parsed.data[field] ?? '');
      setText('');
      setError(undefined);
      onClose();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <ConfirmDialog open={open} onOpenChange={(o) => !o && onClose()} title={title} description={description} confirmLabel={confirmLabel} danger={danger} loading={busy} onConfirm={() => void confirm()}>
      <Field label={label} error={error && tm(error)}>
        {(a) => <Textarea {...a} rows={3} maxLength={500} value={text} onChange={(e) => setText(e.target.value)} />}
      </Field>
    </ConfirmDialog>
  );
}

/** Steps of a process: passed ones are checked, the current one is highlighted. */
export function Stepper<S extends string>({ steps, current, labels, failed }: { steps: readonly S[]; current: S; labels: Record<S, string>; failed?: boolean }) {
  const idx = steps.indexOf(current);
  return (
    <ol className="flex flex-wrap gap-x-1 gap-y-2" aria-label={t('staffLc.common.steps')}>
      {steps.map((s, i) => {
        const done = idx >= 0 && i < idx;
        const now = i === idx;
        return (
          <li key={s} className="flex items-center gap-1" aria-current={now ? 'step' : undefined}>
            <span
              className={cn(
                'flex items-center gap-1 rounded-btn border px-2 py-1 text-[12px]',
                done && 'border-success/40 bg-success-soft text-success-text',
                now && !failed && 'border-accent bg-accent-soft font-semibold text-accent-text',
                now && failed && 'border-danger/40 bg-danger-soft font-semibold text-danger-text',
                !done && !now && 'border-border text-muted',
              )}
            >
              {done && <Check className="h-3 w-3" aria-hidden />}
              {labels[s]}
            </span>
            {i < steps.length - 1 && <span className="h-px w-2 bg-border" aria-hidden />}
          </li>
        );
      })}
    </ol>
  );
}

/** «Загрузить CSV»: reads a small text file (size checked before reading) and passes its text on. */
export function CsvFileButton({ label, ariaLabel, busy, maxBytes, onText }: { label: string; ariaLabel: string; busy?: boolean; maxBytes: number; onText: (text: string) => void }) {
  return (
    <label className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-btn border border-border bg-surface px-3 text-[13px] font-medium hover:bg-rail">
      <FileUp className="h-3.5 w-3.5" aria-hidden /> {busy ? t('staffLc.common.uploading') : label}
      <input
        type="file"
        accept=".csv,text/csv"
        className="sr-only"
        aria-label={ariaLabel}
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (!f) return;
          if (f.size > maxBytes) {
            toast.error(t('staffLc.common.fileTooBig', { mb: Math.round(maxBytes / 1024 / 1024) }));
            return;
          }
          void f.text().then(onText);
        }}
      />
    </label>
  );
}
