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
import { CLAIM_CATEGORY_LABEL } from '@/shared/domain/claims';
import { addDaysISO, formatMoney, formatMoneyShort, formatNumber, formatPercent, todayISO } from '@/shared/lib/format';
import { useDocumentTitle } from '@/shared/lib/hooks';
import { Input } from '@/shared/ui/input';
import { useAssistanceReport } from '@/shared/api/queries/assist';
import { Card } from '@/shared/ui/page';
import { EmptyState, QueryState, Skeleton } from '@/shared/ui/states';
import { ExportButton } from '../components/ExportButton';
import { useTopbar } from '../topbar';

const ACCENT = '#4f46e5';
const WARN = '#d97706';
const GRID = '#eceef1';
const MONTHS = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const money = (v: number) => formatMoneyShort(v).replace(' UZS', '');

export default function ReportsPage() {
  const byAssistance = useAssistanceReport();
  useDocumentTitle('Отчёты');
  useTopbar([{ label: 'Отчёты' }]);
  const [from, setFrom] = useState(() => addDaysISO(todayISO(), -365));
  const [to, setTo] = useState(() => todayISO());
  const loss = useLossRatioReport();
  const cats = useClaimsByCategoryReport({ from, to });
  const premium = usePremiumReport();
  const chartSkeleton = <Skeleton className="h-72 w-full" />;

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-[22px] font-bold">Отчёты</h1>
      <Card title="Убыточность по клиентам" actions={<ExportButton type="loss_ratio" label="CSV" />}>
        <QueryState query={loss} skeleton={chartSkeleton}>
          {(rows) =>
            rows.length === 0 ? (
              <EmptyState title="Нет данных" />
            ) : (
              <div style={{ height: Math.max(280, rows.length * 22) }} role="img" aria-label={`Убыточность по клиентам. Выше 80%: ${rows.filter((r) => r.lossRatio >= 0.8).length} клиентов`}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={rows.map((r) => ({ ...r, pct: Math.round(r.lossRatio * 100) }))} layout="vertical" margin={{ left: 8, right: 24 }}>
                    <CartesianGrid horizontal={false} stroke={GRID} />
                    <XAxis type="number" unit="%" tickLine={false} axisLine={false} fontSize={12} />
                    <YAxis type="category" dataKey="clientName" width={210} tickLine={false} axisLine={false} fontSize={12} interval={0} />
                    <RTooltip formatter={(v: number) => [`${v}%`, 'Убыточность']} />
                    <ReferenceLine x={80} stroke={WARN} strokeDasharray="4 3" label={{ value: 'Порог 80%', position: 'top', fill: WARN, fontSize: 12 }} />
                    <Bar dataKey="pct" radius={[0, 4, 4, 0]} barSize={12}>
                      {rows.map((r) => (
                        <Cell key={r.clientId} fill={r.lossRatio >= 0.8 ? WARN : ACCENT} />
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
          title="Убытки по категориям"
          actions={
            <span className="flex items-center gap-2">
              <Input type="date" aria-label="С даты" className="h-7 w-auto" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} />
              <span className="text-muted">—</span>
              <Input type="date" aria-label="По дату" className="h-7 w-auto" value={to} min={from} onChange={(e) => e.target.value && setTo(e.target.value)} />
              <ExportButton type="claims_by_category" label="CSV" />
            </span>
          }
        >
          <QueryState query={cats} skeleton={chartSkeleton}>
            {(rows) =>
              rows.length === 0 ? (
                <EmptyState title="За период убытков нет" description="Расширьте период" />
              ) : (
                <>
                  <div className="h-72" role="img" aria-label="Сумма убытков по категориям за период">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={rows.map((r) => ({ ...r, label: CLAIM_CATEGORY_LABEL[r.category] }))}>
                        <CartesianGrid vertical={false} stroke={GRID} />
                        <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={12} interval={0} />
                        <YAxis tickFormatter={money} tickLine={false} axisLine={false} fontSize={12} width={64} />
                        <RTooltip formatter={(v: number) => [formatMoney(v), 'Сумма']} />
                        <Bar dataKey="amount" fill={ACCENT} radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                  <p className="mt-2 text-[12px] text-muted">
                    Всего {formatNumber(rows.reduce((s, r) => s + r.count, 0))} убытков на {formatMoney(rows.reduce((s, r) => s + r.amount, 0))}
                  </p>
                </>
              )
            }
          </QueryState>
        </Card>
        <Card title="Премия по месяцам" actions={<ExportButton type="premium_by_month" label="CSV" />}>
          <QueryState query={premium} skeleton={chartSkeleton}>
            {(rows) => (
              <div className="h-72" role="img" aria-label="Начисленная премия по месяцам за 12 месяцев">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={rows.map((r) => ({ ...r, label: `${MONTHS[Number(r.month.slice(5)) - 1]} ${r.month.slice(2, 4)}` }))}>
                    <CartesianGrid vertical={false} stroke={GRID} />
                    <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={12} />
                    <YAxis tickFormatter={money} tickLine={false} axisLine={false} fontSize={12} width={64} />
                    <RTooltip formatter={(v: number) => [formatMoney(v), 'Премия']} />
                    <Line type="monotone" dataKey="premium" stroke={ACCENT} strokeWidth={2} dot={{ r: 3 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </QueryState>
        </Card>
      </div>
      <Card title="Ассистансы: убыточность, выплаты и стоимость обслуживания" bodyClassName="p-0">
        <QueryState query={byAssistance}>
          {(rows) => (
            <table className="w-full text-left" data-testid="report-by-assistance">
              <caption className="sr-only">Отчёт по ассистансам</caption>
              <thead className="text-[12px] text-muted">
                <tr>
                  <th className="px-4 py-2 font-medium">Ассистанс</th>
                  <th className="px-4 py-2 text-right font-medium">Застрахованных</th>
                  <th className="px-4 py-2 text-right font-medium">Премия</th>
                  <th className="px-4 py-2 text-right font-medium">Выплаты</th>
                  <th className="px-4 py-2 text-right font-medium">Убыточность</th>
                  <th className="px-4 py-2 text-right font-medium">Вознаграждение</th>
                  <th className="px-4 py-2 text-right font-medium">На застрахованного</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.assistanceId ?? 'mig'} className="border-t border-border-soft">
                    <td className="px-4 py-1.5 font-medium">{r.name}</td>
                    <td className="num px-4 py-1.5 text-right">{formatNumber(r.insuredCount)}</td>
                    <td className="num px-4 py-1.5 text-right">{formatMoney(r.premium)}</td>
                    <td className="num px-4 py-1.5 text-right">{formatMoney(r.paid)}</td>
                    <td className={`num px-4 py-1.5 text-right ${(r.lossRatio ?? 0) >= 0.8 ? 'text-warning-text' : ''}`}>{r.lossRatio === null ? '—' : formatPercent(r.lossRatio)}</td>
                    <td className="num px-4 py-1.5 text-right">{r.assistanceId ? formatMoney(r.fee) : '—'}</td>
                    <td className="num px-4 py-1.5 text-right">{r.feePerInsured === null ? '—' : formatMoney(r.feePerInsured)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </QueryState>
      </Card>
      <p className="text-[12px] text-muted">Проценты убыточности: {formatPercent(0.8)} и выше отмечены оранжевым.</p>
    </div>
  );
}
