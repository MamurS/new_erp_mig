import { useNavigate } from 'react-router-dom';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Info } from 'lucide-react';
import type { HrEmployeeInput, HrEmployeePayload } from '@/shared/schemas/forms';
import { hrEmployeeSchema as addEmployeeFormSchema } from '@/shared/schemas/forms';
import { useAddEmployee } from '@/shared/api/queries/hr';
import { ApiRequestError, errorMessage } from '@/shared/api/client';
import { useDocumentTitle } from '@/shared/lib/hooks';
import { Button } from '@/shared/ui/button';
import { Field, Input } from '@/shared/ui/input';
import { MaskedInput } from '@/shared/ui/masked-input';
import { Breadcrumbs } from '@/shared/ui/page';
import { toast } from '@/shared/ui/toast';
import { HR_BTN, HrCard, HrHeader } from '../ui';
import { useGoBack } from '../useGoBack';
import { t, tm } from '@/i18n';

const FIELDS: (keyof HrEmployeeInput)[] = ['fullName', 'birthDate', 'pinfl', 'phone', 'position', 'startDate'];
const DEFAULTS: HrEmployeeInput = { fullName: '', birthDate: '', pinfl: '', phone: '', position: '', startDate: '' };

export default function AddEmployeePage() {
  useDocumentTitle(t('hr.add.docTitle'));
  const navigate = useNavigate();
  const goBack = useGoBack('/hr');
  const add = useAddEmployee();
  const form = useForm<HrEmployeeInput, unknown, HrEmployeePayload>({
    resolver: zodResolver(addEmployeeFormSchema),
    mode: 'onTouched',
    defaultValues: DEFAULTS,
    shouldFocusError: true,
  });
  const {
    register,
    control,
    handleSubmit,
    setError,
    formState: { errors },
  } = form;

  const onSubmit = handleSubmit(async (values) => {
    try {
      await add.mutateAsync(values);
      toast.success(t('hr.add.sent'));
      navigate('/hr');
    } catch (e) {
      const fields = e instanceof ApiRequestError ? e.fields : undefined;
      const known = fields ? FIELDS.filter((f) => fields[f]) : [];
      if (fields && known.length) {
        known.forEach((f, i) => setError(f, { type: 'server', message: fields[f] }, { shouldFocus: i === 0 }));
        if (e instanceof ApiRequestError) setError('root', { type: 'server', message: e.message });
      } else {
        setError('root', { type: 'server', message: errorMessage(e) });
      }
    }
  });

  return (
    <div className="mx-auto max-w-[720px]">
      <Breadcrumbs items={[{ label: t('hr.nav.employees'), to: '/hr' }, { label: t('hr.add.docTitle') }]} />
      <HrHeader title={t('hr.add.title')} subtitle={t('hr.add.subtitle')} className="mt-3" />
      <HrCard>
        <form noValidate onSubmit={onSubmit} className="flex flex-col gap-5" aria-label={t('hr.add.docTitle')}>
          <Field label={t('common.fullName')} error={tm(errors.fullName?.message)}>
            {(f) => <Input {...f} {...register('fullName')} autoComplete="off" maxLength={120} className="h-12" placeholder={t('hr.add.namePlaceholder')} />}
          </Field>
          <div className="grid gap-5 sm:grid-cols-2">
            <Controller
              control={control}
              name="birthDate"
              render={({ field, fieldState }) => (
                <Field label={t('hr.csv.column.birthDate')} error={tm(fieldState.error?.message)}>
                  {(f) => <MaskedInput mask="date" {...f} ref={field.ref} name={field.name} value={field.value} onChange={field.onChange} onBlur={field.onBlur} className="h-12" />}
                </Field>
              )}
            />
            <Controller
              control={control}
              name="pinfl"
              render={({ field, fieldState }) => (
                <Field label={t('hr.csv.column.pinfl')} error={tm(fieldState.error?.message)} hint={t('hr.add.pinflHint')}>
                  {(f) => <MaskedInput mask="pinfl" {...f} ref={field.ref} name={field.name} value={field.value} onChange={field.onChange} onBlur={field.onBlur} className="h-12" />}
                </Field>
              )}
            />
          </div>
          <div className="grid gap-5 sm:grid-cols-2">
            <Controller
              control={control}
              name="phone"
              render={({ field, fieldState }) => (
                <Field label={t('common.phone')} error={tm(fieldState.error?.message)}>
                  {(f) => <MaskedInput mask="phone" {...f} ref={field.ref} name={field.name} value={field.value} onChange={field.onChange} onBlur={field.onBlur} className="h-12" />}
                </Field>
              )}
            />
            <Field label={t('common.position')} error={tm(errors.position?.message)}>
              {(f) => <Input {...f} {...register('position')} autoComplete="off" maxLength={80} className="h-12" />}
            </Field>
          </div>
          <Controller
            control={control}
            name="startDate"
            render={({ field, fieldState }) => (
              <Field label={t('hr.add.startDate')} error={tm(fieldState.error?.message)} className="sm:max-w-[calc(50%-10px)]">
                {(f) => <MaskedInput mask="date" {...f} ref={field.ref} name={field.name} value={field.value} onChange={field.onChange} onBlur={field.onBlur} className="h-12" />}
              </Field>
            )}
          />

          <p className="flex items-start gap-2 rounded-btn bg-sky p-3 text-[14px] text-sky-text">
            <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            {t('hr.add.piiNote')}
          </p>

          {errors.root?.message && (
            <p role="alert" className="rounded-btn bg-danger-soft p-3 text-danger-text">
              {tm(errors.root.message)}
            </p>
          )}

          <div className="flex flex-wrap gap-3">
            <Button type="submit" className={HR_BTN} loading={add.isPending}>
              {t('hr.add.title')}
            </Button>
            <Button variant="secondary" className={HR_BTN} onClick={goBack} disabled={add.isPending}>
              {t('common.cancel')}
            </Button>
          </div>
        </form>
      </HrCard>
    </div>
  );
}
