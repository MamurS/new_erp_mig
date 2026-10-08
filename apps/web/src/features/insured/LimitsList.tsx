import { useI18n } from '@/i18n';
import type { LimitUsage } from '@mig/contracts';
import { formatMoney } from '@mig/domain/lib/format';
import { isNearLimit } from '@mig/domain/limits';
import { limitLeft } from '@mig/domain/assistance';
import { cn } from '@/shared/lib/cn';
import { useDmsParam } from '@/shared/api/queries/params';

/** «Сколько осталось»: remaining per category, peach when the limit is running low (DMS parameter `limitLowShare`). */
export function LimitsList({ limits }: { limits: LimitUsage[] }) {
  const { t } = useI18n();
  const lowShare = useDmsParam('limitLowShare');
  return (
    <ul className="flex flex-col gap-2.5">
      {limits.map((l) => {
        // Approved guarantee letters reserve the limit until the clinic's line is accepted (ASSISTANCE_SPEC §5.2).
        const reserved = l.reserved ?? 0;
        const near = isNearLimit(l.used + reserved, l.limit, lowShare);
        const left = limitLeft(l.limit, l.used, reserved);
        const pct = l.limit > 0 ? Math.min(100, Math.round(((l.used + reserved) / l.limit) * 100)) : 0;
        return (
          <li key={l.category} className={cn('rounded-card border p-4', near ? 'border-peach bg-peach/40' : 'border-border bg-surface')}>
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-bold">{t(`app.category.${l.category}`)}</span>
              <span className="text-[13px] text-muted">{t('app.limit.of', { amount: formatMoney(l.limit) })}</span>
            </div>
            <p className="mt-1 font-heading text-[18px] font-semibold">
              {l.used === 0 && reserved === 0 ? t('app.limit.unused') : t('app.limit.left', { amount: formatMoney(left) })}
            </p>
            {reserved > 0 && (
              <p className="text-[13px] text-muted" data-testid={`limit-reserved-${l.category}`}>
                {t('app.limit.reserved', { amount: formatMoney(reserved) })}
              </p>
            )}
            <div
              className="mt-2 h-2 w-full overflow-hidden rounded-full bg-rail"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={pct}
              aria-label={t(`app.category.${l.category}`)}
            >
              <div className={cn('h-full rounded-full', near ? 'bg-peach-text' : 'bg-accent')} style={{ width: `${pct}%` }} />
            </div>
            {near && <p className="mt-2 text-[13px] font-semibold text-peach-text">{t('app.limit.almostOut')}</p>}
          </li>
        );
      })}
    </ul>
  );
}
