import type { ReactNode } from 'react';
import { cn } from '@/shared/lib/cn';
import { initials } from '@mig/domain/lib/format';

export type Tone = 'default' | 'success' | 'warning' | 'danger' | 'info' | 'accent' | 'muted';

const DOT: Record<Tone, string> = {
  default: 'bg-muted',
  muted: 'bg-border',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
  info: 'bg-info',
  accent: 'bg-accent',
};

/** Status = dot + text (SPEC §7.1). */
export function StatusDot({ tone, children, className }: { tone: Tone; children: ReactNode; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 whitespace-nowrap', className)}>
      <span className={cn('h-2 w-2 shrink-0 rounded-full', DOT[tone])} aria-hidden />
      {children}
    </span>
  );
}

const CHIP: Record<string, string> = {
  appointment: 'bg-chip-appt text-chip-appt-text',
  claim: 'bg-chip-claim text-chip-claim-text',
  renewal: 'bg-chip-renewal text-chip-renewal-text',
  neutral: 'bg-rail text-muted',
  accent: 'bg-accent-soft text-accent-text',
  success: 'bg-success-soft text-success-text',
  warning: 'bg-warning-soft text-warning-text',
  danger: 'bg-danger-soft text-danger-text',
  peach: 'bg-peach text-peach-text',
  sky: 'bg-sky text-sky-text',
  sun: 'bg-sun text-sun-text',
};

export function Chip({ kind = 'neutral', children, className }: { kind?: keyof typeof CHIP | string; children: ReactNode; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1 whitespace-nowrap rounded-btn px-2 py-0.5 text-[12px] font-medium', CHIP[kind] ?? CHIP.neutral, className)}>
      {children}
    </span>
  );
}

export function Avatar({ name, className, square }: { name: string; className?: string; square?: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        'inline-flex h-7 w-7 shrink-0 items-center justify-center bg-accent-soft text-[11px] font-semibold text-accent-text',
        square ? 'rounded-btn' : 'rounded-full',
        className,
      )}
    >
      {initials(name) || '•'}
    </span>
  );
}

export function ProgressBar({ value, max, warn, className, label }: { value: number; max: number; warn?: boolean; className?: string; label?: string }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div
      className={cn('h-2 w-full overflow-hidden rounded-full bg-rail', className)}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      aria-label={label}
    >
      <div className={cn('h-full rounded-full', warn ? 'bg-warning' : 'bg-accent')} style={{ width: `${pct}%` }} />
    </div>
  );
}
