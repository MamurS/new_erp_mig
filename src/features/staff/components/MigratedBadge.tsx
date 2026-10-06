/* «Перенесено из старой системы»: date and author of the transfer, the number in the previous system. */
import { t } from '@/i18n';
import { History } from 'lucide-react';
import type { MigrationMark } from '@/shared/types';
import { formatDate } from '@/shared/lib/format';
import { Chip } from '@/shared/ui/chips';

export function MigratedBadge({ mark, oldNumber, oldCertificate }: { mark?: MigrationMark; oldNumber?: string; oldCertificate?: string }) {
  if (!mark) return null;
  return (
    <span data-testid="migrated-mark" className="inline-flex flex-wrap items-center gap-1.5 text-[12px] font-normal">
      <Chip kind="sky">
        <History className="h-3 w-3" aria-hidden /> {t('migration.mark')}
      </Chip>
      <span className="text-muted">{t('migration.markDetail', { date: formatDate(mark.at), name: mark.byName })}</span>
      {oldNumber && <Chip className="num">{t('migration.oldNumberChip', { number: oldNumber })}</Chip>}
      {oldCertificate && <Chip className="num">{t('migration.oldCertificate', { number: oldCertificate })}</Chip>}
    </span>
  );
}
