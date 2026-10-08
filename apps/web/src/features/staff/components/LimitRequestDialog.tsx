import { t, tm } from '@/i18n';
import { useEffect } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { z } from 'zod';
import type { LimitCategory } from '@mig/contracts';
import { limitRequestSchema } from '@mig/contracts/forms';
import { useCreateLimitRequest } from '@/shared/api/queries/staff';
import { errorMessage } from '@/shared/api/client';
import { LIMIT_CATEGORY_LABEL } from '@mig/domain/labels';
import { formatMoney } from '@mig/domain/lib/format';
import { maskMoney, parseMoney } from '@mig/domain/lib/masks';
import { Button } from '@/shared/ui/button';
import { Modal } from '@/shared/ui/dialog';
import { Field, Select, Textarea } from '@/shared/ui/input';
import { MaskedInput } from '@/shared/ui/masked-input';
import { toast } from '@/shared/ui/toast';

type Values = z.input<typeof limitRequestSchema>;

export function LimitRequestDialog({
  open,
  onOpenChange,
  policyId,
  insuredId,
  currentLimits,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  policyId: string;
  insuredId?: string;
  currentLimits?: Partial<Record<LimitCategory, number>>;
}) {
  const create = useCreateLimitRequest();
  const form = useForm<Values>({
    resolver: zodResolver(limitRequestSchema),
    defaultValues: { policyId, insuredId, category: 'outpatient', to: 0, justification: '' },
    mode: 'onTouched',
  });
  useEffect(() => {
    if (open) form.reset({ policyId, insuredId, category: 'outpatient', to: 0, justification: '' });
  }, [open, policyId, insuredId, form]);
  const category = form.watch('category');
  const current = currentLimits?.[category];

  const onSubmit = form.handleSubmit(async (v) => {
    try {
      await create.mutateAsync(v);
      toast.success(t('staff.limitDialog.sent'));
      onOpenChange(false);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  });

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={t('staff.limitDialog.title')}
      description={t('staff.limitDialog.description')}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button onClick={() => void onSubmit()} loading={create.isPending}>
            {t('staff.limitDialog.title')}
          </Button>
        </>
      }
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-3" noValidate>
        <Field label={t('staff.limitDialog.category')} hint={current !== undefined ? t('staff.limitDialog.currentLimit', { amount: formatMoney(current) }) : undefined}>
          {(a) => (
            <Select {...a} {...form.register('category')}>
              {(Object.keys(LIMIT_CATEGORY_LABEL) as LimitCategory[]).map((c) => (
                <option key={c} value={c}>
                  {LIMIT_CATEGORY_LABEL[c]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t('staff.limitDialog.newLimit')} error={tm(form.formState.errors.to?.message)}>
          {(a) => (
            <Controller
              control={form.control}
              name="to"
              render={({ field }) => (
                <MaskedInput {...a} mask="money" value={field.value ? maskMoney(String(field.value)) : ''} onChange={(v) => field.onChange(parseMoney(v))} onBlur={field.onBlur} />
              )}
            />
          )}
        </Field>
        <Field label={t('staff.limitDialog.justification')} error={tm(form.formState.errors.justification?.message)}>
          {(a) => <Textarea {...a} maxLength={1000} {...form.register('justification')} />}
        </Field>
      </form>
    </Modal>
  );
}
