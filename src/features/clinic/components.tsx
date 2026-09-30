/* Pieces shared by clinic cabinet screens. */
import { useEffect, useState, type ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { z } from 'zod';
import { Paperclip, X } from 'lucide-react';
import type { CoverageCheckResult, GuaranteeStatus } from '@/shared/types';
import { guaranteeCreateRequest } from '@/shared/integration/schemas';
import { useClinicPriceList, useRequestGuarantee } from '@/shared/api/queries/clinic';
import { errorMessage } from '@/shared/api/client';
import {
  COVERAGE_LABEL,
  GUARANTEE_STATUS_CHIP,
  GUARANTEE_STATUS_LABEL,
  LIMIT_STATE_LABEL,
  SERVICE_CATEGORY_LABEL,
} from '@/shared/domain/clinics';
import { ATTACHMENT_ACCEPT, ATTACHMENT_MAX_FILES, prepareAttachment } from '@/shared/lib/attachments';
import { formatDate, formatMoney } from '@/shared/lib/format';
import { cn } from '@/shared/lib/cn';
import { Button } from '@/shared/ui/button';
import { Chip } from '@/shared/ui/chips';
import { Modal } from '@/shared/ui/dialog';
import { Field, Input, Select, Textarea } from '@/shared/ui/input';
import { toast } from '@/shared/ui/toast';

export function PageTitle({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="font-heading text-[26px] font-semibold leading-tight">{title}</h1>
        {subtitle && <div className="mt-1 text-muted">{subtitle}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Panel({ title, actions, children, className }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn('rounded-card border border-border bg-surface', className)}>
      {(title || actions) && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border-soft px-4 py-3">
          {title && <h2 className="font-heading text-[16px] font-semibold">{title}</h2>}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

export function GuaranteeChip({ status }: { status: GuaranteeStatus }) {
  return <Chip kind={GUARANTEE_STATUS_CHIP[status]}>{GUARANTEE_STATUS_LABEL[status]}</Chip>;
}

const COVERAGE_CHIP = { covered: 'success', needs_guarantee: 'warning', not_covered: 'danger' } as const;
const LIMIT_CHIP = { available: 'success', low: 'warning', exhausted: 'danger' } as const;

/** Minimal data for the registry desk (CLINIC_SPEC §3): no limit amounts, no history. */
export function CoverageCard({ result, actions }: { result: CoverageCheckResult; actions?: ReactNode }) {
  return (
    <Panel
      title={
        <span className="flex flex-wrap items-center gap-2">
          {result.person.fullName}
          <span className="text-[14px] font-normal text-muted">{result.person.birthYear} г. р.</span>
        </span>
      }
      actions={
        <Chip kind={result.policy.active ? 'success' : 'danger'} className="text-[13px]">
          {result.policy.active ? 'Полис действует' : 'Полис не действует'}
        </Chip>
      }
    >
      <div className="grid gap-4 p-4 md:grid-cols-[280px_minmax(0,1fr)]">
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-[14px]" data-testid="coverage-policy">
          <dt className="text-muted">Программа</dt>
          <dd className="font-semibold">{result.policy.programName}</dd>
          <dt className="text-muted">Полис</dt>
          <dd className="num">{result.policy.number}</dd>
          <dt className="text-muted">Действует до</dt>
          <dd className="num">{formatDate(result.policy.validTo)}</dd>
        </dl>
        <table className="w-full text-[14px]" data-testid="coverage-table">
          <caption className="sr-only">Покрытие по категориям услуг</caption>
          <thead>
            <tr className="border-b border-border text-left text-[12px] text-muted">
              <th className="py-1.5 pr-2 font-normal">Категория</th>
              <th className="py-1.5 pr-2 font-normal">Покрытие</th>
              <th className="py-1.5 font-normal">Лимит</th>
            </tr>
          </thead>
          <tbody>
            {result.categories.map((c) => (
              <tr key={c.category} className="border-b border-border-soft last:border-0">
                <td className="py-1.5 pr-2">{SERVICE_CATEGORY_LABEL[c.category]}</td>
                <td className="py-1.5 pr-2">
                  <Chip kind={COVERAGE_CHIP[c.status]}>{COVERAGE_LABEL[c.status]}</Chip>
                </td>
                <td className="py-1.5">
                  <Chip kind={LIMIT_CHIP[c.limitState]}>{LIMIT_STATE_LABEL[c.limitState]}</Chip>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {actions && <div className="flex flex-wrap gap-2 border-t border-border-soft px-4 py-3">{actions}</div>}
    </Panel>
  );
}

export function FilesPicker({ files, onChange, label = 'Вложения (направление, заключение)' }: { files: File[]; onChange: (f: File[]) => void; label?: string }) {
  const [error, setError] = useState<string | null>(null);
  const add = async (list: FileList | null) => {
    if (!list) return;
    setError(null);
    const out = [...files];
    for (const f of [...list]) {
      if (out.length >= ATTACHMENT_MAX_FILES) {
        setError(`Не больше ${ATTACHMENT_MAX_FILES} файлов`);
        break;
      }
      const r = await prepareAttachment(f, out.length);
      if ('error' in r) setError(r.error);
      else out.push(r.file);
    }
    onChange(out);
  };
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[12px] font-medium text-muted">{label}</span>
      <label className="inline-flex w-fit cursor-pointer items-center gap-2 rounded-btn border border-dashed border-border px-3 py-2 text-[14px] hover:bg-rail">
        <Paperclip className="h-4 w-4" aria-hidden /> Добавить файлы
        <input type="file" multiple accept={ATTACHMENT_ACCEPT} className="sr-only" onChange={(e) => void add(e.target.files)} aria-label="Добавить файлы" />
      </label>
      <span className="text-[12px] text-muted">PDF, JPEG или PNG до 10 МБ. Фото очищаются от метаданных.</span>
      {error && (
        <p role="alert" className="text-[12px] text-danger-text">
          {error}
        </p>
      )}
      {files.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {files.map((f, i) => (
            <li key={`${f.name}-${i}`} className="inline-flex items-center gap-1 rounded-btn bg-rail px-2 py-1 text-[12px]">
              {f.name}
              <button type="button" aria-label={`Убрать ${f.name}`} onClick={() => onChange(files.filter((_, k) => k !== i))}>
                <X className="h-3 w-3" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

type GpForm = z.input<typeof guaranteeCreateRequest>;

/** A new guarantee letter can only be requested from an open visit (CLINIC_SPEC §4.4). */
export function GuaranteeRequestDialog({ visitId, open, onOpenChange, onDone }: { visitId: string; open: boolean; onOpenChange: (o: boolean) => void; onDone?: () => void }) {
  const prices = useClinicPriceList();
  const requestGp = useRequestGuarantee();
  const [files, setFiles] = useState<File[]>([]);
  const form = useForm<GpForm>({
    resolver: zodResolver(guaranteeCreateRequest),
    defaultValues: { visitId, serviceCode: '', icd10: '', estimatedCost: 0, comment: '' },
    mode: 'onTouched',
  });
  const errors = form.formState.errors;
  useEffect(() => {
    if (open) {
      form.reset({ visitId, serviceCode: '', icd10: '', estimatedCost: 0, comment: '' });
      setFiles([]);
    }
  }, [open, visitId, form]);
  const list = [...(prices.data ?? [])].sort((a, b) => Number(b.requiresGuarantee) - Number(a.requiresGuarantee));

  const submit = form.handleSubmit(async (values) => {
    try {
      const g = await requestGp.mutateAsync({ input: values, files });
      toast.success(`Гарантийное письмо ${g.number} запрошено`);
      onOpenChange(false);
      onDone?.();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  });

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      wide
      title="Запросить гарантийное письмо"
      description="Запрос уйдёт врачу-эксперту МИГ. Ответ появится в разделе «Гарантийные письма»."
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Отмена
          </Button>
          <Button loading={requestGp.isPending} onClick={() => void submit()}>
            Отправить запрос
          </Button>
        </>
      }
    >
      <form className="grid gap-3 md:grid-cols-2" onSubmit={(e) => void submit(e)} noValidate>
        <Field label="Услуга из прайса" error={errors.serviceCode?.message} className="md:col-span-2">
          {(a) => (
            <Select
              {...a}
              {...form.register('serviceCode', {
                onChange: (e: { target: { value: string } }) => {
                  const svc = list.find((p) => p.code === e.target.value);
                  if (svc) form.setValue('estimatedCost', svc.price, { shouldValidate: true });
                },
              })}
            >
              <option value="">Выберите услугу</option>
              {list.map((p) => (
                <option key={p.code} value={p.code}>
                  {p.code} · {p.name}
                  {p.requiresGuarantee ? ' · нужно ГП' : ''}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Код МКБ-10" error={errors.icd10?.message} hint="Например, K35.8">
          {(a) => <Input {...a} autoComplete="off" maxLength={8} {...form.register('icd10')} />}
        </Field>
        <Field label="Предполагаемая стоимость, UZS" error={errors.estimatedCost?.message}>
          {(a) => <Input {...a} inputMode="numeric" {...form.register('estimatedCost', { setValueAs: (v: string | number) => Number(String(v).replace(/\s/g, '')) })} />}
        </Field>
        <Field label="Комментарий врача" error={errors.comment?.message} className="md:col-span-2">
          {(a) => <Textarea {...a} rows={3} maxLength={1000} {...form.register('comment')} />}
        </Field>
        <div className="md:col-span-2">
          <FilesPicker files={files} onChange={setFiles} />
        </div>
        {errors.estimatedCost === undefined && form.watch('estimatedCost') > 0 && (
          <p className="text-[12px] text-muted md:col-span-2">Сумма к согласованию: {formatMoney(form.watch('estimatedCost'))}</p>
        )}
      </form>
    </Modal>
  );
}

/** Seconds left until an ISO time, re-rendered every 30 s. */
export function useTimeLeft(iso: string): string {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((x) => x + 1), 30_000);
    return () => clearInterval(t);
  }, []);
  const ms = Date.parse(iso) - Date.now();
  if (ms <= 0) return 'истёк';
  const h = Math.floor(ms / 3600_000);
  const m = Math.floor((ms % 3600_000) / 60_000);
  return h ? `${h} ч ${m} мин` : `${m} мин`;
}
