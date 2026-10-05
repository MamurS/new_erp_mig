import { t } from '@/i18n';
import { FileText } from 'lucide-react';
import { formatDate } from '@/shared/lib/format';
import { EmptyState } from '@/shared/ui/states';

export function DocumentsList({ docs }: { docs: { id: string; title: string; createdAt: string }[] }) {
  if (docs.length === 0) return <EmptyState title={t('staff.docs.empty')} />;
  return (
    <ul className="divide-y divide-border-soft">
      {docs.map((d) => (
        <li key={d.id} className="flex items-center gap-2 px-4 py-2.5">
          <FileText className="h-4 w-4 text-muted" aria-hidden />
          <span className="flex-1">{d.title}</span>
          <span className="text-[12px] text-muted">{formatDate(d.createdAt)}</span>
        </li>
      ))}
    </ul>
  );
}
