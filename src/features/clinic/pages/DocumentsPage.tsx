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

export default function DocumentsPage() {
  useDocumentTitle('Документы клиники');
  const docs = useClinicDocuments();
  const prices = useClinicPriceList();
  const columns: Column<PriceListItem>[] = [
    { key: 'code', header: 'Код', cell: (p) => <span className="num">{p.code}</span> },
    { key: 'name', header: 'Услуга', cell: (p) => p.name },
    { key: 'cat', header: 'Категория', cell: (p) => <span className="text-muted">{SERVICE_CATEGORY_LABEL[p.category]}</span> },
    { key: 'price', header: 'Цена', align: 'right', cell: (p) => <span className="num whitespace-nowrap">{formatMoney(p.price)}</span> },
    { key: 'gp', header: 'Нужно ГП', cell: (p) => (p.requiresGuarantee ? <Chip kind="warning">Нужно ГП</Chip> : <span className="text-muted">—</span>) },
  ];
  return (
    <>
      <PageTitle title="Документы" />
      <QueryState query={docs} skeleton={<SkeletonRows rows={3} />}>
        {(d) => (
          <div className="mb-4 grid gap-4 lg:grid-cols-2">
            <Panel title="Договор с МИГ">
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 p-4">
                <dt className="text-muted">Номер</dt>
                <dd className="num">{d.contract.number}</dd>
                <dt className="text-muted">Подписан</dt>
                <dd className="num">{formatDate(d.contract.signedAt)}</dd>
                <dt className="text-muted">Действует до</dt>
                <dd className="num">{formatDate(d.contract.validUntil)}</dd>
              </dl>
            </Panel>
            <Panel title="Акты сверки">
              {d.acts.length === 0 ? (
                <p className="p-4 text-muted">Актов пока нет: они появятся после проверки реестров</p>
              ) : (
                <ul className="divide-y divide-border-soft">
                  {d.acts.map((a) => (
                    <li key={a.registryId} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2">
                      <span>
                        <span className="num font-semibold">{a.period}</span> · принято {formatMoney(a.accepted)} · оплачено {formatMoney(a.paid)}
                      </span>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() =>
                          downloadText(
                            toCsv(['Период', 'Заявлено', 'Принято', 'Оплачено', 'Дата оплаты'], [[a.period, a.claimed, a.accepted, a.paid, a.paidAt ? formatDate(a.paidAt) : '']]),
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
        title="Прайс-лист договора"
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
        <DataTable caption="Прайс-лист" columns={columns} rows={prices.data} rowKey={(p) => p.code} loading={prices.isLoading} error={prices.error} onRetry={() => void prices.refetch()} />
      </Panel>
    </>
  );
}
