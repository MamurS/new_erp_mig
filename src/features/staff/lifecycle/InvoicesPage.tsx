/* «Счета и оплаты» (LIFECYCLE_SPEC §9): invoices from payment schedules, manual payments and the 1C statement. */
import { t, tm } from '@/i18n';
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
      toast.success(t('staffLc.invoices.paymentRecorded'));
      onClose();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('staffLc.invoices.paymentTitle', { number: invoice.number })}
      description={t('staffLc.invoices.paymentDesc', { client: invoice.clientName, rest: formatMoney(rest) })}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button loading={record.isPending} onClick={() => void submit()}>
            {t('staffLc.invoices.recordPayment')}
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t('common.amount')} error={tm(errors.amount) || undefined}>
          {(a) => <Input {...a} inputMode="numeric" maxLength={14} value={amount} onChange={(e) => setAmount(e.target.value)} />}
        </Field>
        <Field label={t('staffLc.invoices.paidAt')} error={tm(errors.paidAt) || undefined}>
          {(a) => <Input {...a} type="date" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} />}
        </Field>
      </div>
    </Modal>
  );
}

export default function InvoicesPage() {
  useDocumentTitle(t('staffLc.invoices.title'));
  useTopbar([{ label: t('staffLc.invoices.title') }]);
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
      toast.success(t('staffLc.invoices.importToast', { loaded: r.matched + r.queued, skipped: r.skipped }));
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const columns: Column<InvoiceView>[] = [
    { key: 'num', header: t('staffLc.contract.invoice'), cell: (i) => <span className="num font-medium">{i.number}</span> },
    { key: 'client', header: t('common.client'), cell: (i) => i.clientName },
    {
      key: 'doc',
      header: t('staffLc.invoices.basis'),
      cell: (i) =>
        i.contractId ? (
          <Link className="num text-accent-text hover:underline" to={i.endorsementId ? `/staff/endorsements/${i.endorsementId}` : `/staff/contracts/${i.contractId}`} onClick={(e) => e.stopPropagation()}>
            {i.endorsementNumber ?? i.contractNumber}
          </Link>
        ) : (
          '—'
        ),
    },
    { key: 'due', header: t('staffLc.contract.due'), cell: (i) => <span className="num">{formatDate(i.dueDate)}</span> },
    { key: 'amount', header: t('common.amount'), align: 'right', cell: (i) => <span className="num whitespace-nowrap">{formatMoney(i.amount)}</span> },
    { key: 'paid', header: t('staffLc.invoices.paid'), align: 'right', cell: (i) => <span className="num whitespace-nowrap">{i.paid ? formatMoney(i.paid) : '—'}</span> },
    { key: 'status', header: t('common.status'), cell: (i) => <Chip kind={INVOICE_STATUS_CHIP[i.status]}>{INVOICE_STATUS_LABEL[i.status]}</Chip> },
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
            {t('staffLc.invoices.payment')}
          </Button>
        ) : null,
    },
  ];

  return (
    <>
      <PageHeader
        title={t('staffLc.invoices.title')}
        subtitle={t('staffLc.invoices.subtitle')}
        actions={
          canPay && (
            <>
              {/* eslint-disable-next-line mig/no-cyrillic-ui -- sample row of a 1C bank statement file (data, not UI) */}
              <Button variant="secondary" size="sm" onClick={() => downloadText(toCsv(['doc_number', 'date', 'amount', 'inn', 'purpose', 'payer'], [['1245', '2026-10-01', '1000000', '301234567', 'Оплата по счёту СЧ-2026-002001', 'ООО «Плательщик»']]), 'statement-1c-template.csv')}>
                <Download className="h-3.5 w-3.5" aria-hidden /> {t('staffLc.invoices.statementTemplate')}
              </Button>
              <Button asChild variant="secondary" size="sm">
                <Link to="/staff/invoices/queue">{t('staffLc.invoices.manualMatching')}</Link>
              </Button>
              <CsvFileButton label={t('staffLc.invoices.uploadStatement')} ariaLabel={t('staffLc.invoices.statementFile')} busy={import1c.isPending} maxBytes={1024 * 1024} onText={(text) => void onStatement(text)} />
            </>
          )
        }
      />
      {result && (
        <div className="mb-3 rounded-card border border-border bg-surface px-3 py-2 text-[13px]" data-testid="import-result" role="status">
          {t('staffLc.invoices.importResult', { loaded: result.matched + result.queued, skipped: result.skipped, matched: result.matched, queued: result.queued, errors: result.unmatched.length, activated: result.activated })}
          {result.queued > 0 && (
            <>
              {' '}
              <Link className="text-accent-text hover:underline" to="/staff/invoices/queue">
                {t('staffLc.invoices.goToMatching')}
              </Link>
            </>
          )}
          {result.unmatched.length > 0 && (
            <ul className="mt-1 list-disc pl-5 text-muted">
              {result.unmatched.slice(0, 10).map((u) => (
                <li key={u.line}>
                  {t('staffLc.census.rowError', { row: u.line, message: tm(u.reason) })}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <div className="mb-3">
        <Select aria-label={t('common.status')} className="h-8 w-56" value={f.status ?? ''} onChange={(e) => setF({ status: e.target.value || null })}>
          <option value="">{t('staffLc.invoices.all')}</option>
          <option value="unpaid,overdue">{t('staffLc.invoices.unpaid')}</option>
          <option value="overdue">{t('staffLc.invoices.overdue')}</option>
          <option value="paid">{t('staffLc.invoices.paidFilter')}</option>
        </Select>
      </div>
      <div className="rounded-card border border-border bg-surface">
        <DataTable caption={t('staffLc.contract.invoices')} columns={columns} rows={q.data} loading={q.isLoading} error={q.error} onRetry={() => void q.refetch()} rowKey={(i) => i.id} empty={t('staffLc.invoices.empty')} />
      </div>
      {pay && <PaymentDialog invoice={pay} onClose={() => setPay(null)} />}
    </>
  );
}
