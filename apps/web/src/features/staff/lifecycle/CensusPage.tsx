/* Данные для оценки (LIFECYCLE_SPEC §4): anonymous census — gender, birth year and relation only. */
import { useDmsParamValues } from '@/shared/api/queries/params';
import { belowMin, groupLabel, groupRulesOf } from '@mig/domain/minGroup';
import { cn } from '@/shared/lib/cn';
import { t, tm } from '@/i18n';
import { useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Download } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useDeal, useUploadCensus } from '@/shared/api/queries/lifecycle';
import { errorMessage } from '@/shared/api/client';
import { useCan } from '@/shared/auth/guards';
import { CENSUS_COLUMNS, CENSUS_MAX_BYTES, censusStats, censusTemplateCsv } from '@mig/domain/census';
import { AGE_BAND_LABEL } from '@mig/domain/tariff';
import { downloadText } from '@/shared/lib/csv';
import { formatDateTime, formatNumber, formatPercent, todayISO } from '@mig/domain/lib/format';
import { useDocumentTitle } from '@/shared/lib/hooks';
import { Button } from '@/shared/ui/button';
import { Card, PageHeader } from '@/shared/ui/page';
import { EmptyState, QueryState } from '@/shared/ui/states';
import { AskButton, HelpMore, RequestHrButton, roleName } from '@/features/next/NextActions';
import { toast } from '@/shared/ui/toast';
import { useTopbar } from '../topbar';
import { CsvFileButton } from './common';

const ACCENT = '#4f46e5';
const SOFT = '#a5b4fc';

export default function CensusPage() {
  const { dealId = '' } = useParams();
  const navigate = useNavigate();
  const q = useDeal(dealId);
  const upload = useUploadCensus();
  const canUpload = useCan('census.upload');
  // «Загрузить данные для оценки» of an empty section leads here with ?upload=1: the picker is focused.
  const [params] = useSearchParams();
  const focusUpload = params.get('upload') === '1';
  const rules = groupRulesOf(useDmsParamValues());
  const [result, setResult] = useState<{ errors: { row: number; message: string }[]; dropped: string[] } | null>(null);
  useDocumentTitle(t('staffLc.census.title'));
  useTopbar([{ label: t('staffLc.deals.title'), to: '/staff/deals' }, { label: q.data?.number ?? t('staffLc.deal.fallback'), to: `/staff/deals/${dealId}` }, { label: t('staffLc.census.title') }]);

  const onText = async (csv: string) => {
    try {
      const r = await upload.mutateAsync({ dealId, csv });
      setResult({ errors: r.errors, dropped: r.dropped });
      toast.success(t('staffLc.census.uploaded', { n: r.census.rows.length }));
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <QueryState query={q}>
      {(deal) => {
        const stats = deal.census ? censusStats(deal.census.rows, deal.expectedStart ?? todayISO()) : null;
        const closed = deal.stage === 'lost' || deal.stage === 'active';
        return (
          <>
            <PageHeader
              title={t('staffLc.census.title')}
              subtitle={t('staffLc.census.subtitle', { client: deal.clientName, number: deal.number })}
              actions={
                <Button variant="secondary" onClick={() => navigate(`/staff/deals/${deal.id}`)}>
                  {t('staffLc.census.toDeal')}
                </Button>
              }
            />
            <Card title={t('staffLc.census.file')}>
              <p className="text-[13px] text-muted">
                {t('staffLc.census.fileHelp', { columns: CENSUS_COLUMNS.join(', ') })}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button variant="secondary" size="sm" onClick={() => downloadText(censusTemplateCsv(), 'census-template.csv')}>
                  <Download className="h-3.5 w-3.5" aria-hidden /> {t('staffLc.census.downloadTemplate')}
                </Button>
                {canUpload && !closed && (
                  <CsvFileButton
                    label={deal.census ? t('staffLc.census.reupload') : t('staffLc.census.uploadCsv')}
                    ariaLabel={t('staffLc.census.fileAria')}
                    busy={upload.isPending}
                    maxBytes={CENSUS_MAX_BYTES}
                    onText={(text) => void onText(text)}
                    focus={focusUpload && !deal.census}
                    testId="census-upload"
                  />
                )}
              </div>
              {result && result.dropped.length > 0 && (
                <p role="alert" className="mt-3 rounded-btn bg-warning-soft px-3 py-2 text-[13px] text-warning-text" data-testid="census-dropped">
                  {t('staffLc.census.dropped', { columns: result.dropped.join(', ') })}
                </p>
              )}
              {result && result.errors.length > 0 && (
                <div className="mt-3 rounded-btn bg-danger-soft px-3 py-2 text-[13px] text-danger-text">
                  <p className="font-medium">{t('staffLc.census.errorRows', { n: result.errors.length })}</p>
                  <ul className="mt-1 list-disc pl-5">
                    {result.errors.slice(0, 10).map((e) => (
                      <li key={`${e.row}-${e.message}`}>
                        {t('staffLc.census.rowError', { row: e.row, message: tm(e.message) })}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </Card>
            {stats && deal.census ? (
              <>
              {(() => {
                // «Сотрудников N из минимума M»: below the minimum the quote needs an exception.
                const counts = { employees: stats.employees, family: stats.family };
                const below = belowMin(counts, rules);
                return (
                  <p
                    role={below ? 'alert' : 'status'}
                    data-testid="census-min-group"
                    data-below={below || undefined}
                    className={cn('mt-4 rounded-card px-3 py-2 text-[13px]', below ? 'bg-danger-soft font-semibold text-danger-text' : 'bg-rail text-muted')}
                  >
                    {tm(groupLabel(counts, rules))}
                    {below && ` — ${t('staffLc.census.belowMin')}`}
                  </p>
                );
              })()}
              <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_300px]">
                <Card title={t('staffLc.census.byAge')}>
                  <div className="h-72" role="img" aria-label={t('staffLc.census.chartAria')}>
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={stats.bands.map((b) => ({ name: AGE_BAND_LABEL[b.band], employees: b.employees, family: b.family }))}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} />
                        <XAxis dataKey="name" fontSize={12} />
                        <YAxis allowDecimals={false} fontSize={12} />
                        <Tooltip />
                        <Legend />
                        <Bar dataKey="employees" name={t('staffLc.census.employees')} stackId="a" fill={ACCENT} />
                        <Bar dataKey="family" name={t('staffLc.census.family')} stackId="a" fill={SOFT} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </Card>
                <Card title={t('staffLc.census.summary')}>
                  <dl className="grid gap-2 text-[13px]" data-testid="census-stats">
                    <div className="flex justify-between"><dt className="text-muted">{t('staffLc.census.total')}</dt><dd className="num font-semibold">{formatNumber(stats.total)}</dd></div>
                    <div className="flex justify-between"><dt className="text-muted">{t('staffLc.census.employeesCount')}</dt><dd className="num">{formatNumber(stats.employees)}</dd></div>
                    <div className="flex justify-between"><dt className="text-muted">{t('staffLc.census.familyCount')}</dt><dd className="num">{formatNumber(stats.family)}</dd></div>
                    <div className="flex justify-between"><dt className="text-muted">{t('staffLc.census.male')}</dt><dd className="num">{formatPercent(stats.maleShare)}</dd></div>
                    <div className="flex justify-between"><dt className="text-muted">{t('staffLc.census.female')}</dt><dd className="num">{formatPercent(stats.femaleShare)}</dd></div>
                    <div className="flex justify-between"><dt className="text-muted">{t('staffLc.census.avgAge')}</dt><dd className="num">{String(stats.averageAge).replace('.', ',')}</dd></div>
                  </dl>
                  <p className="mt-3 text-[12px] text-muted">{t('staffLc.census.uploadedAt', { at: formatDateTime(deal.census.uploadedAt) })}</p>
                </Card>
              </div>
              </>
            ) : (
              <Card className="mt-4" bodyClassName="p-0">
                <EmptyState
                  testId="census-next"
                  title={t('next.census.title')}
                  why={t('next.census.why')}
                  next={t('next.census.next', { role: roleName('sales_manager') })}
                  actions={
                    !canUpload && !closed ? (
                      <AskButton role="sales_manager" action="census_upload" subjectType="deal" subjectId={deal.id} />
                    ) : canUpload && !closed ? (
                      <RequestHrButton hasHr={deal.hasHr} clientName={deal.clientName} action="census_upload" subjectType="deal" subjectId={deal.id} />
                    ) : undefined
                  }
                  template={{ onDownload: () => downloadText(censusTemplateCsv(), 'census-template.csv') }}
                  help={<HelpMore article="new-client" section="census" />}
                />
              </Card>
            )}
          </>
        );
      }}
    </QueryState>
  );
}
