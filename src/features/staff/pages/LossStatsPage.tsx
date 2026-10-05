/*
 * Loss statistics of a client for the underwriter (the «Убыточность» row of the queue): only aggregates —
 * sums, the loss ratio, categories and months. No claims, insured names or diagnoses.
 */
import { useParams } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis } from 'recharts';
import { useClientLossStats } from '@/shared/api/queries/staff';
import { formatMoney, formatMoneyShort, formatNumber, formatPercent } from '@/shared/lib/format';
import { useDocumentTitle } from '@/shared/lib/hooks';
import { Card, PageHeader } from '@/shared/ui/page';
import { EmptyState, QueryState } from '@/shared/ui/states';
import { MiniKpi } from '../components/KpiCard';
import { useTopbar } from '../topbar';

const MONTHS = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

export default function LossStatsPage() {
  const { clientId } = useParams();
  const q = useClientLossStats(clientId);
  useDocumentTitle('Убыточность клиента');
  useTopbar([{ label: 'Клиенты', to: '/staff/clients?view=loss' }, { label: q.data?.clientName ?? 'Клиент' }, { label: 'Убыточность' }]);

  return (
    <QueryState query={q}>
      {(s) => (
        <div data-testid="loss-stats">
          <PageHeader title={`Убыточность: ${s.clientName}`} subtitle="Только агрегаты за 12 месяцев: суммы, категории и месяцы. Отдельные убытки, застрахованные и диагнозы здесь не показываются." />
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <MiniKpi label="Премия" value={s.premium ? formatMoneyShort(s.premium) : '—'} />
            <MiniKpi label="Убытки (выплаты и заявленное)" value={formatMoneyShort(s.claimsAmount)} />
            <MiniKpi label="Убыточность" value={s.lossRatio === null ? '—' : formatPercent(s.lossRatio)} tone={(s.lossRatio ?? 0) >= s.lossRatioWarn ? 'warning' : 'default'} />
            <MiniKpi label="Обращений" value={formatNumber(s.claimsCount)} />
          </div>
          <p className="mt-2 text-[12px] text-muted">Порог внимания — {formatPercent(s.lossRatioWarn)} (параметр ДМС «Порог убыточности»).</p>
          <Card title="Убытки по месяцам" className="mt-4">
            <div className="h-64" role="img" aria-label="График суммы убытков по месяцам за последние 12 месяцев">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={s.byMonth.map((m) => ({ ...m, label: MONTHS[Number(m.month.slice(5)) - 1] }))}>
                  <CartesianGrid vertical={false} stroke="#eceef1" />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={12} />
                  <YAxis tickFormatter={(v: number) => formatMoneyShort(v).replace(' UZS', '')} tickLine={false} axisLine={false} fontSize={12} width={70} />
                  <RTooltip formatter={(v: number) => formatMoney(v)} labelFormatter={(l: string) => `Месяц: ${l}`} />
                  <Bar dataKey="amount" name="Сумма" fill="#4f46e5" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <table className="mt-3 w-full text-[13px]" data-testid="loss-by-month">
              <caption className="sr-only">Убытки по месяцам</caption>
              <thead>
                <tr className="border-b border-border text-left text-[12px] text-muted">
                  <th className="py-1.5 font-normal">Месяц</th>
                  <th className="py-1.5 text-right font-normal">Обращений</th>
                  <th className="py-1.5 text-right font-normal">Сумма</th>
                </tr>
              </thead>
              <tbody>
                {s.byMonth.map((m) => (
                  <tr key={m.month} className="border-b border-border-soft">
                    <td className="py-1.5">
                      {MONTHS[Number(m.month.slice(5)) - 1]} {m.month.slice(0, 4)}
                    </td>
                    <td className="py-1.5 text-right num">{formatNumber(m.count)}</td>
                    <td className="py-1.5 text-right num">{formatMoney(m.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
          <Card title="Убытки по категориям" className="mt-4" bodyClassName="p-0">
            {s.byCategory.length === 0 ? (
              <EmptyState title="Убытков нет" />
            ) : (
              <table className="w-full" data-testid="loss-by-category">
                <caption className="sr-only">Убытки по категориям</caption>
                <thead>
                  <tr className="border-b border-border text-left text-[12px] text-muted">
                    <th className="px-4 py-2 font-normal">Категория</th>
                    <th className="px-4 py-2 text-right font-normal">Обращений</th>
                    <th className="px-4 py-2 text-right font-normal">Сумма</th>
                    <th className="px-4 py-2 text-right font-normal">Доля</th>
                  </tr>
                </thead>
                <tbody>
                  {s.byCategory.map((r) => (
                    <tr key={r.category} className="h-11 border-b border-border-soft">
                      <td className="px-4">{r.category}</td>
                      <td className="px-4 text-right num">{formatNumber(r.count)}</td>
                      <td className="px-4 text-right num">{formatMoney(r.amount)}</td>
                      <td className="px-4 text-right num">{s.claimsAmount ? formatPercent(r.amount / s.claimsAmount) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </div>
      )}
    </QueryState>
  );
}
