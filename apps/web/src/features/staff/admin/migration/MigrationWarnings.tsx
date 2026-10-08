/*
 * Marks of a transferred record that does not meet the rules for new contracts: «Ниже минимальной
 * численности» and/or «Форма не допускается». The record is in force and was transferred as it is; the
 * explanation (tooltip, also read by screen readers) says the rule applies to new contracts.
 */
import { t } from '@/i18n';
import { TriangleAlert } from 'lucide-react';
import type { MigrationMark, MigrationWarning } from '@mig/contracts';
import { Chip } from '@/shared/ui/chips';
import { Tooltip } from '@/shared/ui/tooltip';

const ORDER: readonly MigrationWarning[] = ['below_min_group', 'form_not_allowed'];

function hintOf(w: MigrationWarning, mark: MigrationMark, of: 'contract' | 'client'): string {
  if (w === 'form_not_allowed') return t('migration.warn.formHint');
  const g = mark.group;
  if (of === 'client' || !g) return t('migration.warn.belowMinHintClient');
  return t(g.countsFamily ? 'migration.warn.belowMinHintFamily' : 'migration.warn.belowMinHint', { n: g.size, min: g.min });
}

export function MigrationWarnings({ mark, of = 'contract' }: { mark?: MigrationMark; of?: 'contract' | 'client' }) {
  const list = ORDER.filter((w) => mark?.warnings?.includes(w));
  if (!mark || list.length === 0) return null;
  return (
    <span data-testid="migration-warnings" role="group" aria-label={t('migration.warn.group')} className="inline-flex flex-wrap items-center gap-1.5 text-[12px] font-normal">
      {list.map((w) => {
        const hint = hintOf(w, mark, of);
        return (
          <Tooltip key={w} content={hint}>
            <span tabIndex={0} data-testid={`migration-warning-${w}`} className="rounded-btn focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent">
              <Chip kind="warning">
                <TriangleAlert className="h-3 w-3" aria-hidden /> {t(`migration.warn.${w}`)}
                <span className="sr-only">. {hint}</span>
              </Chip>
            </span>
          </Tooltip>
        );
      })}
    </span>
  );
}
