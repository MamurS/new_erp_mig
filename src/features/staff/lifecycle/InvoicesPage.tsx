/* «Счета и оплаты» (LIFECYCLE_SPEC §9): invoices from payment schedules, manual payments and the 1C statement. */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Download } from 'lucide-react';
import type { InvoiceView } from '@/shared/types/dto';
import type { ImportPaymentsResult } from '@/shared/types/dto';
import { useImport1c, useInvoices, useRecordPayment } from '@/shared/api/queries/lifecycle';
import { errorMessage } from '@/shared/api/client';
import { useCan } from '@/shared/auth/guards';
import { INVOICE_STATUS_CHIP, INVOICE_STATUS_LABEL } from '@/shared/domain/contracts';
import { paymentSchema } from '@/shared/schemas/forms';
import { downloadText, toCsv } from '@/shared/lib/csv';
import { formatDate, formatMoney, todayISO } from '@/shared/lib/format';
import { useDocumentTitle, useUrlFilters } from '@/shared/lib/hooks';
import { Button } from '@/shared/ui/button';
import { Chip } from '@/shared/ui/chips';
import { DataTable, type Column } from '@/shared/ui/data-table';
import { Modal } from '@/shared/ui/dialog';
import { Field, Input, Select } from '@/shared/ui/input';
import { PageHeader } from '@/shared/ui/page';
import { toast } from '@/shared/ui/toast';
import { useTopbar } from '../topbar';
import { CsvFileButton } from './common';

function PaymentDialog({ invoice, onClose }: { invoice: InvoiceView; onClose: () => void }) {
  const record = useRecordPayment();
  const rest = invoice.amount - (invoice.paid ?? 0);
  const [amount, setAmount] = useState(String(rest));
  const [paidAt, setPaidAt] = useState(todayISO());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const submit = async () => {
    const parsed = paymentSchema.safeParse({ invoiceId: invoice.id, amount: Number(amount.replace(/\s/g, '')), paidAt });
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [i.path.join('.'), i.message])));
      return;
    }
    try {
      await record.mutateAsync(parsed.data);
      toast.success('Оплата отмечена');
      onClose();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title={`Оплата по счёту ${invoice.number}`}
      description={`${invoice.clientName}. Остаток ${formatMoney(rest)}. Частичная оплата допустима.`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Отмена
          </Button>
          <Button loading={record.isPending} onClick={() => void submit()}>
            Отметить оплату
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Сумма" error={errors.amount}>
          {(a) => <Input {...a} inputMode="numeric" maxLength={14} value={amount} onChange={(e) => setAmount(e.target.value)} />}
        </Field>
        <Field label="Дата оплаты" error={errors.paidAt}>
          {(a) => <Input {...a} type="date" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} />}
        </Field>
      </div>
    </Modal>
  );
}

export default function InvoicesPage() {
  useDocumentTitle('Счета и оплаты');
  useTopbar([{ label: 'Счета и оплаты' }]);
  const [f, setF] = useUrlFilters(['status'] as const);
  const q = useInvoices(f.status ? { status: f.status } : {});
  const canPay = useCan('payments.record');
  const import1c = useImport1c();
  const [pay, setPay] = useState<InvoiceView | null>(null);
  const [result, setResult] = useState<ImportPaymentsResult | null>(null);

  const onStatement = async (csv: string) => {
    try {
      const r = await import1c.mutateAsync(csv);
      setResult(r);
      toast.success(`Загружено ${r.matched + r.queued}, пропущено как повтор ${r.skipped}`);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const columns: Column<InvoiceView>[] = [
    { key: 'num', header: 'Счёт', cell: (i) => <span className="num font-medium">{i.number}</span> },
    { key: 'client', header: 'Клиент', cell: (i) => i.clientName },
    {
      key: 'doc',
      header: 'Основание',
      cell: (i) =>
        i.contractId ? (
          <Link className="num text-accent-text hover:underline" to={i.endorsementId ? `/staff/endorsements/${i.endorsementId}` : `/staff/contracts/${i.contractId}`} onClick={(e) => e.stopPropagation()}>
            {i.endorsementNumber ?? i.contractNumber}
          </Link>
        ) : (
          '—'
        ),
    },
    { key: 'due', header: 'Срок', cell: (i) => <span className="num">{formatDate(i.dueDate)}</span> },
    { key: 'amount', header: 'Сумма', align: 'right', cell: (i) => <span className="num whitespace-nowrap">{formatMoney(i.amount)}</span> },
    { key: 'paid', header: 'Оплачено', align: 'right', cell: (i) => <span className="num whitespace-nowrap">{i.paid ? formatMoney(i.paid) : '—'}</span> },
    { key: 'status', header: 'Статус', cell: (i) => <Chip kind={INVOICE_STATUS_CHIP[i.status]}>{INVOICE_STATUS_LABEL[i.status]}</Chip> },
    {
      key: 'act',
      header: '',
      cell: (i) =>
        canPay && i.status !== 'paid' ? (
          <Button
            size="sm"
            variant="secondary"
            onClick={(e) => {
              e.stopPropagation();
              setPay(i);
            }}
          >
            Оплата
          </Button>
        ) : null,
    },
  ];

  return (
    <>
      <PageHeader
        title="Счета и оплаты"
        subtitle="Счета формируются после подписания по графику платежей. Выписка 1С сопоставляется по номеру счёта в назначении, затем по ИНН и точной сумме; остальное — в ручную разноску"
        actions={
          canPay && (
            <>
              <Button variant="secondary" size="sm" onClick={() => downloadText(toCsv(['doc_number', 'date', 'amount', 'inn', 'purpose', 'payer'], [['1245', '2026-10-01', '1000000', '301234567', 'Оплата по счёту СЧ-2026-002001', 'ООО «Плательщик»']]), 'statement-1c-template.csv')}>
                <Download className="h-3.5 w-3.5" aria-hidden /> Шаблон выписки
              </Button>
              <Button asChild variant="secondary" size="sm">
                <Link to="/staff/invoices/queue">Ручная разноска</Link>
              </Button>
              <CsvFileButton label="Загрузить выписку из 1С" ariaLabel="Файл выписки из 1С" busy={import1c.isPending} maxBytes={1024 * 1024} onText={(t) => void onStatement(t)} />
            </>
          )
        }
      />
      {result && (
        <div className="mb-3 rounded-card border border-border bg-surface px-3 py-2 text-[13px]" data-testid="import-result" role="status">
          Загружено: {result.matched + result.queued}, пропущено как повтор: {result.skipped}. Сопоставлено: {result.matched} · в ручную разноску: {result.queued} · ошибок в строках: {result.unmatched.length} · договоров вступило в силу: {result.activated}
          {result.queued > 0 && (
            <>
              {' '}
              <Link className="text-accent-text hover:underline" to="/staff/invoices/queue">
                Перейти к ручной разноске
              </Link>
            </>
          )}
          {result.unmatched.length > 0 && (
            <ul className="mt-1 list-disc pl-5 text-muted">
              {result.unmatched.slice(0, 10).map((u) => (
                <li key={u.line}>
                  Строка {u.line}: {u.reason}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <div className="mb-3">
        <Select aria-label="Статус" className="h-8 w-56" value={f.status ?? ''} onChange={(e) => setF({ status: e.target.value || null })}>
          <option value="">Все счета</option>
          <option value="unpaid,overdue">Неоплаченные</option>
          <option value="overdue">Просроченные</option>
          <option value="paid">Оплаченные</option>
        </Select>
      </div>
      <div className="rounded-card border border-border bg-surface">
        <DataTable caption="Счета" columns={columns} rows={q.data} loading={q.isLoading} error={q.error} onRetry={() => void q.refetch()} rowKey={(i) => i.id} empty="Счетов нет" />
      </div>
      {pay && <PaymentDialog invoice={pay} onClose={() => setPay(null)} />}
    </>
  );
}
