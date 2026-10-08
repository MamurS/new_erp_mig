/*
 * «Ручная разноска»: statement payments the matching rules could not place (no invoice number, several
 * invoices with the same amount, a third-party payer, a partial amount). The accountant splits a payment
 * across invoices; a payer with another INN needs a comment.
 */
import { msg, t, tm } from '@/i18n';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { BankPaymentView } from '@mig/contracts/dto';
import { useAllocatePayment, useInvoices, usePaymentQueue } from '@/shared/api/queries/lifecycle';
import { ApiRequestError, errorMessage } from '@/shared/api/client';
import { PAYMENT_CANDIDATE_WHY_LABEL, PAYMENT_QUEUE_REASON_LABEL } from '@mig/domain/payments';
import { paymentAllocationSchema } from '@mig/contracts/forms';
import { formatDate, formatDateTime, formatMoney } from '@mig/domain/lib/format';
import { useDocumentTitle, useUrlFilters } from '@/shared/lib/hooks';
import { Button } from '@/shared/ui/button';
import { Chip } from '@/shared/ui/chips';
import { DataTable, formatSort, parseSort, type Column } from '@/shared/ui/data-table';
import { LegalFormChip, formatLegalForms, legalFormColumn, parseLegalForms } from '@/shared/ui/legal-form';
import type { LegalFormCode } from '@mig/domain/config/legalForms';
import { Modal } from '@/shared/ui/dialog';
import { Field, Input, Select, Textarea } from '@/shared/ui/input';
import { PageHeader } from '@/shared/ui/page';
import { toast } from '@/shared/ui/toast';
import { useTopbar } from '../topbar';

interface Row {
  invoiceId: string;
  number: string;
  clientName: string;
  clientLegalForm?: LegalFormCode;
  clientInn?: string;
  contractNumber?: string;
  remaining: number;
  hint?: string;
}

const parseMoney = (s: string) => Number(s.replace(/\s/g, ''));

function AllocateDialog({ payment, onClose }: { payment: BankPaymentView; onClose: () => void }) {
  const allocate = useAllocatePayment();
  const open = useInvoices({ status: 'unpaid,overdue' });
  const [picked, setPicked] = useState<Record<string, string>>(() => {
    // A single candidate is preselected with what fits.
    const only = payment.candidates.length === 1 ? payment.candidates[0] : undefined;
    return only ? { [only.invoiceId]: String(Math.min(only.remaining, payment.remaining)) } : {};
  });
  const [extra, setExtra] = useState('');
  const [comment, setComment] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  const rows: Row[] = useMemo(() => {
    const out: Row[] = payment.candidates.map((c) => ({ ...c, hint: PAYMENT_CANDIDATE_WHY_LABEL[c.why] }));
    for (const id of Object.keys(picked)) {
      if (out.some((r) => r.invoiceId === id)) continue;
      const i = open.data?.find((x) => x.id === id);
      if (i)
        out.push({
          invoiceId: i.id,
          number: i.number,
          clientName: i.clientName,
          clientLegalForm: i.clientLegalForm,
          clientInn: i.clientInn,
          contractNumber: i.endorsementNumber ?? i.contractNumber,
          remaining: i.amount - (i.paid ?? 0),
        });
    }
    return out;
  }, [payment.candidates, picked, open.data]);

  const lines = Object.entries(picked).map(([invoiceId, amount]) => ({
    invoiceId,
    amount: parseMoney(amount),
  }));
  const total = lines.reduce((s, l) => s + (Number.isFinite(l.amount) ? l.amount : 0), 0);
  const foreign = rows.some(
    (r) => picked[r.invoiceId] !== undefined && r.clientInn !== undefined && r.clientInn !== payment.payerInn,
  );

  const toggle = (r: Row, on: boolean) =>
    setPicked((p) => {
      const next = { ...p };
      if (on) next[r.invoiceId] = String(Math.max(0, Math.min(r.remaining, payment.remaining - total)));
      else delete next[r.invoiceId];
      return next;
    });

  const submit = async () => {
    const parsed = paymentAllocationSchema.safeParse({ lines, comment: comment.trim() || undefined });
    if (!parsed.success) {
      setErrors(
        Object.fromEntries(
          parsed.error.issues.map((i) => [i.path[0] === 'lines' ? 'lines' : i.path.join('.'), i.message]),
        ),
      );
      return;
    }
    if (foreign && (parsed.data.comment ?? '').length < 5) {
      setErrors({ comment: msg('staffLc.queue.foreignComment') });
      return;
    }
    setErrors({});
    try {
      const r = await allocate.mutateAsync({ id: payment.id, ...parsed.data });
      toast.success(
        r.status === 'allocated' ? t('staffLc.queue.allocated') : t('staffLc.queue.partlyAllocated', { rest: formatMoney(r.remaining) }),
      );
      onClose();
    } catch (e) {
      if (e instanceof ApiRequestError && e.fields?.comment) setErrors({ comment: e.fields.comment });
      else toast.error(errorMessage(e));
    }
  };

  const others = (open.data ?? []).filter((i) => i.contractId && !rows.some((r) => r.invoiceId === i.id));

  return (
    <Modal
      open
      wide
      onOpenChange={(o) => !o && onClose()}
      title={t('staffLc.queue.allocateTitle')}
      description={
        payment.payerName
          ? t('staffLc.queue.allocateDescNamed', { date: formatDate(payment.date), inn: payment.payerInn, name: payment.payerName, rest: formatMoney(payment.remaining) })
          : t('staffLc.queue.allocateDesc', { date: formatDate(payment.date), inn: payment.payerInn, rest: formatMoney(payment.remaining) })
      }
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button loading={allocate.isPending} onClick={() => void submit()}>
            {total > 0 ? t('staffLc.queue.allocateAmount', { amount: formatMoney(total) }) : t('staffLc.queue.allocate')}
          </Button>
        </>
      }
    >
      <p className="mb-3 rounded-card bg-rail px-3 py-2 text-[13px]">
        <span className="text-muted">{t('staffLc.queue.purposeLabel')} </span>
        {payment.purpose || '—'}
      </p>
      <fieldset>
        <legend className="mb-1 text-[13px] font-medium">
          {payment.candidates.length
            ? t('staffLc.queue.candidates')
            : t('staffLc.queue.noCandidates')}
        </legend>
        <ul
          className="divide-y divide-border rounded-card border border-border"
          data-testid="allocation-rows"
        >
          {rows.map((r) => {
            const on = picked[r.invoiceId] !== undefined;
            const other = r.clientInn !== undefined && r.clientInn !== payment.payerInn;
            return (
              <li
                key={r.invoiceId}
                className="flex flex-wrap items-center gap-2 px-3 py-2 text-[13px]"
                data-testid="allocation-row"
              >
                <label className="flex min-w-0 flex-1 items-center gap-2">
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={(e) => toggle(r, e.target.checked)}
                    aria-label={t('staffLc.queue.invoiceAria', { number: r.number })}
                  />
                  <span className="min-w-0">
                    <span className="num font-medium">{r.number}</span> · {r.clientName} <LegalFormChip code={r.clientLegalForm} />
                    {r.contractNumber && <span className="num text-muted"> · {r.contractNumber}</span>}
                    <span className="block text-[12px] text-muted">
                      {t('staffLc.queue.remaining', { amount: formatMoney(r.remaining) })}
                      {r.hint && t('staffLc.queue.matchHint', { hint: r.hint })}
                      {other && t('staffLc.queue.otherInn')}
                    </span>
                  </span>
                </label>
                {on && (
                  <Input
                    aria-label={t('staffLc.queue.amountAria', { number: r.number })}
                    className="h-8 w-36"
                    inputMode="numeric"
                    maxLength={14}
                    value={picked[r.invoiceId]}
                    onChange={(e) => setPicked((p) => ({ ...p, [r.invoiceId]: e.target.value }))}
                  />
                )}
              </li>
            );
          })}
          {rows.length === 0 && <li className="px-3 py-2 text-[13px] text-muted">{t('staffLc.queue.noInvoices')}</li>}
        </ul>
        {errors.lines && <p className="mt-1 text-[12px] text-danger-text">{tm(errors.lines)}</p>}
      </fieldset>
      <div className="mt-3 flex items-end gap-2">
        <Field label={t('staffLc.queue.otherInvoice')} className="flex-1">
          {(a) => (
            <Select {...a} value={extra} onChange={(e) => setExtra(e.target.value)}>
              <option value="">—</option>
              {others.map((i) => (
                <option key={i.id} value={i.id}>
                  {t('staffLc.queue.otherOption', { number: i.number, client: i.clientName, rest: formatMoney(i.amount - (i.paid ?? 0)) })}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Button
          variant="secondary"
          disabled={!extra}
          onClick={() => {
            const i = open.data?.find((x) => x.id === extra);
            if (i)
              setPicked((p) => ({
                ...p,
                [i.id]: String(Math.max(0, Math.min(i.amount - (i.paid ?? 0), payment.remaining - total))),
              }));
            setExtra('');
          }}
        >
          {t('common.add')}
        </Button>
      </div>
      <Field
        label={foreign ? t('staffLc.queue.commentRequired') : t('common.comment')}
        error={tm(errors.comment) || undefined}
        className="mt-3"
      >
        {(a) => (
          <Textarea
            {...a}
            rows={2}
            maxLength={500}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder={foreign ? t('staffLc.queue.commentPlaceholder') : undefined}
          />
        )}
      </Field>
      {total > payment.remaining && (
        <p className="mt-2 text-[12px] text-danger-text">{t('staffLc.queue.overAllocated')}</p>
      )}
      {total > 0 && total < payment.remaining && (
        <p className="mt-2 text-[12px] text-muted">
          {t('staffLc.queue.restStays', { amount: formatMoney(payment.remaining - total) })}
        </p>
      )}
    </Modal>
  );
}

export default function PaymentQueuePage() {
  useDocumentTitle(t('staffLc.invoices.manualMatching'));
  useTopbar([{ label: t('staffLc.invoices.title'), to: '/staff/invoices' }, { label: t('staffLc.invoices.manualMatching') }]);
  const [f, setF] = useUrlFilters(['status', 'form', 'sort'] as const);
  const status = f.status === 'allocated' ? 'allocated' : 'pending';
  const forms = parseLegalForms(f.form);
  const sort = parseSort(f.sort);
  const q = usePaymentQueue(status, {
    ...(forms.length ? { form: forms.join(',') } : {}),
    ...(sort ? { sort: `${sort.key}:${sort.dir}` } : {}),
  });
  const [active, setActive] = useState<BankPaymentView | null>(null);

  const columns: Column<BankPaymentView>[] = [
    {
      key: 'date',
      header: t('common.date'),
      sortKey: 'date',
      cell: (b) => (
        <span>
          <span className="num">{formatDate(b.date)}</span>
          {b.docNumber && <span className="num block text-[12px] text-muted">{t('staffLc.queue.docNumber', { number: b.docNumber })}</span>}
        </span>
      ),
    },
    {
      key: 'payer',
      header: t('staffLc.queue.payer'),
      sortKey: 'payerName',
      cell: (b) => (
        <span>
          {b.payerName && <span className="block">{b.payerName}</span>}
          <span className="num block text-[12px] text-muted">{t('staffLc.queue.inn', { inn: b.payerInn || '—' })}</span>
        </span>
      ),
    },
    legalFormColumn<BankPaymentView>((b) => b.payerLegalForm, { selected: forms, onChange: (v) => setF({ form: formatLegalForms(v) }) }),
    {
      key: 'purpose',
      header: t('staffLc.queue.purpose'),
      cell: (b) => <span className="line-clamp-2 max-w-88 text-[13px]">{b.purpose || '—'}</span>,
    },
    {
      key: 'amount',
      header: t('common.amount'),
      sortKey: 'amount',
      align: 'right',
      cell: (b) => <span className="num whitespace-nowrap">{formatMoney(b.amount)}</span>,
    },
    {
      key: 'rest',
      header: status === 'pending' ? t('staffLc.queue.toAllocate') : t('staffLc.queue.allocatedCol'),
      align: 'right',
      cell: (b) => (
        <span className="num whitespace-nowrap">
          {formatMoney(status === 'pending' ? b.remaining : b.allocated)}
        </span>
      ),
    },
    {
      key: 'why',
      header: status === 'pending' ? t('staffLc.queue.whyUnmatched') : t('staffLc.contract.invoices'),
      cell: (b) =>
        status === 'pending' ? (
          <span>
            <Chip kind="warning">{PAYMENT_QUEUE_REASON_LABEL[b.reason]}</Chip>
            {b.candidates.length > 0 && (
              <span className="block text-[12px] text-muted">{t('staffLc.queue.candidatesCount', { n: b.candidates.length })}</span>
            )}
          </span>
        ) : (
          <span className="text-[12px]">
            {b.allocations.map((a) => (
              <span key={`${a.invoiceId}-${a.at}`} className="block">
                <span className="num">{a.invoiceNumber}</span> · {formatMoney(a.amount)} · {a.byName},{' '}
                {formatDateTime(a.at)}
                {a.comment && <span className="block text-muted">«{a.comment}»</span>}
              </span>
            ))}
          </span>
        ),
    },
    {
      key: 'act',
      header: '',
      cell: (b) =>
        status === 'pending' ? (
          <Button
            size="sm"
            variant="secondary"
            onClick={(e) => {
              e.stopPropagation();
              setActive(b);
            }}
          >
            {t('staffLc.queue.allocate')}
          </Button>
        ) : null,
    },
  ];

  return (
    <>
      <PageHeader
        title={t('staffLc.invoices.manualMatching')}
        subtitle={t('staffLc.queue.subtitle')}
        actions={
          <Link className="text-[13px] text-accent-text hover:underline" to="/staff/invoices">
            {t('staffLc.invoices.title')}
          </Link>
        }
      />
      <div className="mb-3">
        <Select
          aria-label={t('common.status')}
          className="h-8 w-56"
          value={status}
          onChange={(e) => setF({ status: e.target.value === 'allocated' ? 'allocated' : null })}
        >
          <option value="pending">{t('staffLc.queue.pending')}</option>
          <option value="allocated">{t('staffLc.queue.allocatedFilter')}</option>
        </Select>
      </div>
      <div className="rounded-card border border-border bg-surface">
        <DataTable
          caption={t('staffLc.queue.caption')}
          columns={columns}
          rows={q.data}
          sort={sort}
          onSortChange={(s) => setF({ sort: formatSort(s) })}
          loading={q.isLoading}
          error={q.error}
          onRetry={() => void q.refetch()}
          rowKey={(b) => b.id}
          empty={status === 'pending' ? t('staffLc.queue.emptyPending') : t('staffLc.queue.emptyAllocated')}
        />
      </div>
      {active && <AllocateDialog payment={active} onClose={() => setActive(null)} />}
    </>
  );
}
