import { useEffect, useId, useRef, useState, type ChangeEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Camera, CreditCard, ImagePlus, Loader2, Sparkles, X } from 'lucide-react';
import { useI18n, type I18nKey } from '@/i18n';
import { useMe, useRecognize, useSubmitClaim } from '@/shared/api/queries/me';
import { useAiCheck } from '@/shared/api/queries/ai';
import type { AiCheckResult } from '@/shared/types/dto';
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
import { aiLang } from '../lib';

interface Photo {
  id: number;
  blob: Blob;
  url: string;
}

type FieldKey = 'providerName' | 'amount' | 'serviceDate' | 'category';

const CATEGORIES: ClaimCategory[] = ['medicines', 'doctor_visit', 'diagnostics', 'dental'];
const FILE_ERR: Record<FileCheckError, I18nKey> = {
  type: 'app.refund.err.type',
  size: 'app.refund.err.size',
  count: 'app.refund.err.count',
  content: 'app.refund.err.content',
};
const FIELD_ERR: Record<FieldKey, I18nKey> = {
  providerName: 'app.refund.err.where',
  amount: 'app.refund.err.amount',
  serviceDate: 'app.refund.err.date',
  category: 'app.refund.err.category',
};

let photoSeq = 0;

export default function NewClaimPage() {
  const { t, lang } = useI18n();
  useDocumentTitle(t('app.refund.title'));
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
  // Receipt positions labelled by the coverage check (AI_COVERAGE_SPEC §4.1).
  const aiCheck = useAiCheck();
  const [labelled, setLabelled] = useState<AiCheckResult | null>(null);

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
      // The server answers `available: false` when the scenario is off or the kill switch is on.
      if (r.items?.length) {
        try {
          const res = await aiCheck.mutateAsync({ scenario: 'insured', items: r.items.map((x) => ({ text: x.name, amount: x.amount })), lang: aiLang(lang) });
          setLabelled(res.available ? res : null);
        } catch {
          setLabelled(null);
        }
      }
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
      toast.success(t('app.refund.sent'));
      navigate(`/app/claims/${res.id}`, { replace: true });
    } catch (e) {
      setSubmitError(errorMessage(e));
    }
  };

  const err = (k: FieldKey) => (errors[k] ? t(errors[k]) : undefined);
  const card = me.data?.payoutCardMasked ?? '•••• ••••';

  return (
    <div>
      <ScreenHeader title={t('app.refund.title')} back={step === 1 ? () => setStep(0) : '/app/claims'} />
      <WizardSteps labels={[t('app.refund.step1'), t('app.refund.step2')]} current={step} />

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
                  <span className="font-bold">{t('app.refund.addPhoto')}</span>
                  <span className="text-[13px] text-muted">{t('app.refund.photoHint')}</span>
                </label>
              ) : (
                <div>
                  <p className="mb-2 text-[14px] font-semibold text-muted">{t('app.refund.photos', { n: photos.length })}</p>
                  <ul className="grid grid-cols-3 gap-2">
                    {photos.map((p, i) => (
                      <li key={p.id} className="relative aspect-square overflow-hidden rounded-btn border border-border bg-rail">
                        <img src={p.url} alt={t('app.refund.photoAlt', { n: i + 1 })} className="h-full w-full object-cover" />
                        <button
                          type="button"
                          aria-label={`${t('app.refund.removePhoto')} ${i + 1}`}
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
                          {t('app.refund.addMore')}
                        </label>
                      </li>
                    )}
                  </ul>
                </div>
              )}
              {processing && (
                <p className="mt-2 flex items-center gap-2 text-[14px] text-muted" role="status">
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  {t('app.refund.processing')}
                </p>
              )}
              {photoError && (
                <p role="alert" className="mt-2 text-[13px] font-semibold text-danger-text">
                  {t('app.refund.err.noPhoto')}
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
                {t('app.refund.recognizing')}
              </p>
            )}
            {recognized === 'ok' && !recognize.isPending && (
              <p className="flex items-center gap-2 rounded-btn bg-accent-soft px-4 py-3 font-semibold text-accent-text" role="status">
                <Sparkles className="h-4 w-4" aria-hidden />
                {t('app.refund.recognized')}
              </p>
            )}
            {recognized === 'failed' && !recognize.isPending && (
              <p className="rounded-btn bg-peach px-4 py-3 font-semibold text-peach-text" role="status">
                {t('app.refund.recognizeFailed')}
              </p>
            )}

            {labelled && labelled.items.length > 0 && (
              <section className="rounded-card border border-border bg-surface p-4" aria-label={t('app.coverage.items')} data-testid="receipt-items">
                <p className="mb-2 font-bold">{t('app.coverage.items')}</p>
                <ul className="flex flex-col gap-2">
                  {labelled.items.map((x) => (
                    <li key={x.logId} className="flex items-center justify-between gap-2 text-[14px]" data-testid="receipt-item" data-label={x.receiptLabel}>
                      <span className="min-w-0">
                        <span className="block truncate font-semibold">{x.input}</span>
                        <span className="num text-muted">{formatMoney(x.amount ?? 0)}</span>
                      </span>
                      <span
                        className={cn(
                          'shrink-0 rounded-full px-3 py-1 text-[13px] font-bold',
                          x.receiptLabel === 'refund' ? 'bg-accent-soft text-accent-text' : x.receiptLabel === 'no_refund' ? 'bg-danger-soft text-danger-text' : 'bg-sun text-sun-text',
                        )}
                      >
                        {t(`app.coverage.r.${x.receiptLabel ?? 'check'}`)}
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="mt-3 rounded-btn bg-sky px-3 py-2 font-semibold text-sky-text" data-testid="receipt-expected">
                  {t('app.coverage.expected', { amount: formatMoney(labelled.expectedReimbursement ?? 0) })}
                </p>
                {labelled.items.some((x) => x.receiptLabel === 'no_refund') && (
                  <Button
                    type="button"
                    variant="secondary"
                    className="mt-2 h-11 w-full rounded-btn text-[14px] font-semibold"
                    onClick={() => {
                      const keep = labelled.items.filter((x) => x.receiptLabel !== 'no_refund');
                      setLabelled({ ...labelled, items: keep });
                      setAmount(maskMoney(String(keep.reduce((s, x) => s + (x.amount ?? 0), 0))));
                      toast.success(t('app.coverage.removed'));
                    }}
                  >
                    {t('app.coverage.removeNo')}
                  </Button>
                )}
                <p className="mt-2 text-[12px] text-muted">{t('app.coverage.disclaimer')}</p>
              </section>
            )}

            <Field label={t('app.refund.where')} error={err('providerName')}>
              {(a) => (
                <Input {...a} value={providerName} maxLength={120} onChange={(e) => setProviderName(e.target.value)} className="h-12 text-[15px]" />
              )}
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label={t('app.refund.amount')} error={err('amount')}>
                {(a) => <MaskedInput {...a} mask="money" value={amount} onChange={setAmount} className="h-12 text-[15px]" />}
              </Field>
              <Field label={t('app.refund.date')} error={err('serviceDate')}>
                {(a) => (
                  <MaskedInput
                    {...a}
                    mask="date"
                    value={serviceDate}
                    onChange={setServiceDate}
                    placeholder={t('app.refund.datePlaceholder')}
                    className="h-12 text-[15px]"
                  />
                )}
              </Field>
            </div>

            <fieldset>
              <legend className="mb-2 text-[12px] font-medium text-muted">{t('app.refund.what')}</legend>
              <div className="flex flex-wrap gap-2">
                {CATEGORIES.map((c) => (
                  <ChoiceChip key={c} selected={category === c} onClick={() => setCategory(c)}>
                    {t(`app.claimCat.${c}`)}
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
              {t('app.refund.payout', { card })}
            </p>

            <Button type="submit" disabled={processing} className={BIG}>
              {t('app.common.continue')}
            </Button>
          </form>
        ) : (
          <div className="flex flex-col gap-4">
            <h2 className="font-heading text-[20px] font-semibold">{t('app.refund.check')}</h2>
            <ul className="flex gap-2 overflow-x-auto">
              {photos.map((p, i) => (
                <li key={p.id} className="h-20 w-20 shrink-0 overflow-hidden rounded-btn border border-border">
                  <img src={p.url} alt={t('app.refund.photoAlt', { n: i + 1 })} className="h-full w-full object-cover" />
                </li>
              ))}
            </ul>
            {values.success && (
              <dl className="divide-y divide-border-soft rounded-card border border-border bg-surface px-4">
                <div className="flex justify-between gap-3 py-3">
                  <dt className="text-muted">{t('app.status.what')}</dt>
                  <dd className="text-right font-bold">{t(`app.claimCat.${values.data.category}`)}</dd>
                </div>
                <div className="flex justify-between gap-3 py-3">
                  <dt className="text-muted">{t('app.refund.where')}</dt>
                  <dd className="text-right font-bold">{values.data.providerName}</dd>
                </div>
                <div className="flex justify-between gap-3 py-3">
                  <dt className="text-muted">{t('app.status.amount')}</dt>
                  <dd className="font-bold">{formatMoney(values.data.amount)}</dd>
                </div>
                <div className="flex justify-between gap-3 py-3">
                  <dt className="text-muted">{t('app.refund.date')}</dt>
                  <dd className="font-bold">{formatDate(values.data.serviceDate)}</dd>
                </div>
              </dl>
            )}
            <p className="flex items-center gap-2 rounded-card bg-sky px-4 py-3 font-semibold text-sky-text">
              <CreditCard className="h-5 w-5 shrink-0" aria-hidden />
              {t('app.refund.payout', { card })}
            </p>
            {submitError && (
              <p role="alert" className="rounded-btn bg-danger-soft px-4 py-3 font-semibold text-danger-text">
                {submitError}
              </p>
            )}
            <Button onClick={() => void send()} loading={submitClaim.isPending} className={BIG}>
              {t('app.refund.submit')}
            </Button>
            <Button variant="secondary" onClick={() => setStep(0)} className={BIG}>
              {t('app.common.edit')}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
