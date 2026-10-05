import { t } from '@/i18n';
import { AlertTriangle } from 'lucide-react';
import type { LimitUsage } from '@/shared/types';
import { LIMIT_CATEGORY_LABEL } from '@/shared/domain/labels';
import { isNearLimit } from '@/shared/domain/limits';
import { formatMoney } from '@/shared/lib/format';
import { ProgressBar } from '@/shared/ui/chips';
import { useDmsParam } from '@/shared/api/queries/params';

export function LimitBars({ limits }: { limits: LimitUsage[] }) {
  const lowShare = useDmsParam('limitLowShare');
  const near = limits.filter((l) => isNearLimit(l.used, l.limit, lowShare));
  return (
    <div className="flex flex-col gap-3">
      {near.length > 0 && (
        <div role="status" className="flex items-start gap-2 rounded-btn bg-warning-soft px-3 py-2 text-warning-text">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>
            {t('staff.limits.nearWarning', { categories: near.map((l) => LIMIT_CATEGORY_LABEL[l.category]).join(', ') })}
          </span>
        </div>
      )}
      {limits.map((l) => {
        const warn = isNearLimit(l.used, l.limit, lowShare);
        return (
          <div key={l.category}>
            <div className="mb-1 flex justify-between gap-2">
              <span>{LIMIT_CATEGORY_LABEL[l.category]}</span>
              <span className={warn ? 'text-warning-text num' : 'text-muted num'}>
                {formatMoney(l.used, false)} / {formatMoney(l.limit)}
              </span>
            </div>
            <ProgressBar value={l.used} max={l.limit} warn={warn} label={t('staff.limits.barLabel', { category: LIMIT_CATEGORY_LABEL[l.category] })} />
            {(l.reserved ?? 0) > 0 && (
              <div className="mt-0.5 flex justify-between gap-2 text-[12px] text-muted" data-testid={`reserved-${l.category}`}>
                <span>{t('staff.limits.reservedGl')}</span>
                <span className="num">{t('staff.limits.reservedRest', { reserved: formatMoney(l.reserved ?? 0), rest: formatMoney(Math.max(0, l.limit - l.used - (l.reserved ?? 0))) })}</span>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
