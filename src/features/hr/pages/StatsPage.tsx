import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Lock, ShieldCheck } from 'lucide-react';
import type { HrStats, HrStatsSlice } from '@/shared/types/dto';
import { useHrStats } from '@/shared/api/queries/hr';
import { formatNumber } from '@/shared/lib/format';
import { useDocumentTitle } from '@/shared/lib/hooks';
import { ProgressBar } from '@/shared/ui/chips';
import { EmptyState, QueryState, Skeleton } from '@/shared/ui/states';
import { buttonVariants } from '@/shared/ui/button';
import { cn } from '@/shared/lib/cn';
import { HR_BTN, HrCard, HrHeader, HrSectionTitle } from '../ui';
import { useDmsParam } from '@/shared/api/queries/params';
import { limitWarnRatio } from '@/shared/config/dmsParameters';

const TOO_FEW = 'Слишком мало данных для показа';

function TooFew() {
  return (
    <p className="inline-flex items-center gap-1.5 text-[14px] text-muted">
      <Lock className="h-4 w-4 shrink-0" aria-hidden />
      {TOO_FEW}
    </p>
  );
}

function Kpi({ label, value, children }: { label: string; value: number | null; children?: ReactNode }) {
  return (
    <HrCard className="flex flex-col gap-2">
      <p className="text-muted">{label}</p>
      {value === null ? <TooFew /> : <p className="font-heading text-[32px] font-semibold leading-none num">{formatNumber(value)}</p>}
      {value !== null && children}
    </HrCard>
  );
}

function Slices({ title, slices, total }: { title: string; slices: HrStatsSlice[]; total: number }) {
  return (
    <HrCard>
      <HrSectionTitle className="mb-4">{title}</HrSectionTitle>
      <ul className="flex flex-col gap-4">
        {slices.map((s) => (
          <li key={s.label}>
            <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-2">
              <span className="font-semibold">{s.label}</span>
              {s.value === null ? <TooFew /> : <span className="num">{formatNumber(s.value)}</span>}
            </div>
            {s.value !== null && <ProgressBar value={s.value} max={total} label={s.label} className="h-2.5" />}
          </li>
        ))}
      </ul>
    </HrCard>
  );
}

function StatsView({ s }: { s: HrStats }) {
  const lowShare = useDmsParam('limitLowShare');
  if (s.insuredCount === 0) {
    return (
      <HrCard>
        <EmptyState
          title="Пока нечего показать"
          description="Статистика появится, когда в полис будут добавлены сотрудники"
          action={
            <Link to="/hr/employees/new" className={cn(buttonVariants({ variant: 'primary' }), HR_BTN)}>
              Добавить сотрудника
            </Link>
          }
        />
      </HrCard>
    );
  }
  return (
    <>
      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Застраховано сотрудников" value={s.insuredCount} />
        <Kpi label="Пользуются приложением" value={s.appUsers}>
          {s.appUsers !== null && s.insuredCount > 0 && (
            <p className="text-muted">{Math.round((s.appUsers / s.insuredCount) * 100)}% от застрахованных</p>
          )}
        </Kpi>
        <Kpi label="Обращений за квартал" value={s.claimsThisQuarter}>
          <p className="text-muted">Общее число по компании</p>
        </Kpi>
        <HrCard className="flex flex-col gap-2">
          <p className="text-muted">Использование бюджета программы</p>
          {s.budgetUsedPct === null ? (
            <TooFew />
          ) : (
            <>
              <p className="font-heading text-[32px] font-semibold leading-none num">{s.budgetUsedPct}%</p>
              <ProgressBar value={s.budgetUsedPct} max={100} warn={s.budgetUsedPct >= limitWarnRatio({ limitLowShare: lowShare }) * 100} label="Использование бюджета" className="mt-1 h-2.5" />
            </>
          )}
        </HrCard>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Slices title="По возрасту" slices={s.byAgeGroup} total={s.insuredCount} />
        <Slices title="По приложению" slices={s.byAppStatus} total={s.insuredCount} />
      </div>
    </>
  );
}

export default function StatsPage() {
  useDocumentTitle('Статистика');
  const stats = useHrStats();
  return (
    <>
      <HrHeader title="Статистика" subtitle="Только обезличенные итоги по компании" />
      <div className="mb-6 flex items-start gap-3 rounded-card bg-sky p-4 text-sky-text">
        <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
        <p>
          Мы показываем только общие цифры. Группы, в которых меньше {stats.data?.k ?? 10} человек, скрыты, чтобы нельзя было узнать данные
          конкретного сотрудника. Медицинской информации по отдельным людям здесь нет.
        </p>
      </div>
      <QueryState
        query={stats}
        skeleton={
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" role="status" aria-label="Загрузка">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-[132px] rounded-card" />
            ))}
          </div>
        }
      >
        {(s) => <StatsView s={s} />}
      </QueryState>
    </>
  );
}
