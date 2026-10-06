/* Dialogs of the portfolio transfer: a new batch, a contract entered manually, a reason. */
import { t } from '@/i18n';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ApiRequestError, errorMessage } from '@/shared/api/client';
import { useCreateMigrationBatch, useManualMigration } from '@/shared/api/queries/migration';
import { PROGRAM_LABEL } from '@/shared/domain/labels';
import { MIGRATION_COLUMNS } from '@/shared/domain/migration';
import { MIGRATION_FREQUENCIES, MIGRATION_PROGRAMS, migrationBatchCreateSchema, migrationContractRowSchema, migrationReasonSchema } from '@/shared/schemas/migration';
import { todayISO } from '@/shared/lib/format';
import { Button } from '@/shared/ui/button';
import { Modal } from '@/shared/ui/dialog';
import { Field, Input, Select, Textarea } from '@/shared/ui/input';
import { toast } from '@/shared/ui/toast';
import { FREQUENCY_LABEL } from './labels';

const fieldErrors = (issues: { path: (string | number)[]; message: string }[]) => {
  const out: Record<string, string> = {};
  for (const i of issues) {
    const k = String(i.path[0] ?? '_');
    if (!out[k]) out[k] = i.message;
  }
  return out;
};

export function NewBatchDialog({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const create = useCreateMigrationBatch();
  const [date, setDate] = useState(todayISO());
  const [error, setError] = useState<string>();
  const submit = async () => {
    const parsed = migrationBatchCreateSchema.safeParse({ migrationDate: date });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message);
      return;
    }
    try {
      const b = await create.mutateAsync(parsed.data.migrationDate);
      toast.success(t('migration.created'));
      navigate(`/staff/admin/migration/${b.id}`);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('migration.newBatch')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button loading={create.isPending} onClick={() => void submit()}>
            {t('migration.create')}
          </Button>
        </>
      }
    >
      <Field label={t('migration.migrationDate')} error={error} hint={t('migration.migrationDateHint')}>
        {(a) => <Input {...a} type="date" max={todayISO()} value={date} onChange={(e) => setDate(e.target.value)} />}
      </Field>
    </Modal>
  );
}

const EMPTY_ROW: Record<string, string> = Object.fromEntries(MIGRATION_COLUMNS.contracts.map((c) => [c, '']));

/** One contract with the fields and checks of a contracts CSV row; becomes a one-row batch. */
export function ManualContractDialog({ assistances, onClose }: { assistances: string[]; onClose: () => void }) {
  const navigate = useNavigate();
  const manual = useManualMigration();
  const [date, setDate] = useState(todayISO());
  const [row, setRow] = useState<Record<string, string>>({ ...EMPTY_ROW, program: 'standard', paymentFrequency: 'single' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = (k: string) => (v: string) => setRow((r) => ({ ...r, [k]: v }));
  const submit = async () => {
    const d = migrationBatchCreateSchema.safeParse({ migrationDate: date });
    const r = migrationContractRowSchema.safeParse(row);
    const errs = { ...(d.success ? {} : { migrationDate: d.error.issues[0]?.message ?? '' }), ...(r.success ? {} : fieldErrors(r.error.issues)) };
    setErrors(errs);
    if (Object.keys(errs).length) return;
    try {
      const b = await manual.mutateAsync({ migrationDate: date, row });
      toast.success(t('migration.manualSent'));
      navigate(`/staff/admin/migration/${b.id}`);
    } catch (e) {
      if (e instanceof ApiRequestError && e.fields) setErrors(e.fields);
      toast.error(errorMessage(e));
    }
  };
  const text = (k: string, label: string, props: { inputMode?: 'numeric'; maxLength: number; type?: string }) => (
    <Field label={label} error={errors[k]}>
      {(a) => <Input {...a} {...props} value={row[k] ?? ''} onChange={(e) => set(k)(e.target.value)} />}
    </Field>
  );
  return (
    <Modal
      open
      wide
      onOpenChange={(o) => !o && onClose()}
      title={t('migration.manualTitle')}
      description={t('migration.manualDesc')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button loading={manual.isPending} onClick={() => void submit()}>
            {t('migration.submit')}
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t('migration.migrationDate')} error={errors.migrationDate} hint={t('migration.migrationDateHint')} className="sm:col-span-2">
          {(a) => <Input {...a} type="date" max={todayISO()} value={date} onChange={(e) => setDate(e.target.value)} />}
        </Field>
        {text('oldNumber', t('migration.field.oldNumber'), { maxLength: 40 })}
        {text('clientStir', t('migration.field.clientStir'), { inputMode: 'numeric', maxLength: 12 })}
        {text('startDate', t('migration.field.startDate'), { type: 'date', maxLength: 10 })}
        {text('endDate', t('migration.field.endDate'), { type: 'date', maxLength: 10 })}
        <Field label={t('migration.field.program')} error={errors.program}>
          {(a) => (
            <Select {...a} value={row.program} onChange={(e) => set('program')(e.target.value)}>
              {MIGRATION_PROGRAMS.map((p) => (
                <option key={p} value={p}>
                  {PROGRAM_LABEL[p]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        {text('premium', t('migration.field.premium'), { inputMode: 'numeric', maxLength: 16 })}
        {text('premiumEmployee', t('migration.field.premiumEmployee'), { inputMode: 'numeric', maxLength: 16 })}
        {text('premiumFamily', t('migration.field.premiumFamily'), { inputMode: 'numeric', maxLength: 16 })}
        <Field label={t('migration.field.paymentFrequency')} error={errors.paymentFrequency}>
          {(a) => (
            <Select {...a} value={row.paymentFrequency} onChange={(e) => set('paymentFrequency')(e.target.value)}>
              {MIGRATION_FREQUENCIES.map((f) => (
                <option key={f} value={f}>
                  {FREQUENCY_LABEL[f]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t('migration.field.assistance')} error={errors.assistance}>
          {(a) => (
            <Select {...a} value={row.assistance} onChange={(e) => set('assistance')(e.target.value)}>
              <option value="">{t('migration.noAssistance')}</option>
              {assistances.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>
    </Modal>
  );
}

/** Asks for a reason (reject, withdraw, rollback). */
export function ReasonDialog({ title, description, confirmLabel, danger, loading, onConfirm, onClose }: { title: string; description?: string; confirmLabel: string; danger?: boolean; loading?: boolean; onConfirm: (reason: string) => void; onClose: () => void }) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string>();
  const submit = () => {
    const parsed = migrationReasonSchema.safeParse({ reason });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message);
      return;
    }
    onConfirm(parsed.data.reason);
  };
  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title={title}
      description={description}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} loading={loading} onClick={submit}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <Field label={t('migration.reason')} error={error}>
        {(a) => <Textarea {...a} rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />}
      </Field>
    </Modal>
  );
}
