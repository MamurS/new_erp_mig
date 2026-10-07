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
import { AskButton, HelpMore, roleName } from '@/features/next/NextActions';
import { useUser } from '@/shared/auth/session';
import { documentPdf, downloadPdf, invoicePdf, pdfFileName } from '../pdf';
import { HrCard, HrHeader, HrSectionTitle } from '../ui';
import { t, defineLabels } from '@/i18n';

const INVOICE_STATUS_KIND: Record<Invoice['status'], string> = { unpaid: 'sun', paid: 'success', overdue: 'danger' };
const INVOICE_STATUS_LABEL: Readonly<Record<Invoice['status'], string>> = defineLabels('hr.docs.invoiceStatus', ['unpaid', 'paid', 'overdue'] as const);

const DOC_KIND: Readonly<Record<ClientDocument['kind'], string>> = defineLabels('hr.docs.kind', ['policy', 'contract', 'invoice', 'act', 'program', 'kp', 'endorsement', 'insured_list'] as const);

export default function DocumentsPage() {
  useDocumentTitle(t('hr.nav.documents'));
  const invoices = useHrInvoices();
  const documents = useHrDocuments();
  const overview = useHrOverview().data;
  const company = overview?.companyName;
  const companyForm = overview?.companyLegalForm;
  const companyId = useUser()?.companyId;

  const downloadInvoice = (inv: Invoice) => {
    downloadPdf(invoicePdf(inv, company, companyForm), pdfFileName('invoice'));
    toast.success(t('hr.docs.invoiceDownloaded'));
  };
  const downloadDocument = (doc: ClientDocument) => {
    downloadPdf(documentPdf(doc, company, companyForm), pdfFileName('document'));
    toast.success(t('hr.docs.documentDownloaded'));
  };

  const columns: Column<Invoice>[] = [
    { key: 'number', header: t('common.number'), cell: (i) => <span className="font-semibold num">{i.number}</span> },
    { key: 'amount', header: t('common.amount'), align: 'right', cell: (i) => <span className="num">{formatMoney(i.amount)}</span> },
    {
      key: 'due',
      header: t('hr.docs.due'),
      cell: (i) => (
        <span>
          <span className="num">{formatDate(i.dueDate)}</span>
          {i.status !== 'paid' && <span className="ml-2 text-muted">{formatRelativeDays(i.dueDate)}</span>}
        </span>
      ),
    },
    { key: 'status', header: t('common.status'), cell: (i) => <Chip kind={INVOICE_STATUS_KIND[i.status]}>{INVOICE_STATUS_LABEL[i.status]}</Chip> },
    {
      key: 'dl',
      header: '',
      align: 'right',
      cell: (i) => (
        <Button variant="secondary" className="h-11 px-4 text-[14px] font-semibold" onClick={() => downloadInvoice(i)} aria-label={t('hr.docs.downloadInvoice', { number: i.number })}>
          <Download className="h-4 w-4" aria-hidden />
          {t('common.download')}
        </Button>
      ),
    },
  ];

  return (
    <>
      <HrHeader title={t('hr.nav.documents')} subtitle={t('hr.docs.subtitle')} />

      <section className="mb-8 rounded-card border border-border bg-surface" aria-labelledby="hr-invoices">
        <div className="border-b border-border-soft p-5">
          <HrSectionTitle>
            <span id="hr-invoices">{t('hr.docs.invoices')}</span>
          </HrSectionTitle>
        </div>
        <DataTable
          caption={t('hr.docs.invoicesCaption')}
          density="client"
          columns={columns}
          rows={invoices.data}
          rowKey={(i) => i.id}
          loading={invoices.isLoading}
          error={invoices.isError ? invoices.error : undefined}
          onRetry={() => void invoices.refetch()}
          empty={<EmptyState testId="hr-invoices-next" title={t('hr.docs.noInvoices')} why={t('emptyStaff.hrInvoices.why')} next={t('emptyStaff.hrInvoices.next')} help={<HelpMore article="signing" section="payment" />} />}
        />
      </section>

      <HrCard className="mb-8 p-0">
        <div className="border-b border-border-soft p-5">
          <HrSectionTitle>{t('hr.docs.offers')}</HrSectionTitle>
        </div>
        <QueryState query={documents} skeleton={<SkeletonRows rows={2} className="p-5" />}>
          {(docs) => {
            const offers = docs.filter((d) => d.kind === 'kp' && d.kpId);
            return offers.length === 0 ? (
              <EmptyState
                testId="hr-offers-next"
                title={t('hr.docs.noOffers')}
                why={t('emptyStaff.hrOffers.why')}
                next={t('emptyStaff.hrOffers.next', { role: roleName('sales_manager') })}
                actions={companyId ? <AskButton role="sales_manager" action="kp_send" subjectType="client" subjectId={companyId} /> : null}
                help={<HelpMore article="new-client" section="kp" />}
              />
            ) : (
              <ul className="divide-y divide-border-soft" aria-label={t('hr.docs.offers')}>
                {offers.map((d) => (
                  <li key={d.id} className="flex flex-wrap items-center gap-4 px-5 py-3">
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-peach text-peach-text" aria-hidden>
                      <FileText className="h-5 w-5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold">{d.title}</p>
                      <p className="text-[13px] text-muted">{t('hr.docs.offerMeta', { date: formatDate(d.createdAt) })}</p>
                    </div>
                    <Button asChild variant="secondary" className="h-11 px-4 text-[14px] font-semibold">
                      <Link to={`/hr/kp/${d.kpId}`}>{t('common.open')}</Link>
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
          <HrSectionTitle>{t('hr.docs.policyDocs')}</HrSectionTitle>
        </div>
        <QueryState query={documents} skeleton={<SkeletonRows rows={4} className="p-5" />}>
          {(all) => {
            const docs = all.filter((d) => d.kind !== 'kp');
            return docs.length === 0 ? (
              <EmptyState
                testId="hr-docs-next"
                title={t('hr.docs.noDocs')}
                why={t('emptyStaff.hrDocs.why')}
                next={t('emptyStaff.hrDocs.next')}
                actions={companyId ? <AskButton role="sales_manager" action="other" subjectType="client" subjectId={companyId} /> : null}
                help={<HelpMore article="portal-guides" section="guide-hr" />}
              />
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
                      {t('common.download')}
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

