/* One registry of the clinic: lines with checks, draft editing, submission, disputes, reconciliation act. */
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { z } from 'zod';
import { Download, Send, Sparkles, Trash2 } from 'lucide-react';
import type { AiCheckItem } from '@/shared/types/dto';
import { useAiStatus, useRegistryAiCheck } from '@/shared/api/queries/ai';
import { VERDICT_SHORT } from '@/features/ai/labels';
import type { RegistryLine } from '@/shared/types';
import { registryLineInput } from '@/shared/integration/schemas';
import { useAddRegistryLine, useClinicPriceList, useClinicRegistry, useClinicVisits, useDeleteRegistryLine, useDisputeLine, useSubmitRegistry } from '@/shared/api/queries/clinic';
import { errorMessage } from '@/shared/api/client';
import { REGISTRY_LINE_STATUS_LABEL, REGISTRY_STATUS_CHIP, REGISTRY_STATUS_LABEL } from '@/shared/domain/clinics';
import { downloadText, toCsv } from '@/shared/lib/csv';
import { formatDate, formatDateTime, formatMoney } from '@/shared/lib/format';
import { useDocumentTitle } from '@/shared/lib/hooks';
import { Button } from '@/shared/ui/button';
import { Chip } from '@/shared/ui/chips';
import { DataTable, type Column } from '@/shared/ui/data-table';
import { Modal } from '@/shared/ui/dialog';
import { Field, Input, Select, Textarea } from '@/shared/ui/input';
import { ErrorState, SkeletonRows } from '@/shared/ui/states';
import { toast } from '@/shared/ui/toast';
import { PageTitle, Panel } from '../components';
import { t, tm } from '@/i18n';
import { docNumber } from '@/shared/domain/numbering';

/** Sample guarantee letter number (demo template): the same in every language. */
const GP_NUMBER_EXAMPLE = docNumber('guarantee', { year: new Date().getFullYear(), n: 123 });
const LINE_CHIP = { pending: 'sky', accepted: 'success', rejected: 'danger', disputed: 'warning' } as const;

type LineForm = z.input<typeof registryLineInput>;

function AddLine({ registryId, period }: { registryId: string; period: string }) {
  const visits = useClinicVisits(period);
  const add = useAddRegistryLine();
  const form = useForm<LineForm>({ resolver: zodResolver(registryLineInput), defaultValues: { visitId: '', serviceDate: '', serviceCode: '', icd10: '', quantity: 1, price: 0 } });
  // Prices follow the payer of the patient: its assistance or MIG.
  const prices = useClinicPriceList(form.watch('visitId') || undefined);
  const e = form.formState.errors;
  const submit = form.handleSubmit(async (line) => {
    try {
      await add.mutateAsync({ id: registryId, line: { ...line, guaranteeNumber: line.guaranteeNumber || undefined } });
      toast.success(t('clinic.registry.lineAdded'));
      form.reset({ visitId: '', serviceDate: '', serviceCode: '', icd10: '', quantity: 1, price: 0 });
    } catch (err) {
      toast.error(errorMessage(err));
    }
  });
  return (
    <form className="grid gap-2 p-4 md:grid-cols-4" onSubmit={(ev) => void submit(ev)} noValidate aria-label={t('clinic.registry.addLine')}>
      <Field label={t('clinic.visit.title')} error={tm(e.visitId?.message)} className="md:col-span-2">
        {(a) => (
          <Select
            {...a}
            {...form.register('visitId', {
              onChange: (ev: { target: { value: string } }) => {
                const v = visits.data?.find((x) => x.id === ev.target.value);
                if (v) form.setValue('serviceDate', v.openedAt.slice(0, 10));
              },
            })}
          >
            <option value="">{t('clinic.registry.pickVisit')}</option>
            {(visits.data ?? []).map((v) => (
              <option key={v.id} value={v.id}>
                {formatDate(v.openedAt)} · {v.insuredName}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field label={t('common.service')} error={tm(e.serviceCode?.message)} className="md:col-span-2">
        {(a) => (
          <Select
            {...a}
            {...form.register('serviceCode', {
              onChange: (ev: { target: { value: string } }) => {
                const p = prices.data?.find((x) => x.code === ev.target.value);
                if (p) form.setValue('price', p.price);
              },
            })}
          >
            <option value="">{t('clinic.gpRequest.pickService')}</option>
            {(prices.data ?? []).map((p) => (
              <option key={p.code} value={p.code}>
                {p.code} · {p.name}
                {p.requiresGuarantee ? t('clinic.gpRequest.needsGp') : ''}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field label={t('clinic.registry.serviceDate')} error={tm(e.serviceDate?.message)}>
        {(a) => <Input {...a} type="date" {...form.register('serviceDate')} />}
      </Field>
      <Field label={t('clinic.gp.icd10')} error={tm(e.icd10?.message)}>
        {(a) => <Input {...a} maxLength={8} {...form.register('icd10')} />}
      </Field>
      <Field label={t('clinic.registry.quantity')} error={tm(e.quantity?.message)}>
        {(a) => <Input {...a} inputMode="numeric" {...form.register('quantity', { valueAsNumber: true })} />}
      </Field>
      <Field label={t('clinic.registry.priceUzs')} error={tm(e.price?.message)}>
        {(a) => <Input {...a} inputMode="numeric" {...form.register('price', { setValueAs: (v: string | number) => Number(String(v).replace(/\s/g, '')) })} />}
      </Field>
      <Field label={t('clinic.registry.gpNumber')} error={tm(e.guaranteeNumber?.message)} className="md:col-span-2">
        {(a) => <Input {...a} placeholder={GP_NUMBER_EXAMPLE} maxLength={60} {...form.register('guaranteeNumber', { setValueAs: (v: string) => v.trim() || undefined })} />}
      </Field>
      <div className="flex items-end md:col-span-2">
        <Button type="submit" variant="secondary" loading={add.isPending}>
          {t('clinic.registry.addLine')}
        </Button>
      </div>
    </form>
  );
}

function DisputeDialog({ registryId, line, onClose }: { registryId: string; line: RegistryLine; onClose: () => void }) {
  const dispute = useDisputeLine();
  const [comment, setComment] = useState('');
  const [touched, setTouched] = useState(false);
  const send = async () => {
    setTouched(true);
    if (comment.trim().length < 3) return;
    try {
      await dispute.mutateAsync({ id: registryId, lineId: line.id, comment: comment.trim() });
      toast.success(t('clinic.registry.disputed'));
      onClose();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('clinic.registry.disputeTitle')}
      description={t('clinic.registry.disputeDescription', { service: line.serviceName, amount: formatMoney(line.amount), reason: line.rejectionReason ?? '—' })}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button loading={dispute.isPending} onClick={() => void send()}>
            {t('clinic.registry.dispute')}
          </Button>
        </>
      }
    >
      <Field label={t('clinic.registry.commentForMig')} error={touched && comment.trim().length < 3 ? t('clinic.registry.min3') : undefined}>
        {(a) => <Textarea {...a} rows={3} maxLength={1000} value={comment} onChange={(e) => setComment(e.target.value)} />}
      </Field>
    </Modal>
  );
}

/** A line is at risk when the coverage check does not expect it to be paid as is. */
function risky(x: AiCheckItem): boolean {
  return x.needsSpecialist || !['covered', 'needs_guarantee'].includes(x.verdict.decision);
}

export default function RegistryPage() {
  useDocumentTitle(t('clinic.registry.docTitle'));
  const { registryId = '' } = useParams();
  const q = useClinicRegistry(registryId);
  const submit = useSubmitRegistry();
  const del = useDeleteRegistryLine();
  const [disputing, setDisputing] = useState<RegistryLine | null>(null);
  // «Проверить строки» (AI_COVERAGE_SPEC §4.2): lines likely to be rejected are highlighted; sending is still allowed.
  const aiStatus = useAiStatus();
  const aiCheck = useRegistryAiCheck();
  const [aiLines, setAiLines] = useState<Record<string, AiCheckItem>>({});

  if (q.isLoading) return <SkeletonRows rows={8} />;
  if (q.isError || !q.data) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const r = q.data;
  const draft = r.status === 'draft';
  const problemCount = Object.keys(r.problems).length;

  const doSubmit = async () => {
    try {
      await submit.mutateAsync(r.id);
      toast.success(t('clinic.registry.submitted'));
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  const act = () => {
    const rows = r.lines.map((l) => [l.serviceDate, l.serviceCode, l.serviceName, l.icd10, l.quantity, l.price, l.amount, l.guaranteeNumber ?? '', REGISTRY_LINE_STATUS_LABEL[l.status], l.rejectionReason ?? '']);
    rows.push([t('common.total'), '', '', '', '', '', r.totals.claimed, '', t('clinic.registry.actTotals', { accepted: r.totals.accepted, rejected: r.totals.rejected, paid: r.totals.paid }), r.paidAt ? formatDate(r.paidAt) : '']);
    downloadText(toCsv([t('common.date'), t('clinic.docsPage.code'), t('common.service'), t('clinic.gp.icd10'), t('clinic.registry.qty'), t('clinic.docsPage.price'), t('common.amount'), t('clinic.registry.gp'), t('common.status'), t('common.reason')], rows), `reconciliation-act-${r.period}.csv`);
  };

  const columns: Column<RegistryLine>[] = [
    { key: 'date', header: t('common.date'), cell: (l) => <span className="num whitespace-nowrap">{formatDate(l.serviceDate)}</span> },
    { key: 'who', header: t('common.patient'), cell: (l) => l.insuredName },
    { key: 'svc', header: t('common.service'), cell: (l) => <span>{l.serviceCode} · {l.serviceName}</span> },
    { key: 'icd', header: t('clinic.gp.icd10'), cell: (l) => <span className="num">{l.icd10}</span> },
    { key: 'qty', header: t('clinic.registry.qty'), align: 'right', cell: (l) => <span className="num">{l.quantity}</span> },
    { key: 'amount', header: t('common.amount'), align: 'right', cell: (l) => <span className="num whitespace-nowrap">{formatMoney(l.amount)}</span> },
    { key: 'gp', header: t('clinic.registry.gp'), cell: (l) => <span className="num text-muted">{l.guaranteeNumber ?? '—'}</span> },
    { key: 'payer', header: t('clinic.registry.payer'), cell: (l) => <span data-testid="line-payer">{r.payerNames?.[l.payer ?? 'mig'] ?? t('common.mig')}</span> },
    {
      key: 'status',
      header: t('common.status'),
      cell: (l) => (
        <span className="flex flex-col gap-0.5">
          {aiLines[l.id] && risky(aiLines[l.id]!) && (
            <span className="rounded-btn bg-warning-soft px-1.5 py-0.5 text-[12px] text-warning-text" data-testid="line-ai-risk">
              {aiLines[l.id]!.clauses[0]
                ? t('clinic.registry.aiRiskClause', { verdict: VERDICT_SHORT[aiLines[l.id]!.needsSpecialist ? 'unknown' : aiLines[l.id]!.verdict.decision], clause: aiLines[l.id]!.clauses[0]!.label })
                : t('clinic.registry.aiRisk', { verdict: VERDICT_SHORT[aiLines[l.id]!.needsSpecialist ? 'unknown' : aiLines[l.id]!.verdict.decision] })}
            </span>
          )}
          {draft ? (
            r.problems[l.id] ? (
              <span className="text-[12px] text-danger-text" data-testid="line-problem">
                {r.problems[l.id]!.map((p) => tm(p)).join('; ')}
              </span>
            ) : (
              <Chip kind="success">{t('clinic.registry.checksPassed')}</Chip>
            )
          ) : (
            <Chip kind={LINE_CHIP[l.status]}>{REGISTRY_LINE_STATUS_LABEL[l.status]}</Chip>
          )}
          {l.rejectionReason && <span className="text-[12px] text-muted">{l.rejectionReason}</span>}
          {l.disputeComment && <span className="text-[12px] text-muted">{t('clinic.registry.disputedComment', { comment: l.disputeComment })}</span>}
          {l.payment && (
            <span className="text-[12px] text-success-text" data-testid="line-payment">
              {l.payer && l.payer !== 'mig'
                ? t('clinic.registry.paidByAssist', { name: r.payerNames?.[l.payer] ?? '', date: formatDate(l.payment.paidAt) })
                : t('clinic.registry.paidByMig', { date: formatDate(l.payment.paidAt) })}
            </span>
          )}
        </span>
      ),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      cell: (l) =>
        draft ? (
          <Button size="sm" variant="ghost" aria-label={t('clinic.registry.deleteLine', { name: l.serviceName })} onClick={() => void del.mutateAsync({ id: r.id, lineId: l.id }).catch((e: unknown) => toast.error(errorMessage(e)))}>
            <Trash2 className="h-3.5 w-3.5" aria-hidden />
          </Button>
        ) : l.status === 'rejected' && r.status !== 'paid' ? (
          <Button size="sm" variant="secondary" onClick={() => setDisputing(l)}>
            {t('clinic.registry.dispute')}
          </Button>
        ) : null,
    },
  ];

  return (
    <>
      <PageTitle
        title={t('clinic.registry.title', { period: r.period })}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <Link to="/clinic/registries" className="text-accent-text hover:underline">
              {t('clinic.registry.back')}
            </Link>
            <span data-testid="registry-status">
              <Chip kind={REGISTRY_STATUS_CHIP[r.status]}>{REGISTRY_STATUS_LABEL[r.status]}</Chip>
            </span>
            {r.submittedAt && <span className="text-[12px]">{t('clinic.registry.submittedAt', { at: formatDateTime(r.submittedAt) })}</span>}
          </span>
        }
        actions={
          <>
            {!draft && (
              <Button variant="secondary" onClick={act}>
                <Download className="h-4 w-4" aria-hidden /> {t('clinic.registry.actCsv')}
              </Button>
            )}
            {draft && !!aiStatus.data?.scenarios.clinic && r.lines.length > 0 && (
              <Button
                variant="secondary"
                loading={aiCheck.isPending}
                onClick={() =>
                  void aiCheck
                    .mutateAsync(r.id)
                    .then((res) => {
                      setAiLines(Object.fromEntries(res.items.filter((x) => x.subjectId).map((x) => [x.subjectId!, x])));
                      const n = res.items.filter(risky).length;
                      toast.success(n ? t('clinic.registry.aiRiskCount', { n }) : t('clinic.registry.aiAllOk'));
                    })
                    .catch((e: unknown) => toast.error(errorMessage(e)))
                }
              >
                <Sparkles className="h-4 w-4" aria-hidden /> {t('clinic.registry.aiCheck')}
              </Button>
            )}
            {draft && (
              <Button disabled={problemCount > 0 || r.lines.length === 0} loading={submit.isPending} onClick={() => void doSubmit()}>
                <Send className="h-4 w-4" aria-hidden /> {t('clinic.registry.submit')}
              </Button>
            )}
          </>
        }
      />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-5" data-testid="registry-totals">
        {[
          [t('clinic.docsPage.csvClaimed'), formatMoney(r.totals.claimed)],
          [t('clinic.docsPage.csvAccepted'), formatMoney(r.totals.accepted)],
          [t('clinic.registry.rejected'), formatMoney(r.totals.rejected)],
          [t('clinic.docsPage.csvPaid'), formatMoney(r.totals.paid)],
          [t('clinic.docsPage.csvPaidAt'), r.paidAt ? formatDate(r.paidAt) : '—'],
        ].map(([label, value]) => (
          <div key={label} className="rounded-card border border-border bg-surface p-3">
            <div className="text-[12px] text-muted">{label}</div>
            <div className="num font-semibold">{value}</div>
          </div>
        ))}
      </div>
      {draft && problemCount > 0 && (
        <p role="alert" className="mb-3 rounded-card bg-danger-soft px-4 py-2 text-danger-text">
          {t('clinic.registry.problems', { n: problemCount })}
        </p>
      )}
      <Panel>
        <DataTable caption={t('clinic.registry.caption')} columns={columns} rows={r.lines} rowKey={(l) => l.id} />
      </Panel>
      {draft && (
        <Panel title={t('clinic.registry.addLine')} className="mt-4">
          <AddLine registryId={r.id} period={r.period} />
        </Panel>
      )}
      {disputing && <DisputeDialog registryId={r.id} line={disputing} onClose={() => setDisputing(null)} />}
    </>
  );
}
