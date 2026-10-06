/*
 * A claim registered by MIG staff (operator, claims officer). Opened from the insured card (the person is preset)
 * or from «+ Создать → Убыток» on the claims page (the person is found here). The same `staffClaimSchema` validates
 * the multipart body on the server, which checks `claims.create` and sets the reserve to the claimed amount.
 */
import { t, tm } from '@/i18n';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { z } from 'zod';
import type { ClaimCategory } from '@/shared/types';
import { useCreateClaim, useInsuredList } from '@/shared/api/queries/staff';
import { errorMessage } from '@/shared/api/client';
import { useCan } from '@/shared/auth/guards';
import { staffClaimSchema } from '@/shared/schemas/forms';
import { CLAIM_CATEGORY_LABEL, CLAIM_INTAKE_CHANNELS, CLAIM_INTAKE_LABEL } from '@/shared/domain/claims';
import { maskMoney, parseMoney } from '@/shared/lib/masks';
import { useDebounced } from '@/shared/lib/hooks';
import { Button } from '@/shared/ui/button';
import { Modal } from '@/shared/ui/dialog';
import { Field, Input, Select } from '@/shared/ui/input';
import { MaskedInput } from '@/shared/ui/masked-input';
import { FilesPicker } from '@/shared/ui/files-picker';
import { toast } from '@/shared/ui/toast';

type ClaimValues = z.input<typeof staffClaimSchema>;
const CATS: ClaimCategory[] = ['medicines', 'doctor_visit', 'diagnostics', 'dental', 'inpatient'];

export interface ClaimInsured {
  id: string;
  fullName: string;
}

export function NewClaimDialog({ open, onOpenChange, insured }: { open: boolean; onOpenChange: (v: boolean) => void; insured?: ClaimInsured }) {
  const create = useCreateClaim();
  const navigate = useNavigate();
  const showsReserve = useCan('claims.reserves');
  const [picked, setPicked] = useState<ClaimInsured | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const form = useForm<ClaimValues>({
    resolver: zodResolver(staffClaimSchema),
    defaultValues: { insuredId: insured?.id ?? '', intakeChannel: '' as ClaimValues['intakeChannel'], category: 'doctor_visit', amount: 0, serviceDate: '', providerName: '' },
    mode: 'onTouched',
  });
  const close = (v: boolean) => {
    onOpenChange(v);
    if (!v) {
      form.reset();
      setPicked(null);
      setFiles([]);
    }
  };
  const onSubmit = form.handleSubmit(async (v) => {
    try {
      const res = await create.mutateAsync({ ...v, files });
      toast.success(t('staff.insuredCard.claimCreated'));
      close(false);
      navigate(`/staff/claims/${res.id}`);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  });
  const choose = (i: ClaimInsured | null) => {
    setPicked(i);
    form.setValue('insuredId', i?.id ?? '', { shouldValidate: i !== null });
  };
  return (
    <Modal
      open={open}
      onOpenChange={close}
      title={t('staff.insuredCard.newClaim')}
      footer={
        <>
          <Button variant="secondary" onClick={() => close(false)}>
            {t('common.cancel')}
          </Button>
          <Button loading={create.isPending} onClick={() => void onSubmit()}>
            {t('staff.insuredCard.createClaim')}
          </Button>
        </>
      }
    >
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-3">
        {insured ? (
          <Field label={t('common.insured')}>{(a) => <Input {...a} value={insured.fullName} readOnly />}</Field>
        ) : (
          <InsuredPicker picked={picked} onPick={choose} error={form.formState.errors.insuredId?.message} />
        )}
        <Field label={t('staff.insuredCard.intakeChannel')} error={tm(form.formState.errors.intakeChannel?.message)}>
          {(a) => (
            <Select {...a} {...form.register('intakeChannel')}>
              <option value="" disabled>
                —
              </option>
              {CLAIM_INTAKE_CHANNELS.map((c) => (
                <option key={c} value={c}>
                  {CLAIM_INTAKE_LABEL[c]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t('common.category')}>
          {(a) => (
            <Select {...a} {...form.register('category')}>
              {CATS.map((c) => (
                <option key={c} value={c}>
                  {CLAIM_CATEGORY_LABEL[c]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t('staff.insuredCard.amountUzs')} error={tm(form.formState.errors.amount?.message)} hint={showsReserve ? t('staff.insuredCard.reserveNote') : undefined}>
          {(a) => (
            <Controller
              control={form.control}
              name="amount"
              render={({ field }) => (
                <MaskedInput {...a} mask="money" value={field.value ? maskMoney(String(field.value)) : ''} onChange={(v) => field.onChange(parseMoney(v))} onBlur={field.onBlur} />
              )}
            />
          )}
        </Field>
        <Field label={t('staff.insuredCard.eventDate')} error={tm(form.formState.errors.serviceDate?.message)}>
          {(a) => (
            <Controller
              control={form.control}
              name="serviceDate"
              render={({ field }) => <MaskedInput {...a} mask="date" value={field.value} onChange={field.onChange} onBlur={field.onBlur} />}
            />
          )}
        </Field>
        <Field label={t('staff.insuredCard.provider')} error={tm(form.formState.errors.providerName?.message)}>
          {(a) => <Input {...a} maxLength={120} {...form.register('providerName')} />}
        </Field>
        <FilesPicker files={files} onChange={setFiles} label={t('staff.insuredCard.claimFiles')} />
      </form>
    </Modal>
  );
}

/** Search by name (at least two characters); the server returns masked rows within the user's rights. */
function InsuredPicker({ picked, onPick, error }: { picked: ClaimInsured | null; onPick: (i: ClaimInsured | null) => void; error?: string }) {
  const [q, setQ] = useState('');
  const term = useDebounced(q.trim(), 250);
  const found = useInsuredList({ q: term, pageSize: 5 }, !picked && term.length >= 2);
  if (picked)
    return (
      <Field label={t('common.insured')}>
        {(a) => (
          <div className="flex items-center gap-2">
            <Input {...a} value={picked.fullName} readOnly className="flex-1" />
            <Button variant="secondary" onClick={() => onPick(null)}>
              {t('staff.insuredCard.changeInsured')}
            </Button>
          </div>
        )}
      </Field>
    );
  const items = term.length >= 2 ? (found.data?.items ?? []) : [];
  return (
    <Field label={t('common.insured')} error={tm(error)}>
      {(a) => (
        <div className="flex flex-col gap-1">
          <Input {...a} type="search" value={q} maxLength={100} placeholder={t('create.claimPick.placeholder')} autoComplete="off" onChange={(e) => setQ(e.target.value)} />
          {term.length >= 2 && !found.isLoading && (
            <ul className="flex flex-col rounded-btn border border-border" aria-label={t('common.insured')}>
              {items.length === 0 ? (
                <li className="px-2 py-1.5 text-muted">{t('common.notFound')}</li>
              ) : (
                items.map((i) => (
                  <li key={i.id}>
                    <button type="button" className="flex w-full items-center gap-2 px-2 py-1.5 text-left hover:bg-rail" onClick={() => onPick({ id: i.id, fullName: i.fullName })}>
                      <span className="font-medium">{i.fullName}</span>
                      <span className="ml-auto truncate text-[12px] text-muted">{i.clientName}</span>
                    </button>
                  </li>
                ))
              )}
            </ul>
          )}
        </div>
      )}
    </Field>
  );
}
