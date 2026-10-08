import { LegalFormChip } from '@/shared/ui/legal-form';
import { t, tp } from '@/i18n';
import { useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip as RTooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useClaimsByCategoryReport, useLossRatioReport, usePremiumReport } from '@/shared/api/queries/staff';
import { CLAIM_CATEGORY_LABEL } from '@mig/domain/claims';
import { addDaysISO, formatMoney, formatMoneyShort, formatNumber, formatPercent, todayISO } from '@mig/domain/lib/format';
import { useDocumentTitle } from '@/shared/lib/hooks';
import { Input } from '@/shared/ui/input';
import { useAssistanceReport } from '@/shared/api/queries/assist';
import { Card } from '@/shared/ui/page';
import { EmptyState, QueryState, Skeleton } from '@/shared/ui/states';
import { ExportButton } from '../components/ExportButton';
import { monthShort } from '../components/months';
import { useTopbar } from '../topbar';
import { useDmsParam } from '@/shared/api/queries/params';
import { TableScroll } from '@/shared/ui/table-scroll';

const ACCENT = '#4f46e5';
const WARN = '#d97706';
const GRID = '#eceef1';
const money = (v: number) => formatMoneyShort(v).replace(`\u00a0${t('fmt.currency')}`, '');

export default function ReportsPage() {
  const lossWarn = useDmsParam('lossRatioWarn');
  const byAssistance = useAssistanceReport();
  useDocumentTitle(t('staff.reports.title'));
  useTopbar([{ label: t('staff.reports.title') }]);
  const [from, setFrom] = useState(() => addDaysISO(todayISO(), -365));
  const [to, setTo] = useState(() => todayISO());
  const loss = useLossRatioReport();
  const cats = useClaimsByCategoryReport({ from, to });
  const premium = usePremiumReport();
  const chartSkeleton = <Skeleton className="h-72 w-full" />;

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-[22px] font-bold">{t('staff.reports.title')}</h1>
      <Card title={t('staff.reports.lossByClient')} actions={<ExportButton type="loss_ratio" label="CSV" />}>
        <QueryState query={loss} skeleton={chartSkeleton}>
          {(rows) =>
            rows.length === 0 ? (
              <EmptyState title={t('staff.reports.noData')} />
            ) : (
              <div style={{ height: Math.max(280, rows.length * 22) }} role="img" aria-label={tp('staff.reports.lossAria', rows.filter((r) => r.lossRatio >= lossWarn).length, { pct: formatPercent(lossWarn) })}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={rows.map((r) => ({ ...r, pct: Math.round(r.lossRatio * 100) }))} layout="vertical" margin={{ left: 8, right: 24 }}>
                    <CartesianGrid horizontal={false} stroke={GRID} />
                    <XAxis type="number" unit="%" tickLine={false} axisLine={false} fontSize={12} />
                    <YAxis type="category" dataKey="clientName" width={210} tickLine={false} axisLine={false} fontSize={12} interval={0} />
                    <RTooltip formatter={(v: number) => [`${v}%`, t('staff.clients.col.loss')]} />
                    <ReferenceLine x={Math.round(lossWarn * 100)} stroke={WARN} strokeDasharray="4 3" label={{ value: t('staff.reports.threshold'), position: 'top', fill: WARN, fontSize: 12 }} />
                    <Bar dataKey="pct" radius={[0, 4, 4, 0]} barSize={12}>
                      {rows.map((r) => (
                        <Cell key={r.clientId} fill={r.lossRatio >= lossWarn ? WARN : ACCENT} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )
          }
        </QueryState>
      </Card>
      <div className="grid gap-4 xl:grid-cols-2">
        <Card
          title={t('staff.clientCard.claimsByCategory')}
          actions={
            <span className="flex items-center gap-2">
              <Input type="date" aria-label={t('common.from')} className="h-7 w-auto" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} />
              <span className="text-muted">—</span>
              <Input type="date" aria-label={t('common.to')} className="h-7 w-auto" value={to} min={from} onChange={(e) => e.target.value && setTo(e.target.value)} />
              <ExportButton type="claims_by_category" label="CSV" />
            </span>
          }
        >
          <QueryState query={cats} skeleton={chartSkeleton}>
            {(rows) =>
              rows.length === 0 ? (
                <EmptyState title={t('staff.reports.noClaimsPeriod')} description={t('staff.reports.widenPeriod')} />
              ) : (
                <>
                  <div className="h-72" role="img" aria-label={t('staff.reports.byCategoryAria')}>
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={rows.map((r) => ({ ...r, label: CLAIM_CATEGORY_LABEL[r.category] }))}>
                        <CartesianGrid vertical={false} stroke={GRID} />
                        <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={12} interval={0} />
                        <YAxis tickFormatter={money} tickLine={false} axisLine={false} fontSize={12} width={64} />
                        <RTooltip formatter={(v: number) => [formatMoney(v), t('common.amount')]} />
                        <Bar dataKey="amount" fill={ACCENT} radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                  <p className="mt-2 text-[12px] text-muted">
                    {tp('staff.reports.totalClaims', rows.reduce((s, r) => s + r.count, 0), { amount: formatMoney(rows.reduce((s, r) => s + r.amount, 0)) })}
                  </p>
                </>
              )
            }
          </QueryState>
        </Card>
        <Card title={t('staff.reports.premiumByMonth')} actions={<ExportButton type="premium_by_month" label="CSV" />}>
          <QueryState query={premium} skeleton={chartSkeleton}>
            {(rows) => (
              <div className="h-72" role="img" aria-label={t('staff.reports.premiumAria')}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={rows.map((r) => ({ ...r, label: t('staff.reports.monthYear', { month: monthShort(r.month), year: r.month.slice(2, 4) }) }))}>
                    <CartesianGrid vertical={false} stroke={GRID} />
                    <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={12} />
                    <YAxis tickFormatter={money} tickLine={false} axisLine={false} fontSize={12} width={64} />
                    <RTooltip formatter={(v: number) => [formatMoney(v), t('common.premium')]} />
                    <Line type="monotone" dataKey="premium" stroke={ACCENT} strokeWidth={2} dot={{ r: 3 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </QueryState>
        </Card>
      </div>
      <Card title={t('staff.reports.assistanceTitle')} bodyClassName="p-0">
        <QueryState query={byAssistance}>
          {(rows) => (
            <TableScroll>
            <table className="w-full text-left" data-testid="report-by-assistance">
              <caption className="sr-only">{t('staff.reports.assistanceCaption')}</caption>
              <thead className="text-[12px] text-muted">
                <tr>
                  <th className="px-4 py-2 font-medium">{t('staff.audit.assistance')}</th>
                  <th className="px-4 py-2 text-right font-medium">{t('staff.clients.col.insured')}</th>
                  <th className="px-4 py-2 text-right font-medium">{t('common.premium')}</th>
                  <th className="px-4 py-2 text-right font-medium">{t('staff.reports.colPaid')}</th>
                  <th className="px-4 py-2 text-right font-medium">{t('staff.clients.col.loss')}</th>
                  <th className="px-4 py-2 text-right font-medium">{t('staff.reports.colFee')}</th>
                  <th className="px-4 py-2 text-right font-medium">{t('staff.reports.colPerInsured')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.assistanceId ?? 'mig'} className="border-t border-border-soft">
                    <td className="px-4 py-1.5 font-medium">
                      {r.name} <LegalFormChip code={r.legalForm} />
                    </td>
                    <td className="num px-4 py-1.5 text-right">{formatNumber(r.insuredCount)}</td>
                    <td className="num px-4 py-1.5 text-right">{formatMoney(r.premium)}</td>
                    <td className="num px-4 py-1.5 text-right">{formatMoney(r.paid)}</td>
                    <td className={`num px-4 py-1.5 text-right ${(r.lossRatio ?? 0) >= lossWarn ? 'text-warning-text' : ''}`}>{r.lossRatio === null ? '—' : formatPercent(r.lossRatio)}</td>
                    <td className="num px-4 py-1.5 text-right">{r.assistanceId ? formatMoney(r.fee) : '—'}</td>
                    <td className="num px-4 py-1.5 text-right">{r.feePerInsured === null ? '—' : formatMoney(r.feePerInsured)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </TableScroll>
          )}
        </QueryState>
      </Card>
      <p className="text-[12px] text-muted">{t('staff.reports.footnote', { pct: formatPercent(lossWarn) })}</p>
    </div>
  );
}
