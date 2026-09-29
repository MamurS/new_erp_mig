import { useEffect } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { z } from 'zod';
import type { ProgramCode } from '@/shared/types';
import { renewalOfferSchema } from '@/shared/schemas/forms';
import { useRenewalOffer } from '@/shared/api/queries/staff';
import { errorMessage } from '@/shared/api/client';
import { PROGRAM_LABEL } from '@/shared/domain/labels';
import { maskMoney, parseMoney } from '@/shared/lib/masks';
import { Button } from '@/shared/ui/button';
import { Modal } from '@/shared/ui/dialog';
import { Field, Select } from '@/shared/ui/input';
import { MaskedInput } from '@/shared/ui/masked-input';
import { toast } from '@/shared/ui/toast';

type Values = z.input<typeof renewalOfferSchema>;

export function RenewalOfferDialog({
  open,
  onOpenChange,
  policyId,
  program,
  premium,
  clientName,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  policyId: string;
  program?: ProgramCode;
  premium?: number;
  clientName?: string;
}) {
  const offer = useRenewalOffer();
  const form = useForm<Values>({
    resolver: zodResolver(renewalOfferSchema),
    defaultValues: { program: program ?? 'standard', premium: Math.round((premium ?? 0) * 1.08), termMonths: 12 },
    mode: 'onTouched',
  });
  useEffect(() => {
    if (open) form.reset({ program: program ?? 'standard', premium: Math.round(((premium ?? 0) * 1.08) / 1000) * 1000, termMonths: 12 });
  }, [open, program, premium, form]);

  const onSubmit = form.handleSubmit(async (v) => {
    try {
      await offer.mutateAsync({ policyId, ...v });
      toast.success('КП подготовлено и добавлено в документы клиента');
      onOpenChange(false);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  });

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Подготовить КП на продление"
      description={clientName ? `Клиент: ${clientName}. Документ КП появится в списке документов клиента.` : 'Документ КП появится в документах клиента.'}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Отмена
          </Button>
          <Button onClick={() => void onSubmit()} loading={offer.isPending}>
            Подготовить КП
          </Button>
        </>
      }
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-3" noValidate>
        <Field label="Новая программа" error={form.formState.errors.program?.message}>
          {(a) => (
            <Select {...a} {...form.register('program')}>
              {(Object.keys(PROGRAM_LABEL) as ProgramCode[]).map((p) => (
                <option key={p} value={p}>
                  {PROGRAM_LABEL[p]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Премия, UZS" error={form.formState.errors.premium?.message}>
          {(a) => (
            <Controller
              control={form.control}
              name="premium"
              render={({ field }) => (
                <MaskedInput {...a} mask="money" value={maskMoney(String(field.value ?? ''))} onChange={(v) => field.onChange(parseMoney(v))} onBlur={field.onBlur} />
              )}
            />
          )}
        </Field>
        <Field label="Срок" error={form.formState.errors.termMonths?.message}>
          {(a) => (
            <Select {...a} {...form.register('termMonths', { valueAsNumber: true })}>
              <option value={6}>6 месяцев</option>
              <option value={12}>12 месяцев</option>
              <option value={24}>24 месяца</option>
            </Select>
          )}
        </Field>
      </form>
    </Modal>
  );
}
