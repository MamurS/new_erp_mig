import { Link } from 'react-router-dom';
import { Download, FileText } from 'lucide-react';
import type { ClientDocument, Invoice } from '@/shared/types';
import { useHrDocuments, useHrInvoices, useHrOverview } from '@/shared/api/queries/hr';
import { formatDate, formatMoney, formatRelativeDays } from '@/shared/lib/format';
import { useDocumentTitle } from '@/shared/lib/hooks';
import { Button } from '@/shared/ui/button';
import { Chip } from '@/shared/ui/chips';
import { DataTable, type Column } from '@/shared/ui/data-table';
import { EmptyState, QueryState, SkeletonRows } from '@/shared/ui/states';
import { toast } from '@/shared/ui/toast';
import { KpDownloadButton } from '@/features/kp/KpDownloadButton';
import { documentPdf, downloadPdf, invoicePdf, pdfFileName } from '../pdf';
import { HR_BTN, HrCard, HrHeader, HrSectionTitle } from '../ui';

const INVOICE_STATUS: Record<Invoice['status'], { label: string; kind: string }> = {
  unpaid: { label: 'Ожидает оплаты', kind: 'sun' },
  paid: { label: 'Оплачен', kind: 'success' },
  overdue: { label: 'Просрочен', kind: 'danger' },
};

const DOC_KIND: Record<ClientDocument['kind'], string> = {
  policy: 'Полис',
  contract: 'Договор',
  invoice: 'Счёт',
  act: 'Акт',
  program: 'Программа',
  kp: 'Коммерческое предложение',
};

export default function DocumentsPage() {
  useDocumentTitle('Счета и документы');
  const invoices = useHrInvoices();
  const documents = useHrDocuments();
  const company = useHrOverview().data?.companyName;

  const downloadInvoice = (inv: Invoice) => {
    downloadPdf(invoicePdf(inv, company), pdfFileName('invoice'));
    toast.success('Счёт скачан');
  };
  const downloadDocument = (doc: ClientDocument) => {
    downloadPdf(documentPdf(doc, company), pdfFileName('document'));
    toast.success('Документ скачан');
  };

  const columns: Column<Invoice>[] = [
    { key: 'number', header: 'Номер', cell: (i) => <span className="font-semibold num">{i.number}</span> },
    { key: 'amount', header: 'Сумма', align: 'right', cell: (i) => <span className="num">{formatMoney(i.amount)}</span> },
    {
      key: 'due',
      header: 'Срок оплаты',
      cell: (i) => (
        <span>
          <span className="num">{formatDate(i.dueDate)}</span>
          {i.status !== 'paid' && <span className="ml-2 text-muted">{formatRelativeDays(i.dueDate)}</span>}
        </span>
      ),
    },
    { key: 'status', header: 'Статус', cell: (i) => <Chip kind={INVOICE_STATUS[i.status].kind}>{INVOICE_STATUS[i.status].label}</Chip> },
    {
      key: 'dl',
      header: '',
      align: 'right',
      cell: (i) => (
        <Button variant="secondary" className="h-11 px-4 text-[14px] font-semibold" onClick={() => downloadInvoice(i)} aria-label={`Скачать счёт ${i.number}`}>
          <Download className="h-4 w-4" aria-hidden />
          Скачать
        </Button>
      ),
    },
  ];

  return (
    <>
      <HrHeader title="Счета и документы" subtitle="Документы формируются без персональных данных сотрудников" />

      <section className="mb-8 rounded-card border border-border bg-surface" aria-labelledby="hr-invoices">
        <div className="border-b border-border-soft p-5">
          <HrSectionTitle>
            <span id="hr-invoices">Счета</span>
          </HrSectionTitle>
        </div>
        <DataTable
          caption="Счета компании"
          density="client"
          columns={columns}
          rows={invoices.data}
          rowKey={(i) => i.id}
          loading={invoices.isLoading}
          error={invoices.isError ? invoices.error : undefined}
          onRetry={() => void invoices.refetch()}
          empty={<EmptyState title="Счетов пока нет" description="Счета появятся здесь после начала действия полиса. Вопросы можно задать менеджеру МИГ" action={<HelpLink />} />}
        />
      </section>

      <HrCard className="mb-8 p-0">
        <div className="border-b border-border-soft p-5">
          <HrSectionTitle>Коммерческие предложения</HrSectionTitle>
        </div>
        <QueryState query={documents} skeleton={<SkeletonRows rows={2} className="p-5" />}>
          {(docs) => {
            const offers = docs.filter((d) => d.kind === 'kp' && d.kpId);
            return offers.length === 0 ? (
              <EmptyState title="Предложений пока нет" description="Здесь появятся коммерческие предложения, которые отправит МИГ" />
            ) : (
              <ul className="divide-y divide-border-soft" aria-label="Коммерческие предложения">
                {offers.map((d) => (
                  <li key={d.id} className="flex flex-wrap items-center gap-4 px-5 py-3">
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-peach text-peach-text" aria-hidden>
                      <FileText className="h-5 w-5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold">{d.title}</p>
                      <p className="text-[13px] text-muted">Программа GOLD · {formatDate(d.createdAt)}</p>
                    </div>
                    <Button asChild variant="secondary" className="h-11 px-4 text-[14px] font-semibold">
                      <Link to={`/hr/kp/${d.kpId}`}>Открыть</Link>
                    </Button>
                    <KpDownloadButton kpId={d.kpId!} number={d.title} className="h-11 px-4 text-[14px] font-semibold" />
                  </li>
                ))}
              </ul>
            );
          }}
        </QueryState>
      </HrCard>

      <HrCard className="p-0">
        <div className="border-b border-border-soft p-5">
          <HrSectionTitle>Документы полиса</HrSectionTitle>
        </div>
        <QueryState query={documents} skeleton={<SkeletonRows rows={4} className="p-5" />}>
          {(all) => {
            const docs = all.filter((d) => d.kind !== 'kp');
            return docs.length === 0 ? (
              <EmptyState title="Документов пока нет" description="Запросите документы у менеджера МИГ" action={<HelpLink />} />
            ) : (
              <ul className="divide-y divide-border-soft">
                {docs.map((d) => (
                  <li key={d.id} className="flex flex-wrap items-center gap-4 px-5 py-3">
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-sky text-sky-text" aria-hidden>
                      <FileText className="h-5 w-5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold">{d.title}</p>
                      <p className="text-[13px] text-muted">
                        {DOC_KIND[d.kind]} · {formatDate(d.createdAt)}
                      </p>
                    </div>
                    <Button variant="secondary" className="h-11 px-4 text-[14px] font-semibold" onClick={() => downloadDocument(d)}>
                      <Download className="h-4 w-4" aria-hidden />
                      Скачать
                    </Button>
                  </li>
                ))}
              </ul>
            );
          }}
        </QueryState>
      </HrCard>
    </>
  );
}

function HelpLink() {
  return (
    <Button asChild variant="secondary" className={HR_BTN}>
      <Link to="/hr/help">Связаться с менеджером</Link>
    </Button>
  );
}
