/* Shared UI of the assistance portal and of the MIG assistance screens (SLA, KPI, rebills). */
import { useEffect, useState, type ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, Clock } from 'lucide-react';
import type { AssistanceKpi, RebillLine } from '@/shared/types';
import type { RebillView } from '@/shared/types/dto';
import { CASE_STATUS_LABEL, FEE_MODEL_LABEL, REBILL_CHECK_LABEL, REBILL_STATUS_CHIP, REBILL_STATUS_LABEL, slaState } from '@/shared/domain/assistance';
import { formatDate, formatDateTime, formatMoney, formatPercent } from '@/shared/lib/format';
import { cn } from '@/shared/lib/cn';
import { Chip } from '@/shared/ui/chips';
import { DataTable, type Column } from '@/shared/ui/data-table';

/** Re-renders every 30 seconds so SLA countdowns stay fresh. */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  return now;
}

function leftText(ms: number): string {
  const min = Math.round(Math.abs(ms) / 60_000);
  if (min < 60) return `${min} мин`;
  const h = Math.floor(min / 60);
  if (h < 48) return `${h} ч ${min % 60} мин`;
  return `${Math.floor(h / 24)} дн`;
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
      {state === 'overdue' ? `просрочено на ${leftText(left)}` : `осталось ${leftText(left)}`}
    </span>
  );
}

const CASE_CHIP = { open: 'sky', in_progress: 'accent', waiting: 'warning', resolved: 'success' } as const;
export function CaseStatus({ status }: { status: keyof typeof CASE_CHIP }) {
  return <Chip kind={CASE_CHIP[status]}>{CASE_STATUS_LABEL[status]}</Chip>;
}

export function KpiGrid({ kpi, className }: { kpi: AssistanceKpi; className?: string }) {
  const items: [string, string, boolean][] = [
    ['Ответ по записи, в среднем', `${kpi.appointmentResponseMinutesAvg} мин`, kpi.appointmentResponseMinutesAvg > 120],
    ['ГП решены в срок', formatPercent(kpi.guaranteesOnTimeShare), kpi.guaranteesOnTimeShare < 0.9],
    ['Согласие контроля качества', formatPercent(kpi.qaAgreementShare), kpi.qaAgreementShare < 0.9],
    ['Жалоб на 1000 застрахованных', String(kpi.complaintsPer1000).replace('.', ','), kpi.complaintsPer1000 > 5],
    ['Убыточность портфеля', kpi.lossRatio === null ? '—' : formatPercent(kpi.lossRatio), (kpi.lossRatio ?? 0) > 0.8],
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
        <Stat label="Оплачено клиникам" value={formatMoney(r.totals.claims)} />
        <Stat label="Вознаграждение" value={formatMoney(r.totals.fee)} />
        <Stat label="Итого к возмещению" value={formatMoney(r.totals.total)} />
        <Stat label="Принято строк на" value={formatMoney(r.totals.accepted)} />
        <Stat label="Отклонено строк на" value={formatMoney(r.totals.rejected)} tone={r.totals.rejected ? 'warning' : undefined} />
      </div>
      <p className="rounded-btn bg-rail px-3 py-2 text-[13px]" data-testid="fee-formula">
        <span className="text-muted">{FEE_MODEL_LABEL[r.fee.model]}: </span>
        <span className="num font-medium">{r.fee.formula}</span>
      </p>
      <p className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-muted">
        {r.submittedAt && <span>Отправлен {formatDateTime(r.submittedAt)}</span>}
        {r.reviewDueAt && r.status !== 'paid' && <span>Проверка МИГ до {formatDate(r.reviewDueAt)} (10 рабочих дней)</span>}
        {r.acceptedByName && <span>Принял: {r.acceptedByName}</span>}
        {r.paidAt && <span>Оплачен {formatDateTime(r.paidAt)}{r.paidByName ? ` · ${r.paidByName}` : ''}</span>}
      </p>
    </div>
  );
}

const LINE_CHIP = { pending: 'sky', accepted: 'success', rejected: 'danger', disputed: 'warning' } as const;
const LINE_LABEL = { pending: 'Ждёт проверки', accepted: 'Принята', rejected: 'Отклонена', disputed: 'Оспорена' } as const;

export function CheckFlags({ checks }: { checks: RebillLine['checks'] }) {
  if (!checks.length) {
    return (
      <span className="inline-flex items-center gap-1 text-[12px] text-success-text">
        <CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> Проверки пройдены
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
          <span className="text-[12px] text-muted">{c.message}</span>
        </li>
      ))}
    </ul>
  );
}

/** Lines of a rebill with the automatic checks; `actions` renders buttons of the viewer's side. */
export function RebillLinesTable({ lines, actions }: { lines: RebillLine[]; actions?: (l: RebillLine) => ReactNode }) {
  const columns: Column<RebillLine>[] = [
    { key: 'date', header: 'Дата услуги', cell: (l) => <span className="num whitespace-nowrap">{formatDate(l.serviceDate)}</span> },
    { key: 'clinic', header: 'Клиника', cell: (l) => l.clinicName },
    { key: 'who', header: 'Пациент', cell: (l) => l.insuredName },
    { key: 'svc', header: 'Услуга', cell: (l) => l.serviceName },
    { key: 'amount', header: 'Сумма', align: 'right', cell: (l) => <span className="num whitespace-nowrap">{formatMoney(l.amount)}</span> },
    { key: 'checks', header: 'Проверки МИГ', cell: (l) => <CheckFlags checks={l.checks} /> },
    {
      key: 'status',
      header: 'Статус',
      cell: (l) => (
        <span className="flex flex-col gap-0.5">
          <Chip kind={LINE_CHIP[l.status]}>{LINE_LABEL[l.status]}</Chip>
          {l.rejectionReason && <span className="text-[12px] text-muted">МИГ: {l.rejectionReason}</span>}
          {l.disputeComment && <span className="text-[12px] text-warning-text">Ассистанс: {l.disputeComment}</span>}
        </span>
      ),
    },
    ...(actions ? [{ key: 'actions', header: '', align: 'right' as const, cell: actions }] : []),
  ];
  return (
    <div className="rounded-card border border-border bg-surface">
      <DataTable caption="Строки счёта" columns={columns} rows={lines} rowKey={(l) => l.id} empty="В счёте нет строк" />
    </div>
  );
}
