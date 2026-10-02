/* Данные для оценки (LIFECYCLE_SPEC §4): anonymous census — gender, birth year and relation only. */
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Download } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useDeal, useUploadCensus } from '@/shared/api/queries/lifecycle';
import { errorMessage } from '@/shared/api/client';
import { useCan } from '@/shared/auth/guards';
import { CENSUS_COLUMNS, CENSUS_MAX_BYTES, censusStats, censusTemplateCsv } from '@/shared/domain/census';
import { AGE_BAND_LABEL } from '@/shared/domain/tariff';
import { downloadText } from '@/shared/lib/csv';
import { formatDateTime, formatNumber, formatPercent, todayISO } from '@/shared/lib/format';
import { useDocumentTitle } from '@/shared/lib/hooks';
import { Button } from '@/shared/ui/button';
import { Card, PageHeader } from '@/shared/ui/page';
import { QueryState } from '@/shared/ui/states';
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
  const [result, setResult] = useState<{ errors: { row: number; message: string }[]; dropped: string[] } | null>(null);
  useDocumentTitle('Данные для оценки');
  useTopbar([{ label: 'Сделки', to: '/staff/deals' }, { label: q.data?.number ?? 'Сделка', to: `/staff/deals/${dealId}` }, { label: 'Данные для оценки' }]);

  const onText = async (csv: string) => {
    try {
      const r = await upload.mutateAsync({ dealId, csv });
      setResult({ errors: r.errors, dropped: r.dropped });
      toast.success(`Загружено строк: ${r.census.rows.length}`);
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
              title="Данные для оценки"
              subtitle={`${deal.clientName} · сделка ${deal.number}`}
              actions={
                <Button variant="secondary" onClick={() => navigate(`/staff/deals/${deal.id}`)}>
                  К сделке
                </Button>
              }
            />
            <Card title="Файл">
              <p className="text-[13px] text-muted">
                CSV в UTF-8 до 1 МБ, колонки: <code>{CENSUS_COLUMNS.join(', ')}</code>. Пол — <code>m</code> или <code>f</code>, тип — <code>employee</code>, <code>spouse</code> или <code>child</code>. Имена, ПИНФЛ и
                телефоны на этом этапе не принимаются: такие столбцы отбрасываются.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button variant="secondary" size="sm" onClick={() => downloadText(censusTemplateCsv(), 'census-template.csv')}>
                  <Download className="h-3.5 w-3.5" aria-hidden /> Скачать шаблон
                </Button>
                {canUpload && !closed && <CsvFileButton label={deal.census ? 'Загрузить заново' : 'Загрузить CSV'} ariaLabel="Файл с данными для оценки" busy={upload.isPending} maxBytes={CENSUS_MAX_BYTES} onText={(t) => void onText(t)} />}
              </div>
              {result && result.dropped.length > 0 && (
                <p role="alert" className="mt-3 rounded-btn bg-warning-soft px-3 py-2 text-[13px] text-warning-text" data-testid="census-dropped">
                  Столбцы с персональными данными отброшены и не сохранены: {result.dropped.join(', ')}
                </p>
              )}
              {result && result.errors.length > 0 && (
                <div className="mt-3 rounded-btn bg-danger-soft px-3 py-2 text-[13px] text-danger-text">
                  <p className="font-medium">Строки с ошибками пропущены: {result.errors.length}</p>
                  <ul className="mt-1 list-disc pl-5">
                    {result.errors.slice(0, 10).map((e) => (
                      <li key={`${e.row}-${e.message}`}>
                        Строка {e.row}: {e.message}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </Card>
            {stats && deal.census ? (
              <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_300px]">
                <Card title="Распределение по возрастным группам">
                  <div className="h-72" role="img" aria-label="Число сотрудников и членов семей по возрастным группам">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={stats.bands.map((b) => ({ name: AGE_BAND_LABEL[b.band], Сотрудники: b.employees, 'Члены семей': b.family }))}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} />
                        <XAxis dataKey="name" fontSize={12} />
                        <YAxis allowDecimals={false} fontSize={12} />
                        <Tooltip />
                        <Legend />
                        <Bar dataKey="Сотрудники" stackId="a" fill={ACCENT} />
                        <Bar dataKey="Члены семей" stackId="a" fill={SOFT} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </Card>
                <Card title="Сводка">
                  <dl className="grid gap-2 text-[13px]" data-testid="census-stats">
                    <div className="flex justify-between"><dt className="text-muted">Всего</dt><dd className="num font-semibold">{formatNumber(stats.total)}</dd></div>
                    <div className="flex justify-between"><dt className="text-muted">Сотрудников</dt><dd className="num">{formatNumber(stats.employees)}</dd></div>
                    <div className="flex justify-between"><dt className="text-muted">Членов семей</dt><dd className="num">{formatNumber(stats.family)}</dd></div>
                    <div className="flex justify-between"><dt className="text-muted">Мужчин</dt><dd className="num">{formatPercent(stats.maleShare)}</dd></div>
                    <div className="flex justify-between"><dt className="text-muted">Женщин</dt><dd className="num">{formatPercent(stats.femaleShare)}</dd></div>
                    <div className="flex justify-between"><dt className="text-muted">Средний возраст</dt><dd className="num">{String(stats.averageAge).replace('.', ',')}</dd></div>
                  </dl>
                  <p className="mt-3 text-[12px] text-muted">Загружено {formatDateTime(deal.census.uploadedAt)}. Возраст считается на дату начала страхования.</p>
                </Card>
              </div>
            ) : (
              <p className="mt-4 text-[13px] text-muted">Данные ещё не загружены.</p>
            )}
          </>
        );
      }}
    </QueryState>
  );
}
