import { useEffect, useId, useRef, useState, type ChangeEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Camera, CreditCard, ImagePlus, Loader2, Sparkles, X } from 'lucide-react';
import { useI18n, type I18nKey } from '@/i18n';
import { useMe, useRecognize, useSubmitClaim } from '@/shared/api/queries/me';
import { errorMessage } from '@/shared/api/client';
import type { ClaimCategory } from '@/shared/types';
import { checkImageFile, reencodeImage, RECEIPT_LIMITS, type FileCheckError } from '@/shared/lib/image';
import { formatDate, formatMoney } from '@/shared/lib/format';
import { maskMoney, parseMoney } from '@/shared/lib/masks';
import { useDocumentTitle } from '@/shared/lib/hooks';
import { logger } from '@/shared/lib/logger';
import { cn } from '@/shared/lib/cn';
import { myClaimSchema } from '@/shared/schemas/forms';
import { Button } from '@/shared/ui/button';
import { Field, Input } from '@/shared/ui/input';
import { MaskedInput } from '@/shared/ui/masked-input';
import { toast } from '@/shared/ui/toast';
import { BIG, ChoiceChip, ScreenHeader, WizardSteps } from '../components';

interface Photo {
  id: number;
  blob: Blob;
  url: string;
}

type FieldKey = 'providerName' | 'amount' | 'serviceDate' | 'category';

const CATEGORIES: ClaimCategory[] = ['medicines', 'doctor_visit', 'diagnostics', 'dental'];
const FILE_ERR: Record<FileCheckError, I18nKey> = {
  type: 'refund.err.type',
  size: 'refund.err.size',
  count: 'refund.err.count',
  content: 'refund.err.content',
};
const FIELD_ERR: Record<FieldKey, I18nKey> = {
  providerName: 'refund.err.where',
  amount: 'refund.err.amount',
  serviceDate: 'refund.err.date',
  category: 'refund.err.category',
};

let photoSeq = 0;

export default function NewClaimPage() {
  const { t } = useI18n();
  useDocumentTitle(t('refund.title'));
  const navigate = useNavigate();
  const me = useMe();
  const recognize = useRecognize();
  const submitClaim = useSubmitClaim();
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<0 | 1>(0);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [processing, setProcessing] = useState(false);
  const [fileErrors, setFileErrors] = useState<I18nKey[]>([]);
  const [recognized, setRecognized] = useState<'no' | 'ok' | 'failed'>('no');
  const [providerName, setProviderName] = useState('');
  const [amount, setAmount] = useState('');
  const [serviceDate, setServiceDate] = useState('');
  const [category, setCategory] = useState<ClaimCategory | null>(null);
  const [errors, setErrors] = useState<Partial<Record<FieldKey, I18nKey>>>({});
  const [photoError, setPhotoError] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Revoke every preview URL on unmount.
  const photosRef = useRef<Photo[]>([]);
  photosRef.current = photos;
  useEffect(() => () => photosRef.current.forEach((p) => URL.revokeObjectURL(p.url)), []);

  const runRecognize = async (blob: Blob) => {
    try {
      const r = await recognize.mutateAsync(blob);
      setProviderName((v) => v || r.providerName);
      setAmount((v) => v || maskMoney(String(r.amount)));
      setServiceDate((v) => v || formatDate(r.serviceDate));
      setRecognized('ok');
    } catch {
      setRecognized('failed');
    }
  };

  const onFiles = async (e: ChangeEvent<HTMLInputElement>) => {
    const list = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (list.length === 0) return;
    setProcessing(true);
    const errs = new Set<I18nKey>();
    const added: Photo[] = [];
    const room = RECEIPT_LIMITS.maxFiles - photos.length;
    for (const file of list) {
      if (added.length >= room) {
        errs.add(FILE_ERR.count);
        break;
      }
      const err = await checkImageFile(file);
      if (err) {
        errs.add(FILE_ERR[err]);
        continue;
      }
      try {
        // Only the re-encoded blob (no EXIF/GPS) is kept and uploaded.
        const blob = await reencodeImage(file);
        added.push({ id: ++photoSeq, blob, url: URL.createObjectURL(blob) });
      } catch {
        logger.warn('receipt re-encode failed');
        errs.add(FILE_ERR.content);
      }
    }
    setProcessing(false);
    setFileErrors([...errs]);
    if (added.length === 0) return;
    setPhotoError(false);
    const wasEmpty = photos.length === 0;
    setPhotos((prev) => [...prev, ...added]);
    const first = added[0];
    if (wasEmpty && first) void runRecognize(first.blob);
  };

  const removePhoto = (id: number) => {
    setPhotos((prev) => {
      const p = prev.find((x) => x.id === id);
      if (p) URL.revokeObjectURL(p.url);
      return prev.filter((x) => x.id !== id);
    });
  };

  const validate = () => {
    const parsed = myClaimSchema.safeParse({
      category: category ?? undefined,
      amount: parseMoney(amount),
      serviceDate,
      providerName,
    });
    const next: Partial<Record<FieldKey, I18nKey>> = {};
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const k = issue.path[0] as FieldKey | undefined;
        if (k && k in FIELD_ERR && !next[k]) next[k] = FIELD_ERR[k];
      }
    }
    setErrors(next);
    setPhotoError(photos.length === 0);
    return parsed.success && photos.length > 0 ? parsed.data : null;
  };

  const values = myClaimSchema.safeParse({ category: category ?? undefined, amount: parseMoney(amount), serviceDate, providerName });

  const send = async () => {
    const data = validate();
    if (!data) {
      setStep(0);
      return;
    }
    setSubmitError(null);
    try {
      const res = await submitClaim.mutateAsync({
        files: photos.map((p) => p.blob),
        category: data.category,
        amount: data.amount,
        serviceDate: data.serviceDate,
        providerName: data.providerName,
      });
      toast.success(t('refund.sent'));
      navigate(`/app/claims/${res.id}`, { replace: true });
    } catch (e) {
      setSubmitError(errorMessage(e));
    }
  };

  const err = (k: FieldKey) => (errors[k] ? t(errors[k]) : undefined);
  const card = me.data?.payoutCardMasked ?? '•••• ••••';

  return (
    <div>
      <ScreenHeader title={t('refund.title')} back={step === 1 ? () => setStep(0) : '/app/claims'} />
      <WizardSteps labels={[t('refund.step1'), t('refund.step2')]} current={step} />

      <div key={step} className="animate-step">
        {step === 0 ? (
          <form
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              if (validate()) setStep(1);
            }}
            className="flex flex-col gap-5"
          >
            <div>
              <input
                ref={inputRef}
                id={inputId}
                data-testid="receipt-input"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                capture="environment"
                multiple
                className="sr-only"
                onChange={(e) => void onFiles(e)}
                disabled={processing || photos.length >= RECEIPT_LIMITS.maxFiles}
              />
              {photos.length === 0 ? (
                <label
                  htmlFor={inputId}
                  className={cn(
                    'flex min-h-[150px] cursor-pointer flex-col items-center justify-center gap-2 rounded-card border-2 border-dashed bg-surface p-5 text-center hover:border-accent',
                    photoError ? 'border-danger' : 'border-border',
                  )}
                >
                  <span className="flex h-12 w-12 items-center justify-center rounded-full bg-peach text-peach-text">
                    <Camera className="h-6 w-6" aria-hidden />
                  </span>
                  <span className="font-bold">{t('refund.addPhoto')}</span>
                  <span className="text-[13px] text-muted">{t('refund.photoHint')}</span>
                </label>
              ) : (
                <div>
                  <p className="mb-2 text-[14px] font-semibold text-muted">{t('refund.photos', { n: photos.length })}</p>
                  <ul className="grid grid-cols-3 gap-2">
                    {photos.map((p, i) => (
                      <li key={p.id} className="relative aspect-square overflow-hidden rounded-btn border border-border bg-rail">
                        <img src={p.url} alt={t('refund.photoAlt', { n: i + 1 })} className="h-full w-full object-cover" />
                        <button
                          type="button"
                          aria-label={`${t('refund.removePhoto')} ${i + 1}`}
                          onClick={() => removePhoto(p.id)}
                          className="absolute right-1 top-1 flex h-9 w-9 items-center justify-center rounded-full bg-text/70 text-white"
                        >
                          <X className="h-4 w-4" aria-hidden />
                        </button>
                      </li>
                    ))}
                    {photos.length < RECEIPT_LIMITS.maxFiles && (
                      <li>
                        <label
                          htmlFor={inputId}
                          className="flex aspect-square cursor-pointer flex-col items-center justify-center gap-1 rounded-btn border-2 border-dashed border-border bg-surface p-2 text-center text-[12px] font-semibold text-muted hover:border-accent"
                        >
                          <ImagePlus className="h-6 w-6" aria-hidden />
                          {t('refund.addMore')}
                        </label>
                      </li>
                    )}
                  </ul>
                </div>
              )}
              {processing && (
                <p className="mt-2 flex items-center gap-2 text-[14px] text-muted" role="status">
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  {t('refund.processing')}
                </p>
              )}
              {photoError && (
                <p role="alert" className="mt-2 text-[13px] font-semibold text-danger-text">
                  {t('refund.err.noPhoto')}
                </p>
              )}
              {fileErrors.map((k) => (
                <p key={k} role="alert" className="mt-2 text-[13px] font-semibold text-danger-text">
                  {t(k)}
                </p>
              ))}
            </div>

            {recognize.isPending && (
              <p className="flex items-center gap-2 rounded-btn bg-sky px-4 py-3 font-semibold text-sky-text" role="status">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                {t('refund.recognizing')}
              </p>
            )}
            {recognized === 'ok' && !recognize.isPending && (
              <p className="flex items-center gap-2 rounded-btn bg-accent-soft px-4 py-3 font-semibold text-accent-text" role="status">
                <Sparkles className="h-4 w-4" aria-hidden />
                {t('refund.recognized')}
              </p>
            )}
            {recognized === 'failed' && !recognize.isPending && (
              <p className="rounded-btn bg-peach px-4 py-3 font-semibold text-peach-text" role="status">
                {t('refund.recognizeFailed')}
              </p>
            )}

            <Field label={t('refund.where')} error={err('providerName')}>
              {(a) => (
                <Input {...a} value={providerName} maxLength={120} onChange={(e) => setProviderName(e.target.value)} className="h-12 text-[15px]" />
              )}
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label={t('refund.amount')} error={err('amount')}>
                {(a) => <MaskedInput {...a} mask="money" value={amount} onChange={setAmount} className="h-12 text-[15px]" />}
              </Field>
              <Field label={t('refund.date')} error={err('serviceDate')}>
                {(a) => (
                  <MaskedInput
                    {...a}
                    mask="date"
                    value={serviceDate}
                    onChange={setServiceDate}
                    placeholder={t('refund.datePlaceholder')}
                    className="h-12 text-[15px]"
                  />
                )}
              </Field>
            </div>

            <fieldset>
              <legend className="mb-2 text-[12px] font-medium text-muted">{t('refund.what')}</legend>
              <div className="flex flex-wrap gap-2">
                {CATEGORIES.map((c) => (
                  <ChoiceChip key={c} selected={category === c} onClick={() => setCategory(c)}>
                    {t(`claimCat.${c}`)}
                  </ChoiceChip>
                ))}
              </div>
              {errors.category && (
                <p role="alert" className="mt-2 text-[12px] text-danger-text">
                  {t(errors.category)}
                </p>
              )}
            </fieldset>

            <p className="flex items-center gap-2 rounded-card bg-sky px-4 py-3 font-semibold text-sky-text">
              <CreditCard className="h-5 w-5 shrink-0" aria-hidden />
              {t('refund.payout', { card })}
            </p>

            <Button type="submit" disabled={processing} className={BIG}>
              {t('common.continue')}
            </Button>
          </form>
        ) : (
          <div className="flex flex-col gap-4">
            <h2 className="font-heading text-[20px] font-semibold">{t('refund.check')}</h2>
            <ul className="flex gap-2 overflow-x-auto">
              {photos.map((p, i) => (
                <li key={p.id} className="h-20 w-20 shrink-0 overflow-hidden rounded-btn border border-border">
                  <img src={p.url} alt={t('refund.photoAlt', { n: i + 1 })} className="h-full w-full object-cover" />
                </li>
              ))}
            </ul>
            {values.success && (
              <dl className="divide-y divide-border-soft rounded-card border border-border bg-surface px-4">
                <div className="flex justify-between gap-3 py-3">
                  <dt className="text-muted">{t('status.what')}</dt>
                  <dd className="text-right font-bold">{t(`claimCat.${values.data.category}`)}</dd>
                </div>
                <div className="flex justify-between gap-3 py-3">
                  <dt className="text-muted">{t('refund.where')}</dt>
                  <dd className="text-right font-bold">{values.data.providerName}</dd>
                </div>
                <div className="flex justify-between gap-3 py-3">
                  <dt className="text-muted">{t('status.amount')}</dt>
                  <dd className="font-bold">{formatMoney(values.data.amount)}</dd>
                </div>
                <div className="flex justify-between gap-3 py-3">
                  <dt className="text-muted">{t('refund.date')}</dt>
                  <dd className="font-bold">{formatDate(values.data.serviceDate)}</dd>
                </div>
              </dl>
            )}
            <p className="flex items-center gap-2 rounded-card bg-sky px-4 py-3 font-semibold text-sky-text">
              <CreditCard className="h-5 w-5 shrink-0" aria-hidden />
              {t('refund.payout', { card })}
            </p>
            {submitError && (
              <p role="alert" className="rounded-btn bg-danger-soft px-4 py-3 font-semibold text-danger-text">
                {submitError}
              </p>
            )}
            <Button onClick={() => void send()} loading={submitClaim.isPending} className={BIG}>
              {t('refund.submit')}
            </Button>
            <Button variant="secondary" onClick={() => setStep(0)} className={BIG}>
              {t('common.edit')}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
