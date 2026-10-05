/* Rebills of assistance companies for MIG: review (curator) and payment (accountant). */
import { useNavigate } from 'react-router-dom';
import type { RebillSummary } from '@/shared/types/dto';
import { useStaffRebills } from '@/shared/api/queries/assist';
import { useCan } from '@/shared/auth/guards';
import { t } from '@/i18n';
import { formatDate, formatMoney } from '@/shared/lib/format';
import { useDocumentTitle, useUrlFilters } from '@/shared/lib/hooks';
import { legalFormColumn } from '@/shared/ui/legal-form';
import { DataTable, type Column } from '@/shared/ui/data-table';
import { PageHeader } from '@/shared/ui/page';
import { Tabs, TabsList, TabsTrigger } from '@/shared/ui/tabs';
import { RebillStatus } from '@/features/assist/components';
import { useTopbar } from '../topbar';

export default function RebillsPage() {
  useDocumentTitle(t('staffOps.rebills.title'));
  useTopbar([{ label: t('staffOps.rebills.title') }]);
  const navigate = useNavigate();
  const canPay = useCan('rebills.pay');
  const tabs: [string, string][] = [
    ['submitted,in_review', t('staffOps.registries.tab.review')],
    ['accepted,partially_accepted', t('staffOps.registries.tab.toPay')],
    ['paid', t('staffOps.registries.tab.paid')],
    ['all', t('common.all')],
  ];
  const [f, setF] = useUrlFilters(['status'] as const);
  const fallback = canPay ? 'accepted,partially_accepted' : 'submitted,in_review';
  const status = tabs.some(([k]) => k === f.status) ? f.status! : fallback;
  const q = useStaffRebills(status === 'all' ? {} : { status });
  const columns: Column<RebillSummary>[] = [
    { key: 'num', header: t('common.number'), cell: (b) => <span className="num font-medium">{b.number}</span> },
    { key: 'who', header: t('staffOps.rebills.col.assistance'), cell: (b) => b.assistanceName },
    legalFormColumn<RebillSummary>((b) => b.assistanceLegalForm),
    { key: 'period', header: t('common.period'), cell: (b) => <span className="num">{b.period}</span> },
    { key: 'lines', header: t('staffOps.clinicCard.lines'), align: 'right', cell: (b) => <span className="num">{b.lineCount}</span> },
    { key: 'flags', header: t('staffOps.rebills.col.flagged'), align: 'right', cell: (b) => <span className={b.flaggedCount ? 'num font-semibold text-danger-text' : 'num text-muted'}>{b.flaggedCount}</span> },
    { key: 'total', header: t('common.total'), align: 'right', cell: (b) => <span className="num whitespace-nowrap">{formatMoney(b.totals.total)}</span> },
    { key: 'due', header: t('staffOps.rebills.col.due'), cell: (b) => (b.reviewDueAt ? <span className="num">{formatDate(b.reviewDueAt)}</span> : '—') },
    { key: 'status', header: t('common.status'), cell: (b) => <RebillStatus status={b.status} /> },
  ];
  return (
    <>
      <PageHeader title={t('staffOps.rebills.title')} subtitle={t('staffOps.rebills.subtitle')} />
      <Tabs value={status} onValueChange={(v) => setF({ status: v === fallback ? null : v })}>
        <TabsList>
          {tabs.map(([k, label]) => (
            <TabsTrigger key={k} value={k}>
              {label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <div className="mt-3 rounded-card border border-border bg-surface">
        <DataTable
          caption={t('staffOps.rebills.title')}
          columns={columns}
          rows={q.data}
          loading={q.isLoading}
          error={q.error}
          onRetry={() => void q.refetch()}
          rowKey={(b) => b.id}
          onRowClick={(b) => navigate(`/staff/rebills/${b.id}`)}
          onRowOpen={(b) => navigate(`/staff/rebills/${b.id}`)}
          empty={t('staffOps.rebills.empty')}
        />
      </div>
    </>
  );
}
