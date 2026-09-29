import { useI18n } from '@/i18n';
import type { LimitUsage } from '@/shared/types';
import { formatMoney } from '@/shared/lib/format';
import { isNearLimit } from '@/shared/domain/limits';
import { cn } from '@/shared/lib/cn';

/** «Сколько осталось»: remaining per category, peach when ≥ 80 % used. */
export function LimitsList({ limits }: { limits: LimitUsage[] }) {
  const { t } = useI18n();
  return (
    <ul className="flex flex-col gap-2.5">
      {limits.map((l) => {
        const near = isNearLimit(l.used, l.limit);
        const left = Math.max(0, l.limit - l.used);
        const pct = l.limit > 0 ? Math.min(100, Math.round((l.used / l.limit) * 100)) : 0;
        return (
          <li key={l.category} className={cn('rounded-card border p-4', near ? 'border-peach bg-peach/40' : 'border-border bg-surface')}>
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-bold">{t(`category.${l.category}`)}</span>
              <span className="text-[13px] text-muted">{t('limit.of', { amount: formatMoney(l.limit) })}</span>
            </div>
            <p className="mt-1 font-heading text-[18px] font-semibold">
              {l.used === 0 ? t('limit.unused') : t('limit.left', { amount: formatMoney(left) })}
            </p>
            <div
              className="mt-2 h-2 w-full overflow-hidden rounded-full bg-rail"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={pct}
              aria-label={t(`category.${l.category}`)}
            >
              <div className={cn('h-full rounded-full', near ? 'bg-peach-text' : 'bg-accent')} style={{ width: `${pct}%` }} />
            </div>
            {near && <p className="mt-2 text-[13px] font-semibold text-peach-text">{t('limit.almostOut')}</p>}
          </li>
        );
      })}
    </ul>
  );
}
