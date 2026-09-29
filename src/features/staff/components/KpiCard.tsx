import { Link } from 'react-router-dom';
import type { Kpi } from '@/shared/types/dto';
import { formatMoneyShort, formatNumber } from '@/shared/lib/format';
import { cn } from '@/shared/lib/cn';

export function KpiCard({ kpi }: { kpi: Kpi }) {
  const body = (
    <>
      <div className="text-[12px] text-muted">{kpi.label}</div>
      <div className="mt-1 text-[22px] font-bold num leading-tight">
        {kpi.format === 'money' ? formatMoneyShort(kpi.value) : formatNumber(kpi.value)}
      </div>
      {kpi.hint && (
        <div className={cn('mt-0.5 text-[12px]', kpi.tone === 'warning' ? 'text-warning-text' : kpi.tone === 'danger' ? 'text-danger-text' : 'text-muted')}>
          {kpi.hint}
        </div>
      )}
    </>
  );
  const cls = cn(
    'block rounded-card border bg-surface p-3.5',
    kpi.tone === 'danger' ? 'border-danger/30' : kpi.tone === 'warning' ? 'border-warning/40' : 'border-border',
  );
  return kpi.to ? (
    <Link to={kpi.to} className={cn(cls, 'hover:border-accent/40')}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

export function MiniKpi({ label, value, tone }: { label: string; value: string; tone?: 'warning' | 'default' }) {
  return (
    <div className="rounded-btn bg-rail px-3 py-2">
      <div className="text-[12px] text-muted">{label}</div>
      <div className={cn('font-bold num', tone === 'warning' && 'text-warning-text')}>{value}</div>
    </div>
  );
}
