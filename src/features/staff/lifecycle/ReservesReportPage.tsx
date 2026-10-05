/* Отчёт по резервам (LIFECYCLE_SPEC §13): reserves of open claims on a date by client, assistance and category. */
import { defineLabels, t } from '@/i18n';
import { useState } from 'react';
import { Download } from 'lucide-react';
import type { ReserveReportRow } from '@/shared/types/dto';
import { fetchClaimsRegister, useReserveReport } from '@/shared/api/queries/lifecycle';
import { errorMessage } from '@/shared/api/client';
import { useCan } from '@/shared/auth/guards';
import { downloadText, exportFileName, toCsv } from '@/shared/lib/csv';
import { formatMoney, formatNumber, todayISO } from '@/shared/lib/format';
import { useDocumentTitle } from '@/shared/lib/hooks';
import { Button } from '@/shared/ui/button';
import { Field, Input } from '@/shared/ui/input';
import { Card, PageHeader } from '@/shared/ui/page';
import { QueryState } from '@/shared/ui/states';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/ui/tabs';
import { toast } from '@/shared/ui/toast';
import { useTopbar } from '../topbar';
import { TableScroll } from '@/shared/ui/table-scroll';

const GROUP_IDS = ['byClient', 'byAssistance', 'byCategory'] as const;
type Group = (typeof GROUP_IDS)[number];
const GROUPS = defineLabels('staffLc.reserves.group', GROUP_IDS);

function Rows({ rows, total }: { rows: ReserveReportRow[]; total: number }) {
  return (
    <TableScroll>
    <table className="w-full text-[13px]">
      <caption className="sr-only">{t('staffLc.reserves.short')}</caption>
      <thead>
        <tr className="text-left text-[12px] text-muted">
          <th className="px-4 py-2 font-medium">{t('staffLc.reserves.colGroup')}</th>
          <th className="px-2 py-2 text-right font-medium">{t('staffLc.reserves.colClaims')}</th>
          <th className="px-2 py-2 text-right font-medium">{t('staffLc.reserves.colReserve')}</th>
          <th className="px-4 py-2 text-right font-medium">{t('staffLc.reserves.colShare')}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.key} className="border-b border-border-soft">
            <td className="px-4 py-1.5">{r.label}</td>
            <td className="num px-2 py-1.5 text-right">{formatNumber(r.claims)}</td>
            <td className="num px-2 py-1.5 text-right">{formatMoney(r.reserve)}</td>
            <td className="num px-4 py-1.5 text-right">{total ? `${Math.round((r.reserve / total) * 100)}%` : '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
    </TableScroll>
  );
}

export default function ReservesReportPage() {
  useDocumentTitle(t('staffLc.reserves.short'));
  useTopbar([{ label: t('staffLc.reserves.short') }]);
  const [date, setDate] = useState(todayISO());
  const [group, setGroup] = useState<Group>('byClient');
  const q = useReserveReport(date);
  const canExport = useCan('exports.create');
  const canClaims = useCan('claims.read');
  const canRegister = canExport && canClaims;

  const exportCsv = () => {
    const r = q.data;
    if (!r) return;
    downloadText(toCsv(['group', 'claims', 'reserve'], r[group].map((x) => [x.label, x.claims, x.reserve])), exportFileName(`reserves-${group}`));
  };
  const register = async () => {
    try {
      downloadText(await fetchClaimsRegister(), exportFileName('claims-register'));
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <>
      <PageHeader
        title={t('staffLc.reserves.title')}
        subtitle={t('staffLc.reserves.subtitle')}
        actions={
          <>
            <Button variant="secondary" size="sm" onClick={exportCsv} disabled={!q.data}>
              <Download className="h-3.5 w-3.5" aria-hidden /> CSV
            </Button>
            {canRegister && (
              <Button variant="secondary" size="sm" onClick={() => void register()}>
                <Download className="h-3.5 w-3.5" aria-hidden /> {t('staffLc.reserves.claimsRegister')}
              </Button>
            )}
          </>
        }
      />
      <div className="mb-3 max-w-[200px]">
        <Field label={t('staffLc.reserves.onDate')}>{(a) => <Input {...a} type="date" value={date} max={todayISO()} onChange={(e) => e.target.value && setDate(e.target.value)} />}</Field>
      </div>
      <QueryState query={q}>
        {(r) => (
          <>
            <div className="mb-4 grid gap-3 sm:grid-cols-2">
              <Card>
                <p className="text-[12px] text-muted">{t('staffLc.reserves.totalOnDate')}</p>
                <p className="num text-[22px] font-bold" data-testid="reserve-total">
                  {formatMoney(r.total)}
                </p>
              </Card>
              <Card>
                <p className="text-[12px] text-muted">{t('staffLc.reserves.openClaims')}</p>
                <p className="num text-[22px] font-bold">{formatNumber(r.claims)}</p>
              </Card>
            </div>
            <Tabs value={group} onValueChange={(v) => setGroup(v as Group)}>
              <TabsList>
                {(Object.keys(GROUPS) as Group[]).map((g) => (
                  <TabsTrigger key={g} value={g}>
                    {GROUPS[g]}
                  </TabsTrigger>
                ))}
              </TabsList>
              {(Object.keys(GROUPS) as Group[]).map((g) => (
                <TabsContent key={g} value={g}>
                  <div className="rounded-card border border-border bg-surface">
                    <Rows rows={r[g]} total={r.total} />
                  </div>
                </TabsContent>
              ))}
            </Tabs>
          </>
        )}
      </QueryState>
    </>
  );
}
