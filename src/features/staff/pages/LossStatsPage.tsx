/*
 * Loss statistics of a client for the underwriter (the «Убыточность» row of the queue): only aggregates —
 * sums, the loss ratio, categories and months. No claims, insured names or diagnoses.
 */
import { t, tm } from '@/i18n';
import { useParams } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis } from 'recharts';
import { useClientLossStats } from '@/shared/api/queries/staff';
import { formatMoney, formatMoneyShort, formatNumber, formatPercent } from '@/shared/lib/format';
import { useDocumentTitle } from '@/shared/lib/hooks';
import { Card, PageHeader } from '@/shared/ui/page';
import { EmptyState, QueryState } from '@/shared/ui/states';
import { MiniKpi } from '../components/KpiCard';
import { monthShort } from '../components/months';
import { useTopbar } from '../topbar';
import { TableScroll } from '@/shared/ui/table-scroll';


export default function LossStatsPage() {
  const { clientId } = useParams();
  const q = useClientLossStats(clientId);
  useDocumentTitle(t('staff.loss.docTitle'));
  useTopbar([{ label: t('staff.clients.title'), to: '/staff/clients?view=loss' }, { label: q.data?.clientName ?? t('common.client') }, { label: t('staff.clients.col.loss') }]);

  return (
    <QueryState query={q}>
      {(s) => (
        <div data-testid="loss-stats">
          <PageHeader title={t('staff.loss.heading', { client: s.clientName })} subtitle={t('staff.loss.subtitle')} />
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <MiniKpi label={t('common.premium')} value={s.premium ? formatMoneyShort(s.premium) : '—'} />
            <MiniKpi label={t('staff.loss.claimsAmount')} value={formatMoneyShort(s.claimsAmount)} />
            <MiniKpi label={t('staff.clients.col.loss')} value={s.lossRatio === null ? '—' : formatPercent(s.lossRatio)} tone={(s.lossRatio ?? 0) >= s.lossRatioWarn ? 'warning' : 'default'} />
            <MiniKpi label={t('staff.loss.requests')} value={formatNumber(s.claimsCount)} />
          </div>
          <p className="mt-2 text-[12px] text-muted">{t('staff.loss.threshold', { pct: formatPercent(s.lossRatioWarn) })}</p>
          <Card title={t('staff.clientCard.claimsByMonth')} className="mt-4">
            <div className="h-64" role="img" aria-label={t('staff.clientCard.chartAria')}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={s.byMonth.map((m) => ({ ...m, label: monthShort(m.month) }))}>
                  <CartesianGrid vertical={false} stroke="#eceef1" />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={12} />
                  <YAxis tickFormatter={(v: number) => formatMoneyShort(v).replace(`\u00a0${t('fmt.currency')}`, '')} tickLine={false} axisLine={false} fontSize={12} width={70} />
                  <RTooltip formatter={(v: number) => formatMoney(v)} labelFormatter={(l: string) => t('staff.clientCard.monthTooltip', { month: l })} />
                  <Bar dataKey="amount" name={t('common.amount')} fill="#4f46e5" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <TableScroll className="mt-3">
            <table className="w-full text-[13px]" data-testid="loss-by-month">
              <caption className="sr-only">{t('staff.clientCard.claimsByMonth')}</caption>
              <thead>
                <tr className="text-left text-[12px] text-muted">
                  <th className="py-1.5 font-normal">{t('staff.loss.colMonth')}</th>
                  <th className="py-1.5 text-right font-normal">{t('staff.loss.requests')}</th>
                  <th className="py-1.5 text-right font-normal">{t('common.amount')}</th>
                </tr>
              </thead>
              <tbody>
                {s.byMonth.map((m) => (
                  <tr key={m.month} className="border-b border-border-soft">
                    <td className="py-1.5">
                      {t('staff.reports.monthYear', { month: monthShort(m.month), year: m.month.slice(0, 4) })}
                    </td>
                    <td className="py-1.5 text-right num">{formatNumber(m.count)}</td>
                    <td className="py-1.5 text-right num">{formatMoney(m.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </TableScroll>
          </Card>
          <Card title={t('staff.clientCard.claimsByCategory')} className="mt-4" bodyClassName="p-0">
            {s.byCategory.length === 0 ? (
              <EmptyState title={t('staff.clientCard.noClaims')} />
            ) : (
              <TableScroll>
              <table className="w-full" data-testid="loss-by-category">
                <caption className="sr-only">{t('staff.clientCard.claimsByCategory')}</caption>
                <thead>
                  <tr className="text-left text-[12px] text-muted">
                    <th className="px-4 py-2 font-normal">{t('common.category')}</th>
                    <th className="px-4 py-2 text-right font-normal">{t('staff.loss.requests')}</th>
                    <th className="px-4 py-2 text-right font-normal">{t('common.amount')}</th>
                    <th className="px-4 py-2 text-right font-normal">{t('staff.loss.colShare')}</th>
                  </tr>
                </thead>
                <tbody>
                  {s.byCategory.map((r) => (
                    <tr key={r.category} className="h-11 border-b border-border-soft">
                      <td className="px-4">{tm(r.category)}</td>
                      <td className="px-4 text-right num">{formatNumber(r.count)}</td>
                      <td className="px-4 text-right num">{formatMoney(r.amount)}</td>
                      <td className="px-4 text-right num">{s.claimsAmount ? formatPercent(r.amount / s.claimsAmount) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </TableScroll>
            )}
          </Card>
        </div>
      )}
    </QueryState>
  );
}
