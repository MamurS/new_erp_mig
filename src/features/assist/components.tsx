/* Shared UI of the assistance portal and of the MIG assistance screens (SLA, KPI, rebills). */
import { useEffect, useState, type ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, Clock } from 'lucide-react';
import type { AssistanceKpi, RebillLine } from '@/shared/types';
import type { RebillView } from '@/shared/types/dto';
import { CASE_STATUS_LABEL, FEE_MODEL_LABEL, REBILL_CHECK_LABEL, REBILL_STATUS_CHIP, REBILL_STATUS_LABEL, slaState } from '@/shared/domain/assistance';
import { formatDate, formatDateTime, formatMoney, formatNumber, formatPercent } from '@/shared/lib/format';
import { cn } from '@/shared/lib/cn';
import { Chip } from '@/shared/ui/chips';
import { DataTable, type Column } from '@/shared/ui/data-table';
import { EmptyState } from '@/shared/ui/states';
import { roleName } from '@/features/next/NextActions';
import { EmptyHelp } from '@/features/clinic/emptyNext';
import { useDmsParam } from '@/shared/api/queries/params';
import { defineLabels, t, tm } from '@/i18n';

/** Re-renders every 30 seconds so SLA countdowns stay fresh. */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);
  return now;
}

function leftText(ms: number): string {
  const min = Math.round(Math.abs(ms) / 60_000);
  if (min < 60) return t('assist.sla.min', { min });
  const h = Math.floor(min / 60);
  if (h < 48) return t('assist.sla.hoursMin', { h, min: min % 60 });
  return t('assist.sla.days', { d: Math.floor(h / 24) });
}

/** Time left before the SLA deadline; orange when close, red when breached (§6). */
export function SlaBadge({ dueAt, done }: { dueAt: string; done?: boolean }) {
  const now = useNow();
  const state = slaState(dueAt, now, done);
  if (done) return <span className="text-muted">—</span>;
  const left = Date.parse(dueAt) - now;
  return (
    <span
      data-testid="sla"
      className={cn(
        'inline-flex items-center gap-1 whitespace-nowrap rounded-btn px-1.5 py-0.5 text-[12px] font-medium num',
        state === 'overdue' ? 'bg-danger-soft text-danger-text' : state === 'soon' ? 'bg-warning-soft text-warning-text' : 'bg-rail text-muted',
      )}
    >
      {state === 'overdue' ? <AlertTriangle className="h-3 w-3" aria-hidden /> : <Clock className="h-3 w-3" aria-hidden />}
      {state === 'overdue' ? t('assist.sla.overdue', { left: leftText(left) }) : t('assist.sla.left', { left: leftText(left) })}
    </span>
  );
}

const CASE_CHIP = { open: 'sky', in_progress: 'accent', waiting: 'warning', resolved: 'success' } as const;
export function CaseStatus({ status }: { status: keyof typeof CASE_CHIP }) {
  return <Chip kind={CASE_CHIP[status]}>{CASE_STATUS_LABEL[status]}</Chip>;
}

export function KpiGrid({ kpi, className }: { kpi: AssistanceKpi; className?: string }) {
  const responseNorm = useDmsParam('clinicResponseMinutes');
  const lossWarn = useDmsParam('lossRatioWarn');
  const items: [string, string, boolean][] = [
    [t('assist.kpi.responseAvg'), t('assist.kpi.minutes', { n: kpi.appointmentResponseMinutesAvg }), kpi.appointmentResponseMinutesAvg > responseNorm],
    [t('assist.kpi.guaranteesOnTime'), formatPercent(kpi.guaranteesOnTimeShare), kpi.guaranteesOnTimeShare < 0.9],
    [t('assist.kpi.qaAgreement'), formatPercent(kpi.qaAgreementShare), kpi.qaAgreementShare < 0.9],
    [t('assist.kpi.complaints'), formatNumber(kpi.complaintsPer1000, 1), kpi.complaintsPer1000 > 5],
    [t('assist.kpi.lossRatio'), kpi.lossRatio === null ? '—' : formatPercent(kpi.lossRatio), (kpi.lossRatio ?? 0) >= lossWarn],
  ];
  return (
    <div className={cn('grid grid-cols-2 gap-3 md:grid-cols-5', className)} data-testid="kpi">
      {items.map(([label, value, warn]) => (
        <div key={label} className={cn('rounded-card border bg-surface p-3', warn ? 'border-warning/40' : 'border-border')}>
          <div className="text-[12px] text-muted">{label}</div>
          <div className={cn('mt-1 text-[18px] font-bold num', warn && 'text-warning-text')}>{value}</div>
        </div>
      ))}
    </div>
  );
}

export function Stat({ label, value, tone }: { label: string; value: ReactNode; tone?: 'warning' | 'danger' }) {
  return (
    <div className={cn('rounded-card border bg-surface p-3', tone === 'danger' ? 'border-danger/30' : tone === 'warning' ? 'border-warning/40' : 'border-border')}>
      <div className="text-[12px] text-muted">{label}</div>
      <div className={cn('num font-semibold', tone === 'danger' && 'text-danger-text', tone === 'warning' && 'text-warning-text')}>{value}</div>
    </div>
  );
}

export function RebillStatus({ status }: { status: RebillView['status'] }) {
  return <Chip kind={REBILL_STATUS_CHIP[status]}>{REBILL_STATUS_LABEL[status]}</Chip>;
}

/** Header numbers of a rebill: claims, fee with its formula, totals and the review deadline. */
export function RebillSummaryBlock({ r }: { r: RebillView }) {
  return (
    <div className="mb-4 flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label={t('assist.rebill.paidToClinics')} value={formatMoney(r.totals.claims)} />
        <Stat label={t('assist.rebill.fee')} value={formatMoney(r.totals.fee)} />
        <Stat label={t('assist.rebill.totalToReimburse')} value={formatMoney(r.totals.total)} />
        <Stat label={t('assist.rebill.acceptedFor')} value={formatMoney(r.totals.accepted)} />
        <Stat label={t('assist.rebill.rejectedFor')} value={formatMoney(r.totals.rejected)} tone={r.totals.rejected ? 'warning' : undefined} />
      </div>
      <p className="rounded-btn bg-rail px-3 py-2 text-[13px]" data-testid="fee-formula">
        <span className="text-muted">{FEE_MODEL_LABEL[r.fee.model]}: </span>
        <span className="num font-medium">{tm(r.fee.formula)}</span>
      </p>
      <p className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-muted">
        {r.submittedAt && <span>{t('assist.rebill.submittedAt', { date: formatDateTime(r.submittedAt) })}</span>}
        {r.reviewDueAt && r.status !== 'paid' && <span>{t('assist.rebill.reviewDue', { date: formatDate(r.reviewDueAt) })}</span>}
        {r.acceptedByName && <span>{t('assist.rebill.acceptedBy', { name: r.acceptedByName })}</span>}
        {r.paidAt && <span>{t('assist.rebill.paidAt', { date: formatDateTime(r.paidAt) })}{r.paidByName ? ` · ${r.paidByName}` : ''}</span>}
      </p>
    </div>
  );
}

const LINE_CHIP = { pending: 'sky', accepted: 'success', rejected: 'danger', disputed: 'warning' } as const;
const LINE_LABEL = defineLabels('assist.line', ['pending', 'accepted', 'rejected', 'disputed'] as const);

export function CheckFlags({ checks }: { checks: RebillLine['checks'] }) {
  if (!checks.length) {
    return (
      <span className="inline-flex items-center gap-1 text-[12px] text-success-text">
        <CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> {t('assist.line.checksPassed')}
      </span>
    );
  }
  return (
    <ul className="flex flex-col gap-1" data-testid="check-flags">
      {checks.map((c) => (
        <li key={c.code} className="flex flex-col">
          <Chip kind="danger" className="self-start">
            <AlertTriangle className="h-3 w-3" aria-hidden /> {REBILL_CHECK_LABEL[c.code]}
          </Chip>
          <span className="text-[12px] text-muted">{tm(c.message)}</span>
        </li>
      ))}
    </ul>
  );
}

/** Lines of a rebill with the automatic checks; `actions` renders buttons of the viewer's side. */
export function RebillLinesTable({ lines, actions }: { lines: RebillLine[]; actions?: (l: RebillLine) => ReactNode }) {
  const columns: Column<RebillLine>[] = [
    { key: 'date', header: t('assist.line.serviceDate'), cell: (l) => <span className="num whitespace-nowrap">{formatDate(l.serviceDate)}</span> },
    { key: 'clinic', header: t('common.clinic'), cell: (l) => l.clinicName },
    { key: 'who', header: t('common.patient'), cell: (l) => l.insuredName },
    { key: 'svc', header: t('common.service'), cell: (l) => l.serviceName },
    { key: 'amount', header: t('common.amount'), align: 'right', cell: (l) => <span className="num whitespace-nowrap">{formatMoney(l.amount)}</span> },
    { key: 'checks', header: t('assist.line.migChecks'), cell: (l) => <CheckFlags checks={l.checks} /> },
    {
      key: 'status',
      header: t('common.status'),
      cell: (l) => (
        <span className="flex flex-col gap-0.5">
          <Chip kind={LINE_CHIP[l.status]}>{LINE_LABEL[l.status]}</Chip>
          {l.rejectionReason && <span className="text-[12px] text-muted">{t('assist.line.migReason', { text: l.rejectionReason })}</span>}
          {l.disputeComment && <span className="text-[12px] text-warning-text">{t('assist.line.assistReason', { text: l.disputeComment })}</span>}
        </span>
      ),
    },
    ...(actions ? [{ key: 'actions', header: '', align: 'right' as const, cell: actions }] : []),
  ];
  return (
    <div className="rounded-card border border-border bg-surface">
      <DataTable caption={t('assist.line.caption')} columns={columns} rows={lines} rowKey={(l) => l.id} empty={
          <EmptyState
            testId="rebill-lines-empty"
            title={t('assist.line.empty')}
            why={t('emptyPartner.assist.lines.why')}
            next={t('emptyPartner.assist.lines.next', { role: roleName('admin') })}
            help={<EmptyHelp article="assistance" section="assistance-rebill" contact />}
          />
        }
      />
    </div>
  );
}
