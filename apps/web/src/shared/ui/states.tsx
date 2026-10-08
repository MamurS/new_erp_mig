import { t } from '@/i18n';
import type { ReactNode } from 'react';
import { AlertCircle, Download, Inbox } from 'lucide-react';
import { cn } from '@/shared/lib/cn';
import { errorMessage } from '@/shared/api/client';
import { Button } from './button';

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn('animate-pulse rounded-btn bg-rail', className)} />;
}

export function SkeletonRows({ rows = 6, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn('flex flex-col gap-2 p-3', className)} role="status" aria-label={t('common.loading')}>
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-7 w-full" />
      ))}
    </div>
  );
}

/**
 * An empty list, tab or section. Two kinds (docs/DECISIONS.md «Пустые состояния со следующим шагом»):
 * - nothing matches («Ничего не найдено», filters) — `title` and `description`;
 * - nothing was entered yet — `title`, `why` (why it is empty for this stage and status), `next` (what to do
 *   and who does it), `actions` (the action itself when the person may do it, otherwise «Попросить {роль}» /
 *   «Запросить у HR»), `template` («Скачать шаблон» when a file is expected) and `help` («Подробнее в
 *   справке»). The texts come from the page: one component, the wording per place.
 */
export function EmptyState({
  title,
  description,
  action,
  icon,
  className,
  why,
  next,
  actions,
  template,
  help,
  testId,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  icon?: ReactNode;
  className?: string;
  why?: ReactNode;
  next?: ReactNode;
  actions?: ReactNode;
  template?: { onDownload: () => void; label?: string };
  help?: ReactNode;
  testId?: string;
}) {
  const nextStep = why !== undefined || next !== undefined;
  return (
    <div data-testid={testId} data-empty={nextStep ? 'next' : 'none'} className={cn('flex flex-col items-center justify-center gap-2 px-6 py-10 text-center', className)}>
      <div className="text-muted">{icon ?? <Inbox className="h-8 w-8" aria-hidden />}</div>
      <p className="font-semibold">{title}</p>
      {description && <p className="max-w-sm text-muted">{description}</p>}
      {why && <p className="max-w-md text-muted" data-testid="empty-why">{why}</p>}
      {next && <p className="max-w-md" data-testid="empty-next">{next}</p>}
      {(action || actions) && (
        <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
          {action}
          {actions}
        </div>
      )}
      {(template || help) && (
        <div className="mt-1 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-[13px]">
          {template && (
            <button type="button" onClick={template.onDownload} className="inline-flex items-center gap-1 text-accent-text underline-offset-2 hover:underline">
              <Download className="h-3.5 w-3.5" aria-hidden />
              {template.label ?? t('next.template')}
            </button>
          )}
          {help}
        </div>
      )}
    </div>
  );
}

export function ErrorState({ error, onRetry, className }: { error: unknown; onRetry?: () => void; className?: string }) {
  return (
    <div role="alert" className={cn('flex flex-col items-center justify-center gap-2 px-6 py-10 text-center', className)}>
      <AlertCircle className="h-8 w-8 text-danger" aria-hidden />
      <p className="font-semibold">{t('shell.loadFailed')}</p>
      <p className="max-w-sm text-muted">{errorMessage(error)}</p>
      {onRetry && (
        <Button variant="secondary" onClick={onRetry} className="mt-2">
          {t('common.retry')}
        </Button>
      )}
    </div>
  );
}

/** Renders loading / error / content for a query. */
export function QueryState<T>({
  query,
  children,
  skeleton,
}: {
  query: { data: T | undefined; isLoading: boolean; isError: boolean; error: unknown; refetch: () => unknown };
  children: (data: T) => ReactNode;
  skeleton?: ReactNode;
}) {
  if (query.isLoading) return <>{skeleton ?? <SkeletonRows />}</>;
  if (query.isError || query.data === undefined) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  return <>{children(query.data)}</>;
}
