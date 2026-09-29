import { AlertTriangle } from 'lucide-react';
import type { LimitUsage } from '@/shared/types';
import { LIMIT_CATEGORY_LABEL } from '@/shared/domain/labels';
import { isNearLimit } from '@/shared/domain/limits';
import { formatMoney } from '@/shared/lib/format';
import { ProgressBar } from '@/shared/ui/chips';

export function LimitBars({ limits }: { limits: LimitUsage[] }) {
  const near = limits.filter((l) => isNearLimit(l.used, l.limit));
  return (
    <div className="flex flex-col gap-3">
      {near.length > 0 && (
        <div role="status" className="flex items-start gap-2 rounded-btn bg-warning-soft px-3 py-2 text-warning-text">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>
            Лимит почти израсходован: {near.map((l) => LIMIT_CATEGORY_LABEL[l.category]).join(', ')}. Уточните у клиента, нужна ли доплата или
            изменение лимита.
          </span>
        </div>
      )}
      {limits.map((l) => {
        const warn = isNearLimit(l.used, l.limit);
        return (
          <div key={l.category}>
            <div className="mb-1 flex justify-between gap-2">
              <span>{LIMIT_CATEGORY_LABEL[l.category]}</span>
              <span className={warn ? 'text-warning-text num' : 'text-muted num'}>
                {formatMoney(l.used, false)} / {formatMoney(l.limit)}
              </span>
            </div>
            <ProgressBar value={l.used} max={l.limit} warn={warn} label={`Лимит «${LIMIT_CATEGORY_LABEL[l.category]}»`} />
          </div>
        );
      })}
    </div>
  );
}
