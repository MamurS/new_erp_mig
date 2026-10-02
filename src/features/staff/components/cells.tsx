import type { Claim, ClaimStatus } from '@/shared/types';
import { cn } from '@/shared/lib/cn';
import { daysUntil, formatDateTime, formatPercent, formatRelativeDays } from '@/shared/lib/format';
import { useDmsParam } from '@/shared/api/queries/params';

export function LossBar({ ratio }: { ratio: number | null }) {
  const warnFrom = useDmsParam('lossRatioWarn');
  if (ratio === null) return <span className="text-muted">—</span>;
  const warn = ratio >= warnFrom;
  return (
    <span className="inline-flex items-center gap-2">
      <span className="h-1.5 w-14 overflow-hidden rounded-full bg-rail" aria-hidden>
        <span className={cn('block h-full rounded-full', warn ? 'bg-warning' : 'bg-accent')} style={{ width: `${Math.min(100, ratio * 100 / 1.5)}%` }} />
      </span>
      <span className={cn('num', warn && 'font-semibold text-warning-text')}>{formatPercent(ratio)}</span>
    </span>
  );
}

export function RenewalCell({ date }: { date?: string }) {
  if (!date) return <span className="text-muted">—</span>;
  const d = daysUntil(date);
  return <span className={cn('whitespace-nowrap', d >= 0 && d <= 30 && 'font-medium text-warning-text', d < 0 && 'text-danger-text')}>{formatRelativeDays(date)}</span>;
}

const ACTIVE = new Set<ClaimStatus>(['new', 'review', 'medical_review']);

export function SlaCell({ claim }: { claim: Pick<Claim, 'slaDueAt' | 'status'> }) {
  if (!ACTIVE.has(claim.status)) return <span className="text-muted">—</span>;
  const d = daysUntil(claim.slaDueAt);
  const overdue = Date.parse(claim.slaDueAt) < Date.now();
  return (
    <span className={cn('whitespace-nowrap', overdue ? 'font-semibold text-danger-text' : d <= 1 && 'text-warning-text')} title={formatDateTime(claim.slaDueAt)}>
      {overdue ? `просрочен ${formatRelativeDays(claim.slaDueAt)}` : formatRelativeDays(claim.slaDueAt)}
    </span>
  );
}
