/*
 * Commercial offer screen (KP_SPEC §9): parameters on the left, live preview of all pages on the right.
 * Routes: /staff/clients/:clientId/kp/new?policyId=&from=  and  /staff/kp/:kpId
 */
import { useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { z } from 'zod';
import { Download, FilePlus2, Send, Undo2 } from 'lucide-react';
import type { KpDocument, KpParams } from '@/shared/types';
import type { KpDefaults } from '@/shared/types/dto';
import { kpParamsSchema } from '@/shared/schemas/forms';
import { useClient } from '@/shared/api/queries/staff';
import { useCreateKp, useKp, useKpAction, useKpDefaults, useKpDownloaded, useUpdateKp } from '@/shared/api/queries/kp';
import { errorMessage } from '@/shared/api/client';
import { useCan } from '@/shared/auth/guards';
import { KP_STATUS_CHIP, KP_STATUS_LABEL, KP_TEMPLATE_VERSION, kpTotalPremium } from '@/shared/domain/kp';
import { formatMoney, formatPercent, todayISO } from '@/shared/lib/format';
import { maskDate, maskMoney, parseMoney } from '@/shared/lib/masks';
import { useDebounced, useDocumentTitle } from '@/shared/lib/hooks';
import { Button } from '@/shared/ui/button';
import { Chip } from '@/shared/ui/chips';
import { ConfirmDialog } from '@/shared/ui/confirm-dialog';
import { Field, Input, Select } from '@/shared/ui/input';
import { MaskedInput } from '@/shared/ui/masked-input';
import { ErrorState, SkeletonRows } from '@/shared/ui/states';
import { toast } from '@/shared/ui/toast';
import { useTopbar } from '@/features/staff/topbar';
import { printKpFrame } from './KpFrame';
import { KpPreview } from './KpPreview';
import { PRINT_HINT } from './KpDownloadButton';
import { kpContextOf, kpSrcdoc, renderKp, type KpRenderContext } from './render';
import { KP_TEMPLATES } from './templates';

type FormIn = z.input<typeof kpParamsSchema>;
type Letter = KpDefaults['letter'];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const safeId = (v: string | null | undefined) => (v && UUID_RE.test(v) ? v : undefined);

const isoToRu = (iso: string) => iso.split('-').reverse().join('.');

function toForm(p: KpParams): FormIn {
  return { ...p, coverageStart: isoToRu(p.coverageStart), coverageEnd: isoToRu(p.coverageEnd), validUntil: isoToRu(p.validUntil) };
}

export default function KpPage() {
  const { clientId, kpId } = useParams();
  const [search] = useSearchParams();
  if (kpId) return <ExistingKp kpId={kpId} />;
  return <NewKp clientId={clientId ?? ''} policyId={safeId(search.get('policyId'))} fromId={safeId(search.get('from'))} />;
}

function NewKp({ clientId, policyId, fromId }: { clientId: string; policyId?: string; fromId?: string }) {
  const defaults = useKpDefaults(clientId, policyId);
  const source = useKp(fromId);
  if (defaults.isLoading || (fromId && source.isLoading)) return <SkeletonRows rows={12} />;
  if (defaults.isError || !defaults.data) return <ErrorState error={defaults.error} onRetry={() => void defaults.refetch()} />;
  // «Создать новую версию» copies parameters of an existing offer of the same client.
  const from = source.data && source.data.clientId === clientId ? source.data : undefined;
  return (
    <KpEditor
      key={from?.id ?? 'new'}
      clientId={clientId}
      policyId={from?.policyId ?? defaults.data.letter.policyId}
      initial={from?.params ?? defaults.data.params}
      letter={defaults.data.letter}
    />
  );
}

function ExistingKp({ kpId }: { kpId: string }) {
  const q = useKp(kpId);
  if (q.isLoading) return <SkeletonRows rows={12} />;
  if (q.isError || !q.data) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const kp = q.data;
  return <KpEditor key={kp.id} clientId={kp.clientId} policyId={kp.policyId} initial={kp.params} letter={kp} kp={kp} />;
}

function KpEditor({ clientId, policyId, initial, letter, kp }: { clientId: string; policyId?: string; initial: KpParams; letter: Letter; kp?: KpDocument }) {
  const navigate = useNavigate();
  const client = useClient(clientId);
  const canCreate = useCan('kp.create');
  const canSend = useCan('kp.send');
  const editable = canCreate && (!kp || kp.status === 'draft');
  const title = kp ? kp.number : 'Новое КП';
  useDocumentTitle(kp ? 'Коммерческое предложение' : 'Новое КП');
  useTopbar([{ label: 'Клиенты', to: '/staff/clients' }, { label: letter.clientName, to: `/staff/clients/${clientId}` }, { label: title }]);

  const form = useForm<FormIn, unknown, KpParams>({
    resolver: zodResolver(kpParamsSchema),
    defaultValues: toForm(initial),
    mode: 'onChange',
  });
  const errors = form.formState.errors;

  // Preview: re-render 200 ms after the last change; invalid input keeps the last valid preview.
  const watched = JSON.stringify(form.watch());
  const debounced = useDebounced(watched, 200);
  const lastValid = useRef<KpParams>(initial);
  const previewParams = useMemo(() => {
    const parsed = kpParamsSchema.safeParse(JSON.parse(debounced) as unknown);
    if (parsed.success) lastValid.current = parsed.data;
    return lastValid.current;
  }, [debounced]);

  const ctx: KpRenderContext = useMemo(
    () =>
      kp
        ? kpContextOf(kp)
        : {
            number: '—',
            date: todayISO(),
            clientLegalForm: letter.clientLegalForm,
            clientName: letter.clientName,
            clientInn: letter.clientInn,
            underwriterName: letter.createdByName,
            underwriterEmail: letter.createdByEmail,
            templateVersion: KP_TEMPLATE_VERSION[initial.templateId],
          },
    [kp, letter, initial.templateId],
  );
  const doc = useMemo(() => {
    const result = renderKp(previewParams, ctx);
    return { title: result.title, html: kpSrcdoc(result, KP_TEMPLATES[previewParams.templateId].assetBase, previewParams.lang) };
  }, [previewParams, ctx]);

  const live = JSON.parse(watched) as Partial<Record<'employees' | 'familyMembers' | 'premiumEmployee' | 'premiumFamily', number>>;
  const total = kpTotalPremium({
    employees: live.employees || 0,
    familyMembers: live.familyMembers || 0,
    premiumEmployee: live.premiumEmployee || 0,
    premiumFamily: live.premiumFamily || 0,
  });

  const create = useCreateKp();
  const update = useUpdateKp();
  const action = useKpAction();
  const downloaded = useKpDownloaded();
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const busy = create.isPending || update.isPending || action.isPending;

  const goToDocuments = (saved: KpDocument) =>
    navigate(`/staff/clients/${saved.clientId}?tab=documents&highlight=${saved.id}`);

  const save = (andSend: boolean) =>
    form.handleSubmit(async (params) => {
      try {
        let saved = kp ? await update.mutateAsync({ id: kp.id, params }) : await create.mutateAsync({ clientId, policyId, params });
        if (andSend) {
          saved = await action.mutateAsync({ id: saved.id, action: 'send' });
          toast.success(`${saved.number} сохранено и отправлено клиенту`);
        } else {
          toast.success(`${saved.number} сохранено в документах клиента`);
        }
        goToDocuments(saved);
      } catch (e) {
        toast.error(errorMessage(e));
      }
    })();

  const revoke = async () => {
    if (!kp) return;
    try {
      const saved = await action.mutateAsync({ id: kp.id, action: 'revoke' });
      toast.success(`${saved.number} отозвано`);
      setConfirmRevoke(false);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const frame = useRef<HTMLIFrameElement>(null);
  const download = async () => {
    if (!kp) return;
    try {
      await downloaded.mutateAsync(kp.id);
      await printKpFrame(frame.current);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const ref = client.data;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex flex-wrap items-center gap-2 text-[22px] font-bold leading-tight">
            {title}
            {kp && <Chip kind={KP_STATUS_CHIP[kp.status]}>{KP_STATUS_LABEL[kp.status]}</Chip>}
          </h1>
          <p className="text-muted">
            {letter.clientLegalForm} «{letter.clientName}» · программа GOLD · шаблон {kp?.templateVersion ?? KP_TEMPLATE_VERSION[initial.templateId]}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <div className="flex flex-wrap justify-end gap-2">
            {editable && (
              <>
                <Button variant="secondary" loading={busy && !action.isPending} disabled={busy} onClick={() => void save(false)}>
                  Сохранить черновик
                </Button>
                {canSend && (
                  <Button loading={action.isPending} disabled={busy} onClick={() => void save(true)}>
                    <Send className="h-3.5 w-3.5" aria-hidden /> Сохранить и отправить клиенту
                  </Button>
                )}
              </>
            )}
            {kp && canSend && kp.status === 'sent' && (
              <Button variant="secondary" disabled={busy} onClick={() => setConfirmRevoke(true)}>
                <Undo2 className="h-3.5 w-3.5" aria-hidden /> Отозвать
              </Button>
            )}
            {kp && canCreate && kp.status !== 'draft' && (
              <Button variant="secondary" onClick={() => navigate(`/staff/clients/${kp.clientId}/kp/new?from=${kp.id}`)}>
                <FilePlus2 className="h-3.5 w-3.5" aria-hidden /> Создать новую версию
              </Button>
            )}
            <Button
              variant="secondary"
              disabled={!kp}
              title={kp ? undefined : 'Сначала сохраните КП: у документа появится номер'}
              onClick={() => void download()}
            >
              <Download className="h-3.5 w-3.5" aria-hidden /> Скачать PDF
            </Button>
          </div>
          <p className="text-[12px] text-muted">{kp ? PRINT_HINT : 'Скачать PDF можно после сохранения'}</p>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[360px_minmax(0,1fr)]">
        <form
          className="flex flex-col gap-3 rounded-card border border-border bg-surface p-4"
          aria-label="Параметры КП"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            void save(false);
          }}
        >
          {!editable && kp && (
            <p className="rounded-btn bg-rail px-3 py-2 text-[12px] text-muted">
              {kp.status === 'draft' ? 'Черновик доступен только для просмотра.' : 'Отправленное или отозванное КП нельзя изменить. Создайте новую версию.'}
            </p>
          )}
          <fieldset disabled={!editable} className="flex flex-col gap-3 disabled:opacity-100">
            <Group title="Шаблон">
              <Field label="Программа">
                {(a) => (
                  <Select {...a} {...form.register('templateId')}>
                    <option value="gold">GOLD</option>
                  </Select>
                )}
              </Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Язык">
                  {(a) => (
                    <Select {...a} {...form.register('lang')}>
                      <option value="ru">Русский</option>
                      <option value="en">English</option>
                    </Select>
                  )}
                </Field>
                <Field label="Обложка">
                  {(a) => (
                    <Select {...a} {...form.register('variant')}>
                      <option value="white">Белая</option>
                      <option value="grey">Серая</option>
                      <option value="black">Чёрная</option>
                    </Select>
                  )}
                </Field>
              </div>
            </Group>
            <Group title="Суммы, UZS">
              <MoneyField form={form} name="sumInsured" label="Страховая сумма на одного" error={errors.sumInsured?.message} />
              <MoneyField form={form} name="premiumEmployee" label="Премия за сотрудника" error={errors.premiumEmployee?.message} />
              <MoneyField form={form} name="premiumFamily" label="Премия за члена семьи" error={errors.premiumFamily?.message} />
            </Group>
            <Group title="Количество">
              <div className="grid grid-cols-2 gap-2">
                <CountField form={form} name="employees" label="Сотрудников" error={errors.employees?.message} />
                <CountField form={form} name="familyMembers" label="Членов семей" error={errors.familyMembers?.message} />
              </div>
            </Group>
            <Group title="Сроки и оплата">
              <div className="grid grid-cols-2 gap-2">
                <DateField form={form} name="coverageStart" label="Начало страхования" error={errors.coverageStart?.message} />
                <DateField form={form} name="coverageEnd" label="Окончание" error={errors.coverageEnd?.message} />
              </div>
              <DateField form={form} name="validUntil" label="Предложение действительно до" error={errors.validUntil?.message} />
              <Field label="Условия оплаты">
                {(a) => (
                  <Select {...a} {...form.register('paymentTerms')}>
                    <option value="single">Единовременно</option>
                    <option value="quarterly">Поквартально</option>
                    <option value="monthly">Помесячно</option>
                  </Select>
                )}
              </Field>
            </Group>
          </fieldset>
          <div className="rounded-btn bg-accent-soft px-3 py-2.5" aria-live="polite">
            <div className="text-[12px] text-muted">Общая страховая премия</div>
            <div className="text-[20px] font-bold num" data-testid="kp-total">
              {formatMoney(total)}
            </div>
          </div>
          <p className="rounded-btn bg-rail px-3 py-2 text-[12px] text-muted" data-testid="kp-reference">
            Справочно, в PDF не попадает. Текущий полис:{' '}
            {ref ? `премия ${formatMoney(ref.premium)}, убыточность ${ref.lossRatio === null ? '—' : formatPercent(ref.lossRatio)}` : '…'}
          </p>
        </form>
        <KpPreview frameRef={frame} title={doc.title} html={doc.html} />
      </div>
      <ConfirmDialog
        open={confirmRevoke}
        onOpenChange={setConfirmRevoke}
        title="Отозвать КП?"
        description="HR клиента перестанет видеть это предложение. Отменить отзыв нельзя, но можно создать новую версию."
        confirmLabel="Отозвать"
        danger
        loading={action.isPending}
        onConfirm={() => void revoke()}
      />
    </div>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="text-[12px] font-semibold uppercase tracking-wide text-muted">{title}</div>
      {children}
    </div>
  );
}

type FormApi = ReturnType<typeof useForm<FormIn, unknown, KpParams>>;

function MoneyField({ form, name, label, error }: { form: FormApi; name: 'sumInsured' | 'premiumEmployee' | 'premiumFamily'; label: string; error?: string }) {
  return (
    <Field label={label} error={error}>
      {(a) => (
        <Controller
          control={form.control}
          name={name}
          render={({ field }) => (
            <MaskedInput {...a} mask="money" value={maskMoney(String(field.value ?? ''))} onChange={(v) => field.onChange(parseMoney(v))} onBlur={field.onBlur} />
          )}
        />
      )}
    </Field>
  );
}

function CountField({ form, name, label, error }: { form: FormApi; name: 'employees' | 'familyMembers'; label: string; error?: string }) {
  return (
    <Field label={label} error={error}>
      {(a) => (
        <Controller
          control={form.control}
          name={name}
          render={({ field }) => (
            <Input
              {...a}
              inputMode="numeric"
              autoComplete="off"
              value={String(field.value ?? '')}
              onChange={(e) => field.onChange(parseMoney(e.target.value.slice(0, 7)))}
              onBlur={field.onBlur}
            />
          )}
        />
      )}
    </Field>
  );
}

function DateField({ form, name, label, error }: { form: FormApi; name: 'coverageStart' | 'coverageEnd' | 'validUntil'; label: string; error?: string }) {
  return (
    <Field label={label} error={error}>
      {(a) => (
        <Controller
          control={form.control}
          name={name}
          render={({ field }) => (
            <MaskedInput {...a} mask="date" value={String(field.value ?? '')} onChange={(v) => field.onChange(maskDate(v))} onBlur={field.onBlur} />
          )}
        />
      )}
    </Field>
  );
}
