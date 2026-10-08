/* Shared building blocks of the insured app (client theme, i18n-only text). */
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertCircle,
  Baby,
  Brain,
  ChevronLeft,
  Ear,
  Eye,
  Flower2,
  HeartPulse,
  Inbox,
  Smile,
  Stethoscope,
  type LucideIcon,
} from 'lucide-react';
import { useI18n } from '@/i18n';
import type { MyClaim, Specialty } from '@mig/contracts';
import { errorMessage } from '@/shared/api/client';
import { cn } from '@/shared/lib/cn';
import { Button } from '@/shared/ui/button';
import { Skeleton } from '@/shared/ui/states';
import { CLAIM_STEP_KEYS, doneSteps } from './lib';

/** Large primary/secondary button sizing for the client theme (46–54 px). */
export const BIG = 'h-12 w-full rounded-btn px-5 text-[15px] font-semibold';

export const SPECIALTY_ICON: Record<Specialty, LucideIcon> = {
  therapist: Stethoscope,
  pediatrician: Baby,
  dentist: Smile,
  cardiologist: HeartPulse,
  gynecologist: Flower2,
  ent: Ear,
  neurologist: Brain,
  ophthalmologist: Eye,
};

/** Screen title with an optional back button. */
export function ScreenHeader({ title, back, right }: { title: string; back?: string | (() => void); right?: ReactNode }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  return (
    <header className="mb-4 flex items-center gap-2">
      {back !== undefined && (
        <button
          type="button"
          aria-label={t('app.common.back')}
          onClick={() => (typeof back === 'function' ? back() : navigate(back))}
          className="-ml-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-text hover:bg-rail"
        >
          <ChevronLeft className="h-6 w-6" aria-hidden />
        </button>
      )}
      <h1 className="min-w-0 flex-1 truncate font-heading text-[22px] font-semibold leading-tight">{title}</h1>
      {right}
    </header>
  );
}

/** Horizontal four-step bar of a refund. */
export function ClaimStepBar({ claim, className }: { claim: Pick<MyClaim, 'steps' | 'status'>; className?: string }) {
  const { t } = useI18n();
  const done = doneSteps(claim);
  const rejected = claim.status === 'rejected';
  return (
    <div className={cn('flex gap-1.5', className)} role="img" aria-label={`${t('app.claims.steps')}: ${done} / 4`}>
      {CLAIM_STEP_KEYS.map((k, i) => (
        <span
          key={k}
          className={cn('h-1.5 flex-1 rounded-full', i < done ? (rejected ? 'bg-danger' : 'bg-accent') : 'bg-rail')}
        />
      ))}
    </div>
  );
}

/** Tone of the plain-language claim status. */
export function claimTone(status: MyClaim['status']): string {
  switch (status) {
    case 'approved':
    case 'paid':
      return 'bg-accent-soft text-accent-text';
    case 'rejected':
      return 'bg-danger-soft text-danger-text';
    case 'checking':
      return 'bg-sun text-sun-text';
    default:
      return 'bg-sky text-sky-text';
  }
}

export function StatusPill({ status }: { status: MyClaim['status'] }) {
  const { t } = useI18n();
  return (
    <span className={cn('inline-flex items-center rounded-full px-2.5 py-1 text-[13px] font-bold', claimTone(status))}>
      {t(`app.claimStatus.${status}`)}
    </span>
  );
}

/** Wizard step indicator: «Шаг 2 из 3» + labelled segments. */
export function WizardSteps({ labels, current }: { labels: string[]; current: number }) {
  const { t } = useI18n();
  return (
    <div className="mb-5">
      <p className="mb-2 text-[13px] font-semibold text-muted">{t('app.common.stepOf', { n: current + 1, total: labels.length })}</p>
      <ol className="flex gap-2">
        {labels.map((l, i) => (
          <li key={l} className="flex-1" aria-current={i === current ? 'step' : undefined}>
            <span className={cn('block h-1.5 rounded-full', i <= current ? 'bg-accent' : 'bg-rail')} />
            <span className={cn('mt-1 block truncate text-[12px]', i === current ? 'font-bold text-text' : 'text-muted')}>{l}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function LoadError({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const { t } = useI18n();
  return (
    <div role="alert" className="flex flex-col items-center gap-2 rounded-card border border-border bg-surface px-5 py-8 text-center">
      <AlertCircle className="h-8 w-8 text-danger" aria-hidden />
      <p className="font-bold">{t('app.common.loadErrorTitle')}</p>
      <p className="text-muted">{error ? errorMessage(error) : t('app.common.loadError')}</p>
      {onRetry && (
        <Button variant="secondary" onClick={onRetry} className="mt-2 h-11 rounded-btn px-5 text-[15px]">
          {t('app.common.retry')}
        </Button>
      )}
    </div>
  );
}

/**
 * An empty list or section. With `why` (why it is empty and what happens next) and `help` («Подробнее в
 * справке», a contact) it is an empty state with a next step (DECISIONS «Пустые состояния»).
 */
export function Empty({ title, action, icon, why, help, testId }: { title: string; action?: ReactNode; icon?: ReactNode; why?: ReactNode; help?: ReactNode; testId?: string }) {
  return (
    <div data-testid={testId} data-empty={why !== undefined ? 'next' : 'none'} className="flex flex-col items-center gap-3 rounded-card border border-dashed border-border bg-surface px-5 py-8 text-center">
      <span className="text-muted">{icon ?? <Inbox className="h-8 w-8" aria-hidden />}</span>
      <p className="max-w-xs text-muted">{title}</p>
      {why && (
        <p className="max-w-xs text-[14px]" data-testid="empty-why">
          {why}
        </p>
      )}
      {action}
      {help && <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-[14px]">{help}</div>}
    </div>
  );
}

export function CardSkeletons({ count = 3, className }: { count?: number; className?: string }) {
  const { t } = useI18n();
  return (
    <div role="status" aria-label={t('app.common.loading')} className={cn('flex flex-col gap-3', className)}>
      {Array.from({ length: count }, (_, i) => (
        <Skeleton key={i} className="h-24 w-full rounded-card" />
      ))}
    </div>
  );
}

export function Section({ title, action, children, className }: { title: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn('mt-6', className)}>
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <h2 className="font-heading text-[18px] font-semibold">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

/** Choice chip (≥44 px tall). */
export function ChoiceChip({
  selected,
  onClick,
  children,
  className,
  ...rest
}: {
  selected: boolean;
  onClick: () => void;
  children: ReactNode;
  className?: string;
  'aria-label'?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={cn(
        'min-h-[44px] shrink-0 rounded-btn border px-3.5 text-[14px] font-semibold transition-colors',
        selected ? 'border-accent bg-accent text-white' : 'border-border bg-surface text-text hover:border-accent',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}
