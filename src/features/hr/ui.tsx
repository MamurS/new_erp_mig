/* Small presentational pieces shared by HR cabinet screens (client theme). */
import type { ReactNode } from 'react';
import type { AppStatus } from '@/shared/types';
import { Chip } from '@/shared/ui/chips';
import { cn } from '@/shared/lib/cn';
import { defineLabels } from '@/i18n';

/** HR screen heading: Rubik 600, 30px (SPEC §7.2). */
export function HrHeader({ title, subtitle, actions, className }: { title: string; subtitle?: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <div className={cn('mb-6 flex flex-wrap items-end justify-between gap-4', className)}>
      <div className="min-w-0">
        <h1 className="font-heading text-[30px] font-semibold leading-tight">{title}</h1>
        {subtitle && <div className="mt-1.5 text-muted">{subtitle}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-3">{actions}</div>}
    </div>
  );
}

export function HrCard({ children, className, tone = 'surface' }: { children: ReactNode; className?: string; tone?: 'surface' | 'peach' | 'sky' | 'accent' }) {
  return (
    <section
      className={cn(
        'rounded-card p-5',
        tone === 'surface' && 'border border-border bg-surface',
        tone === 'peach' && 'bg-peach text-peach-text',
        tone === 'sky' && 'bg-sky text-sky-text',
        tone === 'accent' && 'bg-accent-soft text-accent-text',
        className,
      )}
    >
      {children}
    </section>
  );
}

export function HrSectionTitle({ children, className }: { children: ReactNode; className?: string }) {
  return <h2 className={cn('font-heading text-[18px] font-semibold', className)}>{children}</h2>;
}

const APP_STATUS_KIND: Record<AppStatus, string> = { active: 'success', invited: 'sun', not_invited: 'neutral' };
const APP_STATUS_LABEL = defineLabels('hr.appStatus', ['active', 'invited', 'not_invited'] as const);

export function AppStatusChip({ status }: { status: AppStatus }) {
  return <Chip kind={APP_STATUS_KIND[status]}>{APP_STATUS_LABEL[status]}</Chip>;
}

/** Client-mode control height (46–54px) and touch target ≥ 44px. */
export const HR_BTN = 'h-12 px-5 text-[15px] font-semibold';
