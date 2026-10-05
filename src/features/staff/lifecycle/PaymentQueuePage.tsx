/*
 * «Ручная разноска»: statement payments the matching rules could not place (no invoice number, several
 * invoices with the same amount, a third-party payer, a partial amount). The accountant splits a payment
 * across invoices; a payer with another INN needs a comment.
 */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { BankPaymentView } from '@/shared/types/dto';
import { useAllocatePayment, useInvoices, usePaymentQueue } from '@/shared/api/queries/lifecycle';
import { errorMessage } from '@/shared/api/client';
import { PAYMENT_CANDIDATE_WHY_LABEL, PAYMENT_QUEUE_REASON_LABEL } from '@/shared/domain/payments';
import { paymentAllocationSchema } from '@/shared/schemas/forms';
import { formatDate, formatDateTime, formatMoney } from '@/shared/lib/format';
import { useDocumentTitle, useUrlFilters } from '@/shared/lib/hooks';
import { Button } from '@/shared/ui/button';
import { Chip } from '@/shared/ui/chips';
import { DataTable, type Column } from '@/shared/ui/data-table';
import { Modal } from '@/shared/ui/dialog';
import { Field, Input, Select, Textarea } from '@/shared/ui/input';
import { PageHeader } from '@/shared/ui/page';
import { toast } from '@/shared/ui/toast';
import { useTopbar } from '../topbar';

interface Row {
  invoiceId: string;
  number: string;
  clientName: string;
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
      setErrors({ comment: 'Плательщик — другой ИНН: укажите комментарий (минимум 5 символов)' });
      return;
    }
    setErrors({});
    try {
      const r = await allocate.mutateAsync({ id: payment.id, ...parsed.data });
      toast.success(
        r.status === 'allocated' ? 'Платёж разнесён' : `Разнесено, остаток ${formatMoney(r.remaining)}`,
      );
      onClose();
    } catch (e) {
      const msg = errorMessage(e);
      if (/комментарий/.test(msg)) setErrors({ comment: msg });
      else toast.error(msg);
    }
  };

  const others = (open.data ?? []).filter((i) => i.contractId && !rows.some((r) => r.invoiceId === i.id));

  return (
    <Modal
      open
      wide
      onOpenChange={(o) => !o && onClose()}
      title="Разнести платёж"
      description={`${formatDate(payment.date)} · ИНН плательщика ${payment.payerInn}${payment.payerName ? ` (${payment.payerName})` : ''} · к разноске ${formatMoney(payment.remaining)}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Отмена
          </Button>
          <Button loading={allocate.isPending} onClick={() => void submit()}>
            Разнести {total > 0 ? formatMoney(total) : ''}
          </Button>
        </>
      }
    >
      <p className="mb-3 rounded-card bg-rail px-3 py-2 text-[13px]">
        <span className="text-muted">Назначение: </span>
        {payment.purpose || '—'}
      </p>
      <fieldset>
        <legend className="mb-1 text-[13px] font-medium">
          {payment.candidates.length
            ? 'Подходящие счета'
            : 'Подходящих счетов не найдено — выберите счёт ниже'}
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
                    aria-label={`Счёт ${r.number}`}
                  />
                  <span className="min-w-0">
                    <span className="num font-medium">{r.number}</span> · {r.clientName}
                    {r.contractNumber && <span className="num text-muted"> · {r.contractNumber}</span>}
                    <span className="block text-[12px] text-muted">
                      Остаток {formatMoney(r.remaining)}
                      {r.hint && ` · совпадение: ${r.hint}`}
                      {other && ' · другой ИНН'}
                    </span>
                  </span>
                </label>
                {on && (
                  <Input
                    aria-label={`Сумма по счёту ${r.number}`}
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
          {rows.length === 0 && <li className="px-3 py-2 text-[13px] text-muted">Нет счетов</li>}
        </ul>
        {errors.lines && <p className="mt-1 text-[12px] text-danger-text">{errors.lines}</p>}
      </fieldset>
      <div className="mt-3 flex items-end gap-2">
        <Field label="Другой неоплаченный счёт" className="flex-1">
          {(a) => (
            <Select {...a} value={extra} onChange={(e) => setExtra(e.target.value)}>
              <option value="">—</option>
              {others.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.number} · {i.clientName} · остаток {formatMoney(i.amount - (i.paid ?? 0))}
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
          Добавить
        </Button>
      </div>
      <Field
        label={foreign ? 'Комментарий (обязательно: плательщик — другой ИНН)' : 'Комментарий'}
        error={errors.comment}
        className="mt-3"
      >
        {(a) => (
          <Textarea
            {...a}
            rows={2}
            maxLength={500}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder={foreign ? 'Например: оплата за клиента по письму от 01.10' : undefined}
          />
        )}
      </Field>
      {total > payment.remaining && (
        <p className="mt-2 text-[12px] text-danger-text">Сумма разноски больше остатка платежа</p>
      )}
      {total > 0 && total < payment.remaining && (
        <p className="mt-2 text-[12px] text-muted">
          Остаток {formatMoney(payment.remaining - total)} останется в очереди
        </p>
      )}
    </Modal>
  );
}

export default function PaymentQueuePage() {
  useDocumentTitle('Ручная разноска');
  useTopbar([{ label: 'Счета и оплаты', to: '/staff/invoices' }, { label: 'Ручная разноска' }]);
  const [f, setF] = useUrlFilters(['status'] as const);
  const status = f.status === 'allocated' ? 'allocated' : 'pending';
  const q = usePaymentQueue(status);
  const [active, setActive] = useState<BankPaymentView | null>(null);

  const columns: Column<BankPaymentView>[] = [
    {
      key: 'date',
      header: 'Дата',
      cell: (b) => (
        <span>
          <span className="num">{formatDate(b.date)}</span>
          {b.docNumber && <span className="num block text-[12px] text-muted">п/п № {b.docNumber}</span>}
        </span>
      ),
    },
    {
      key: 'payer',
      header: 'Плательщик',
      cell: (b) => (
        <span>
          <span className="num">ИНН {b.payerInn || '—'}</span>
          {b.payerName && <span className="block text-[12px] text-muted">{b.payerName}</span>}
        </span>
      ),
    },
    {
      key: 'purpose',
      header: 'Назначение',
      cell: (b) => <span className="line-clamp-2 max-w-88 text-[13px]">{b.purpose || '—'}</span>,
    },
    {
      key: 'amount',
      header: 'Сумма',
      align: 'right',
      cell: (b) => <span className="num whitespace-nowrap">{formatMoney(b.amount)}</span>,
    },
    {
      key: 'rest',
      header: status === 'pending' ? 'К разноске' : 'Разнесено',
      align: 'right',
      cell: (b) => (
        <span className="num whitespace-nowrap">
          {formatMoney(status === 'pending' ? b.remaining : b.allocated)}
        </span>
      ),
    },
    {
      key: 'why',
      header: status === 'pending' ? 'Почему не сопоставлен' : 'Счета',
      cell: (b) =>
        status === 'pending' ? (
          <span>
            <Chip kind="warning">{PAYMENT_QUEUE_REASON_LABEL[b.reason]}</Chip>
            {b.candidates.length > 0 && (
              <span className="block text-[12px] text-muted">Кандидатов: {b.candidates.length}</span>
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
            Разнести
          </Button>
        ) : null,
    },
  ];

  return (
    <>
      <PageHeader
        title="Ручная разноска"
        subtitle="Платежи выписки 1С, которые не удалось сопоставить по номеру счёта в назначении или по ИНН и точной сумме"
        actions={
          <Link className="text-[13px] text-accent-text hover:underline" to="/staff/invoices">
            Счета и оплаты
          </Link>
        }
      />
      <div className="mb-3">
        <Select
          aria-label="Статус"
          className="h-8 w-56"
          value={status}
          onChange={(e) => setF({ status: e.target.value === 'allocated' ? 'allocated' : null })}
        >
          <option value="pending">Ждут разноски</option>
          <option value="allocated">Разнесённые</option>
        </Select>
      </div>
      <div className="rounded-card border border-border bg-surface">
        <DataTable
          caption="Платежи для ручной разноски"
          columns={columns}
          rows={q.data}
          loading={q.isLoading}
          error={q.error}
          onRetry={() => void q.refetch()}
          rowKey={(b) => b.id}
          empty={status === 'pending' ? 'Все платежи разнесены' : 'Разнесённых вручную платежей нет'}
        />
      </div>
      {active && <AllocateDialog payment={active} onClose={() => setActive(null)} />}
    </>
  );
}
