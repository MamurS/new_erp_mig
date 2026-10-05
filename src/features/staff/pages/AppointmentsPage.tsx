import { t } from '@/i18n';
import { useMemo, useState, type ReactNode } from 'react';
import { CalendarDays, List } from 'lucide-react';
import type { Appointment, AppointmentStatus } from '@/shared/types';
import { useAppointments, useConfirmAppointment, useDeclineAppointment } from '@/shared/api/queries/staff';
import { errorMessage } from '@/shared/api/client';
import { useCan } from '@/shared/auth/guards';
import { APPOINTMENT_STATUS_LABEL, SPECIALTY_LABEL } from '@/shared/domain/labels';
import { addDaysISO, formatDate, formatDateTime, formatTime, isoDateOf, todayISO } from '@/shared/lib/format';
import { useDebounced, useDocumentTitle, useUrlFilters } from '@/shared/lib/hooks';
import { cn } from '@/shared/lib/cn';
import { Button } from '@/shared/ui/button';
import { StatusDot } from '@/shared/ui/chips';
import { DataTable, formatSort, parseSort, type Column } from '@/shared/ui/data-table';
import { Modal } from '@/shared/ui/dialog';
import { FilterChip } from '@/shared/ui/filter-chip';
import { Field, Input, Textarea } from '@/shared/ui/input';
import { SearchInput } from '@/shared/ui/search-input';
import { EmptyState, ErrorState, SkeletonRows } from '@/shared/ui/states';
import { toast } from '@/shared/ui/toast';
import { APPT_TONE } from '../components/tones';
import { useTopbar } from '../topbar';

const HOURS = Array.from({ length: 10 }, (_, i) => 9 + i);

export default function AppointmentsPage() {
  useDocumentTitle(t('staff.appts.title'));
  useTopbar([{ label: t('staff.appts.title') }]);
  const [f, setF] = useUrlFilters(['view', 'status', 'date', 'sort', 'page'] as const);
  const [search, setSearch] = useState('');
  const q = useDebounced(search.trim());
  const view = f.view === 'day' ? 'day' : 'list';
  const date = f.date === 'today' ? todayISO() : f.date;
  const dayDate = date || todayISO();
  const page = Number(f.page) || 1;
  const sort = parseSort(f.sort || 'startsAt:asc');
  const list = useAppointments({ status: f.status, date, sort: formatSort(sort), page, pageSize: 25, q }, view === 'list');
  const day = useAppointments({ date: dayDate, pageSize: 'all', q, status: f.status }, view === 'day');
  const canManage = useCan('appointments.manage');
  const confirm = useConfirmAppointment();
  const [declining, setDeclining] = useState<Appointment | null>(null);

  const doConfirm = async (a: Appointment) => {
    try {
      await confirm.mutateAsync(a.id);
      toast.success(t('staff.dashboard.confirmed'));
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const actions = (a: Appointment) =>
    canManage && (a.status === 'requested' || a.status === 'confirmed') ? (
      <span className="flex justify-end gap-1.5">
        {a.status === 'requested' && (
          <Button size="sm" loading={confirm.isPending && confirm.variables === a.id} onClick={(e) => { e.stopPropagation(); void doConfirm(a); }}>
            {t('common.confirm')}
          </Button>
        )}
        <Button size="sm" variant="secondary" onClick={(e) => { e.stopPropagation(); setDeclining(a); }}>
          {t('common.reject')}
        </Button>
      </span>
    ) : null;

  const cols: Column<Appointment>[] = [
    { key: 'when', header: t('staff.appts.colWhen'), sortKey: 'startsAt', cell: (a) => <span className="whitespace-nowrap">{formatDateTime(a.startsAt)}</span> },
    { key: 'who', header: t('common.insured'), sortKey: 'insuredName', cell: (a) => <span className="font-medium">{a.insuredName}</span> },
    { key: 'client', header: t('common.client'), cell: (a) => <span className="text-muted">{a.clientName}</span> },
    { key: 'spec', header: t('staff.insuredCard.doctor'), sortKey: 'specialty', cell: (a) => SPECIALTY_LABEL[a.specialty] },
    { key: 'clinic', header: t('common.clinic'), sortKey: 'clinicName', cell: (a) => a.clinicName },
    { key: 'status', header: t('common.status'), sortKey: 'status', cell: (a) => (
        <span className="flex flex-col">
          <StatusDot tone={APPT_TONE[a.status]}>{APPOINTMENT_STATUS_LABEL[a.status]}</StatusDot>
          {a.respondedBy && <span className="text-[11px] text-muted">{a.respondedBy === 'clinic' ? t('staff.appts.byClinic') : t('staff.appts.byOperator')}</span>}
          {a.proposedStartsAt && <span className="text-[11px] text-warning-text">{t('staff.appts.proposedOther')}</span>}
          {a.fromClinicSystem && <span className="text-[11px] text-muted">{t('staff.appts.fromClinicSystem')}</span>}
        </span>
      ) },
    { key: 'actions', header: '', align: 'right', cell: actions },
  ];

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-[22px] font-bold">{t('staff.appts.title')}</h1>
        <div className="flex items-center gap-2">
          <SearchInput value={search} onChange={setSearch} placeholder={t('staff.appts.searchPlaceholder')} slashFocus className="w-64" />
          <div role="tablist" aria-label={t('staff.appts.view')} className="flex rounded-btn border border-border bg-surface p-0.5">
            <button role="tab" type="button" aria-selected={view === 'list'} onClick={() => setF({ view: null })} className={cn('flex items-center gap-1 rounded-sm px-2 py-1', view === 'list' && 'bg-rail font-semibold')}>
              <List className="h-3.5 w-3.5" aria-hidden /> {t('staff.appts.list')}
            </button>
            <button role="tab" type="button" aria-selected={view === 'day'} onClick={() => setF({ view: 'day' })} className={cn('flex items-center gap-1 rounded-sm px-2 py-1', view === 'day' && 'bg-rail font-semibold')}>
              <CalendarDays className="h-3.5 w-3.5" aria-hidden /> {t('staff.appts.day')}
            </button>
          </div>
        </div>
      </div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <FilterChip
          label={t('common.status')}
          options={(Object.keys(APPOINTMENT_STATUS_LABEL) as AppointmentStatus[]).map((s) => ({ value: s, label: APPOINTMENT_STATUS_LABEL[s] }))}
          selected={f.status ? f.status.split(',') : []}
          onChange={(v) => setF({ status: v.join(',') })}
        />
        <label className="flex items-center gap-1.5 text-[12px] text-muted">
          {t('common.date')}
          <Input type="date" className="h-7 w-auto" value={date} onChange={(e) => setF({ date: e.target.value || null })} aria-label={t('common.date')} />
        </label>
        {view === 'day' && (
          <span className="flex gap-1">
            <Button size="sm" variant="secondary" onClick={() => setF({ date: addDaysISO(dayDate, -1) })}>
              {t('staff.appts.prev')}
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setF({ date: todayISO() })}>
              {t('staff.appts.today')}
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setF({ date: addDaysISO(dayDate, 1) })}>
              {t('staff.appts.next')}
            </Button>
          </span>
        )}
        {date && view === 'list' && (
          <Button size="sm" variant="ghost" onClick={() => setF({ date: null })}>
            {t('staff.appts.allDates')}
          </Button>
        )}
      </div>
      {view === 'list' ? (
        <div className="rounded-card border border-border bg-surface">
          <DataTable
            caption={t('staff.appts.title')}
            columns={cols}
            rows={list.data?.items}
            rowKey={(a) => a.id}
            loading={list.isLoading}
            error={list.error}
            onRetry={() => void list.refetch()}
            sort={sort}
            onSortChange={(s) => setF({ sort: formatSort(s) })}
            page={page}
            pageSize={25}
            total={list.data?.total}
            onPageChange={(p) => setF({ page: p }, false)}
            empty={<EmptyState title={t('staff.medical.empty')} description={t('staff.appts.emptyHint')} action={<Button variant="secondary" onClick={() => { setSearch(''); setF({ status: '', date: null }); }}>{t('staff.clients.resetFilters')}</Button>} />}
          />
        </div>
      ) : day.isLoading ? (
        <SkeletonRows rows={8} />
      ) : day.isError ? (
        <ErrorState error={day.error} onRetry={() => void day.refetch()} />
      ) : (
        <DayTimeline date={dayDate} items={day.data!.items} renderActions={actions} />
      )}
      <DeclineDialog appt={declining} onClose={() => setDeclining(null)} />
    </div>
  );
}

function DayTimeline({ date, items, renderActions }: { date: string; items: Appointment[]; renderActions: (a: Appointment) => ReactNode }) {
  const byClinic = useMemo(() => {
    const m = new Map<string, { name: string; items: Appointment[] }>();
    for (const a of items) {
      if (isoDateOf(a.startsAt) !== date) continue;
      const e = m.get(a.clinicId) ?? { name: a.clinicName, items: [] };
      e.items.push(a);
      m.set(a.clinicId, e);
    }
    return [...m.values()].sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  }, [items, date]);
  if (byClinic.length === 0) return <EmptyState title={t('staff.appts.dayEmpty', { date: formatDate(date) })} description={t('staff.appts.chooseOtherDay')} />;
  return (
    <div className="overflow-x-auto rounded-card border border-border bg-surface">
      <table className="w-full min-w-[900px] table-fixed border-collapse">
        <caption className="sr-only">{t('staff.appts.dayCaption', { date: formatDate(date) })}</caption>
        <thead>
          <tr className="border-b border-border text-[12px] text-muted">
            <th scope="col" className="w-56 px-3 py-2 text-left font-normal">{t('common.clinic')}</th>
            {HOURS.map((h) => (
              <th key={h} scope="col" className="border-l border-border-soft px-1 py-2 text-left font-normal num">
                {String(h).padStart(2, '0')}:00
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {byClinic.map((c) => (
            <tr key={c.name} className="border-b border-border-soft align-top">
              <th scope="row" className="px-3 py-2 text-left font-medium">{c.name}</th>
              {HOURS.map((h) => (
                <td key={h} className="border-l border-border-soft p-1">
                  {c.items
                    .filter((a) => Number(formatTime(a.startsAt).slice(0, 2)) === h)
                    .map((a) => (
                      <div key={a.id} className={cn('mb-1 rounded-btn border px-1.5 py-1 text-[12px]', a.status === 'requested' ? 'border-warning/40 bg-warning-soft' : a.status === 'confirmed' ? 'border-success/30 bg-success-soft' : 'border-border bg-rail text-muted')}>
                        <div className="font-medium num">{formatTime(a.startsAt)}</div>
                        <div className="truncate" title={a.insuredName}>{a.insuredName}</div>
                        <div className="truncate text-muted">{SPECIALTY_LABEL[a.specialty]}</div>
                        <div className="mt-1">{renderActions(a)}</div>
                      </div>
                    ))}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DeclineDialog({ appt, onClose }: { appt: Appointment | null; onClose: () => void }) {
  const decline = useDeclineAppointment();
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState(false);
  const error = reason.trim().length < 3 ? t('staff.appts.reasonRequired') : undefined;
  return (
    <Modal
      open={!!appt}
      onOpenChange={(o) => {
        if (!o) {
          onClose();
          setReason('');
          setTouched(false);
        }
      }}
      title={t('staff.appts.declineTitle')}
      description={t('staff.appts.declineText')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="danger"
            loading={decline.isPending}
            onClick={async () => {
              setTouched(true);
              if (error || !appt) return;
              try {
                await decline.mutateAsync({ id: appt.id, reason: reason.trim() });
                toast.success(t('staff.appts.declined'));
                setReason('');
                setTouched(false);
                onClose();
              } catch (e) {
                toast.error(errorMessage(e));
              }
            }}
          >
            {t('staff.appts.declineTitle')}
          </Button>
        </>
      }
    >
      <div className="mb-2 flex flex-wrap gap-1.5">
        {[t('staff.appts.quickDoctor'), t('staff.appts.quickProgram'), t('staff.appts.quickSpecialty')].map((r) => (
          <button key={r} type="button" onClick={() => setReason(r)} className="rounded-btn border border-border px-2 py-1 text-[12px] hover:bg-rail">
            {r}
          </button>
        ))}
      </div>
      <Field label={t('common.reason')} error={touched ? error : undefined}>
        {(a) => <Textarea {...a} value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} onBlur={() => setTouched(true)} />}
      </Field>
    </Modal>
  );
}
