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

const FIELDS: (keyof HrEmployeeInput)[] = ['fullName', 'birthDate', 'pinfl', 'phone', 'position', 'startDate'];
const DEFAULTS: HrEmployeeInput = { fullName: '', birthDate: '', pinfl: '', phone: '', position: '', startDate: '' };

export default function AddEmployeePage() {
  useDocumentTitle('Новый сотрудник');
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
      toast.success('Заявка отправлена в МИГ — сотрудник появится в полисе после подтверждения');
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
      <Breadcrumbs items={[{ label: 'Сотрудники', to: '/hr' }, { label: 'Новый сотрудник' }]} />
      <HrHeader title="Добавить сотрудника" subtitle="После сохранения сотрудник получит приглашение в приложение по SMS" className="mt-3" />
      <HrCard>
        <form noValidate onSubmit={onSubmit} className="flex flex-col gap-5" aria-label="Новый сотрудник">
          <Field label="ФИО" error={errors.fullName?.message}>
            {(f) => <Input {...f} {...register('fullName')} autoComplete="off" maxLength={120} className="h-12" placeholder="Фамилия Имя Отчество" />}
          </Field>
          <div className="grid gap-5 sm:grid-cols-2">
            <Controller
              control={control}
              name="birthDate"
              render={({ field, fieldState }) => (
                <Field label="Дата рождения" error={fieldState.error?.message}>
                  {(f) => <MaskedInput mask="date" {...f} ref={field.ref} name={field.name} value={field.value} onChange={field.onChange} onBlur={field.onBlur} className="h-12" />}
                </Field>
              )}
            />
            <Controller
              control={control}
              name="pinfl"
              render={({ field, fieldState }) => (
                <Field label="ПИНФЛ" error={fieldState.error?.message} hint="14 цифр, есть в паспорте или ID-карте">
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
                <Field label="Телефон" error={fieldState.error?.message}>
                  {(f) => <MaskedInput mask="phone" {...f} ref={field.ref} name={field.name} value={field.value} onChange={field.onChange} onBlur={field.onBlur} className="h-12" />}
                </Field>
              )}
            />
            <Field label="Должность" error={errors.position?.message}>
              {(f) => <Input {...f} {...register('position')} autoComplete="off" maxLength={80} className="h-12" />}
            </Field>
          </div>
          <Controller
            control={control}
            name="startDate"
            render={({ field, fieldState }) => (
              <Field label="Дата начала страхования" error={fieldState.error?.message} className="sm:max-w-[calc(50%-10px)]">
                {(f) => <MaskedInput mask="date" {...f} ref={field.ref} name={field.name} value={field.value} onChange={field.onChange} onBlur={field.onBlur} className="h-12" />}
              </Field>
            )}
          />

          <p className="flex items-start gap-2 rounded-btn bg-sky p-3 text-[14px] text-sky-text">
            <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            ПИНФЛ, телефон и дата рождения нужны страховой компании. В кабинете HR они не показываются.
          </p>

          {errors.root?.message && (
            <p role="alert" className="rounded-btn bg-danger-soft p-3 text-danger-text">
              {errors.root.message}
            </p>
          )}

          <div className="flex flex-wrap gap-3">
            <Button type="submit" className={HR_BTN} loading={add.isPending}>
              Добавить сотрудника
            </Button>
            <Button variant="secondary" className={HR_BTN} onClick={goBack} disabled={add.isPending}>
              Отмена
            </Button>
          </div>
        </form>
      </HrCard>
    </div>
  );
}
