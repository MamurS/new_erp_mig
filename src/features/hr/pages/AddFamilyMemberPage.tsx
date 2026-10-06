/*
 * «Добавить члена семьи» (FAMILY_SPEC): like adding an employee — Latin full name, date of birth, PINFL,
 * relation and the employee. The result is a change request for MIG (an endorsement with the premium for the
 * rest of the term by the person's age group), listed among the requests and on «Семья».
 */
import { useId, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Info } from 'lucide-react';
import type { HrFamilyMemberInput, HrFamilyMemberPayload } from '@/shared/schemas/forms';
import { hrFamilyMemberSchema } from '@/shared/schemas/forms';
import { useAddFamilyMember } from '@/shared/api/queries/hr';
import { ApiRequestError, errorMessage } from '@/shared/api/client';
import { FAMILY_RELATIONS, RELATION_LABEL } from '@/shared/domain/family';
import { addDaysISO, formatDate, todayISO } from '@/shared/lib/format';
import { useDocumentTitle } from '@/shared/lib/hooks';
import { Button } from '@/shared/ui/button';
import { Checkbox } from '@/shared/ui/checkbox';
import { Field, Input, Select } from '@/shared/ui/input';
import { MaskedInput } from '@/shared/ui/masked-input';
import { Breadcrumbs } from '@/shared/ui/page';
import { toast } from '@/shared/ui/toast';
import { HR_BTN, HrCard, HrHeader } from '../ui';
import { useGoBack } from '../useGoBack';
import { EmployeePicker, type PickedEmployee } from '../family/EmployeePicker';
import { t, tm } from '@/i18n';

const FIELDS: (keyof HrFamilyMemberInput)[] = ['employeeId', 'fullName', 'birthDate', 'pinfl', 'relation', 'phone', 'startDate'];

/** The employee chosen in the family dialog of «Сотрудники» comes in the navigation state (never in the URL by name). */
function presetEmployee(state: unknown, id: string | null): PickedEmployee | null {
  const name = (state as { employeeName?: unknown } | null)?.employeeName;
  return id && typeof name === 'string' ? { id, fullName: name } : null;
}

export default function AddFamilyMemberPage() {
  useDocumentTitle(t('hr.familyAdd.title'));
  const navigate = useNavigate();
  const location = useLocation();
  const goBack = useGoBack('/hr/family');
  const add = useAddFamilyMember();
  const [employee, setEmployee] = useState<PickedEmployee | null>(() => presetEmployee(location.state, new URLSearchParams(location.search).get('employeeId')));
  const employeeInputId = useId();
  const form = useForm<HrFamilyMemberInput, unknown, HrFamilyMemberPayload>({
    resolver: zodResolver(hrFamilyMemberSchema),
    mode: 'onTouched',
    defaultValues: { employeeId: employee?.id ?? '', fullName: '', birthDate: '', pinfl: '', phone: '', isStudent: false, startDate: formatDate(addDaysISO(todayISO(), 1)) },
    shouldFocusError: true,
  });
  const {
    register,
    control,
    handleSubmit,
    setError,
    setValue,
    formState: { errors },
  } = form;
  const relation = useWatch({ control, name: 'relation' });

  const pick = (e: PickedEmployee | null) => {
    setEmployee(e);
    setValue('employeeId', e?.id ?? '', { shouldValidate: !!e });
  };

  const onSubmit = handleSubmit(async (values) => {
    try {
      await add.mutateAsync({ ...values, isStudent: values.relation === 'child' ? values.isStudent : undefined, phone: values.relation === 'child' ? undefined : values.phone });
      toast.success(t('hr.familyAdd.sent'));
      navigate('/hr/family');
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
      <Breadcrumbs items={[{ label: t('hr.nav.family'), to: '/hr/family' }, { label: t('hr.familyAdd.title') }]} />
      <HrHeader title={t('hr.familyAdd.title')} subtitle={t('hr.familyAdd.subtitle')} className="mt-3" />
      <HrCard>
        <form noValidate onSubmit={onSubmit} className="flex flex-col gap-5" aria-label={t('hr.familyAdd.title')}>
          <div className="flex flex-col gap-1">
            <label htmlFor={employeeInputId} className="text-[12px] font-medium text-muted">
              {t('common.employee')}
            </label>
            <EmployeePicker value={employee} onChange={pick} inputId={employeeInputId} invalid={!!errors.employeeId} describedBy={errors.employeeId ? `${employeeInputId}-err` : undefined} />
            {errors.employeeId && (
              <p id={`${employeeInputId}-err`} role="alert" className="text-[12px] text-danger-text">
                {t('hr.familyAdd.employeeRequired')}
              </p>
            )}
          </div>
          <Field label={t('hr.familyAdd.relation')} error={tm(errors.relation?.message)}>
            {(f) => (
              <Select {...f} {...register('relation')} defaultValue="" className="h-12 sm:max-w-[calc(50%-10px)]">
                <option value="" disabled>
                  {t('hr.familyAdd.relationPick')}
                </option>
                {FAMILY_RELATIONS.map((r) => (
                  <option key={r} value={r}>
                    {RELATION_LABEL[r]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label={t('hr.familyAdd.fullName')} error={tm(errors.fullName?.message)} hint={t('hr.familyAdd.fullNameHint')}>
            {(f) => <Input {...f} {...register('fullName')} autoComplete="off" maxLength={120} className="h-12" placeholder={t('hr.familyAdd.namePlaceholder')} />}
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
          {relation === 'child' && (
            <Controller
              control={control}
              name="isStudent"
              render={({ field }) => (
                <label className="flex min-h-11 cursor-pointer items-start gap-3">
                  <Checkbox checked={!!field.value} onCheckedChange={field.onChange} aria-label={t('hr.familyAdd.student')} className="mt-0.5" />
                  <span>
                    <span className="block font-medium">{t('hr.familyAdd.student')}</span>
                    <span className="block text-[13px] text-muted">{t('hr.familyAdd.studentHint')}</span>
                  </span>
                </label>
              )}
            />
          )}
          {relation && relation !== 'child' && (
            <Controller
              control={control}
              name="phone"
              render={({ field, fieldState }) => (
                <Field label={t('hr.familyAdd.phone')} error={tm(fieldState.error?.message)} hint={t('hr.familyAdd.phoneHint')} className="sm:max-w-[calc(50%-10px)]">
                  {(f) => <MaskedInput mask="phone" {...f} ref={field.ref} name={field.name} value={field.value ?? ''} onChange={field.onChange} onBlur={field.onBlur} className="h-12" />}
                </Field>
              )}
            />
          )}
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
            {t('hr.familyAdd.note')}
          </p>

          {errors.root?.message && (
            <p role="alert" className="rounded-btn bg-danger-soft p-3 text-danger-text">
              {tm(errors.root.message)}
            </p>
          )}

          <div className="flex flex-wrap gap-3">
            <Button type="submit" className={HR_BTN} loading={add.isPending}>
              {t('hr.familyAdd.submit')}
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
