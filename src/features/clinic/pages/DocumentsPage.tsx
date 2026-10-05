/* Clinic documents (CLINIC_SPEC §4.6): contract with MIG, price list, reconciliation acts. */
import { Download } from 'lucide-react';
import type { PriceListItem } from '@/shared/types';
import { useClinicDocuments, useClinicPriceList } from '@/shared/api/queries/clinic';
import { SERVICE_CATEGORY_LABEL } from '@/shared/domain/clinics';
import { downloadText, toCsv } from '@/shared/lib/csv';
import { formatDate, formatMoney } from '@/shared/lib/format';
import { useDocumentTitle } from '@/shared/lib/hooks';
import { Button } from '@/shared/ui/button';
import { Chip } from '@/shared/ui/chips';
import { DataTable, type Column } from '@/shared/ui/data-table';
import { QueryState, SkeletonRows } from '@/shared/ui/states';
import { PageTitle, Panel } from '../components';
import { t } from '@/i18n';

export default function DocumentsPage() {
  useDocumentTitle(t('clinic.docsPage.docTitle'));
  const docs = useClinicDocuments();
  const prices = useClinicPriceList();
  const columns: Column<PriceListItem>[] = [
    { key: 'code', header: t('clinic.docsPage.code'), cell: (p) => <span className="num">{p.code}</span> },
    { key: 'name', header: t('common.service'), cell: (p) => p.name },
    { key: 'cat', header: t('common.category'), cell: (p) => <span className="text-muted">{SERVICE_CATEGORY_LABEL[p.category]}</span> },
    { key: 'price', header: t('clinic.docsPage.price'), align: 'right', cell: (p) => <span className="num whitespace-nowrap">{formatMoney(p.price)}</span> },
    { key: 'gp', header: t('clinic.docsPage.needsGp'), cell: (p) => (p.requiresGuarantee ? <Chip kind="warning">{t('clinic.docsPage.needsGp')}</Chip> : <span className="text-muted">—</span>) },
  ];
  return (
    <>
      <PageTitle title={t('common.documents')} />
      <QueryState query={docs} skeleton={<SkeletonRows rows={3} />}>
        {(d) => (
          <div className="mb-4 grid gap-4 lg:grid-cols-2">
            <Panel title={t('clinic.docsPage.contract')}>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 p-4">
                <dt className="text-muted">{t('common.number')}</dt>
                <dd className="num">{d.contract.number}</dd>
                <dt className="text-muted">{t('clinic.docsPage.signed')}</dt>
                <dd className="num">{formatDate(d.contract.signedAt)}</dd>
                <dt className="text-muted">{t('common.validUntil')}</dt>
                <dd className="num">{formatDate(d.contract.validUntil)}</dd>
              </dl>
            </Panel>
            <Panel title={t('clinic.docsPage.acts')}>
              {d.acts.length === 0 ? (
                <p className="p-4 text-muted">{t('clinic.docsPage.noActs')}</p>
              ) : (
                <ul className="divide-y divide-border-soft">
                  {d.acts.map((a) => (
                    <li key={a.registryId} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2">
                      <span>
                        <span className="num font-semibold">{a.period}</span>
                        {t('clinic.docsPage.actLine', { accepted: formatMoney(a.accepted), paid: formatMoney(a.paid) })}
                      </span>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() =>
                          downloadText(
                            toCsv([t('common.period'), t('clinic.docsPage.csvClaimed'), t('clinic.docsPage.csvAccepted'), t('clinic.docsPage.csvPaid'), t('clinic.docsPage.csvPaidAt')], [[a.period, a.claimed, a.accepted, a.paid, a.paidAt ? formatDate(a.paidAt) : '']]),
                            `reconciliation-act-${a.period}.csv`,
                          )
                        }
                      >
                        <Download className="h-3.5 w-3.5" aria-hidden /> CSV
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>
        )}
      </QueryState>
      <Panel
        title={t('clinic.docsPage.priceList')}
        actions={
          <Button
            size="sm"
            variant="secondary"
            disabled={!prices.data}
            onClick={() => downloadText(toCsv(['code', 'name', 'price', 'requires_guarantee'], (prices.data ?? []).map((p) => [p.code, p.name, p.price, p.requiresGuarantee ? 'yes' : 'no'])), 'price-list.csv')}
          >
            <Download className="h-3.5 w-3.5" aria-hidden /> CSV
          </Button>
        }
      >
        <DataTable caption={t('clinic.docsPage.priceCaption')} columns={columns} rows={prices.data} rowKey={(p) => p.code} loading={prices.isLoading} error={prices.error} onRetry={() => void prices.refetch()} />
      </Panel>
    </>
  );
}
