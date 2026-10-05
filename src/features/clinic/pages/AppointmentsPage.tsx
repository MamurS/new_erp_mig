/* Clinic appointments (CLINIC_SPEC §4.3): requests to answer and the day/week schedule. */
import { useState } from 'react';
import type { Appointment } from '@/shared/types';
import type { ClinicAppointment } from '@/shared/api/schemas-clinic';
import { useClinicAppointments, useClinicSlots, useRespondAppointment } from '@/shared/api/queries/clinic';
import { errorMessage } from '@/shared/api/client';
import { SPECIALTY_LABEL } from '@/shared/domain/labels';
import { addDaysISO, formatDate, formatDateTime, formatTime, todayISO } from '@/shared/lib/format';
import { useDocumentTitle, useUrlFilters } from '@/shared/lib/hooks';
import { cn } from '@/shared/lib/cn';
import { Button } from '@/shared/ui/button';
import { Chip } from '@/shared/ui/chips';
import { DataTable, type Column } from '@/shared/ui/data-table';
import { Modal } from '@/shared/ui/dialog';
import { Field, Input, Textarea } from '@/shared/ui/input';
import { EmptyState, QueryState, SkeletonRows } from '@/shared/ui/states';
import { toast } from '@/shared/ui/toast';
import { PageTitle, Panel } from '../components';
import { t } from '@/i18n';

const KEYS = ['view', 'range'] as const;

function RescheduleDialog({ appt, onClose }: { appt: Appointment; onClose: () => void }) {
  const [date, setDate] = useState(() => (appt.startsAt.slice(0, 10) > todayISO() ? appt.startsAt.slice(0, 10) : addDaysISO(todayISO(), 1)));
  const slots = useClinicSlots(date, true);
  const respond = useRespondAppointment();
  const [picked, setPicked] = useState<string | null>(null);
  const submit = async () => {
    if (!picked) return;
    try {
      await respond.mutateAsync({ id: appt.id, kind: 'reschedule', startsAt: picked });
      toast.success(t('clinic.appts.rescheduled'));
      onClose();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('clinic.appts.rescheduleTitle')}
      description={t('clinic.appts.rescheduleDescription', { name: appt.insuredName, specialty: SPECIALTY_LABEL[appt.specialty], at: formatDateTime(appt.startsAt) })}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button disabled={!picked} loading={respond.isPending} onClick={() => void submit()}>
            {t('clinic.appts.propose')}
          </Button>
        </>
      }
    >
      <Field label={t('clinic.appts.day')}>
        {(a) => <Input {...a} type="date" min={todayISO()} value={date} onChange={(e) => { setDate(e.target.value); setPicked(null); }} />}
      </Field>
      <div className="mt-3 flex flex-wrap gap-1.5" role="radiogroup" aria-label={t('clinic.appts.freeTime')}>
        {slots.isLoading ? (
          <SkeletonRows rows={2} />
        ) : (slots.data ?? []).filter((s) => Date.parse(s.startsAt) > Date.now()).length === 0 ? (
          <p className="text-muted">{t('clinic.appts.noSlots')}</p>
        ) : (
          (slots.data ?? [])
            .filter((s) => Date.parse(s.startsAt) > Date.now())
            .map((s) => (
              <button
                key={s.startsAt}
                type="button"
                role="radio"
                aria-checked={picked === s.startsAt}
                onClick={() => setPicked(s.startsAt)}
                className={cn('rounded-btn border border-border px-3 py-1.5 num', picked === s.startsAt ? 'border-accent bg-accent text-white' : 'hover:bg-rail')}
              >
                {formatTime(s.startsAt)}
              </button>
            ))
        )}
      </div>
    </Modal>
  );
}

function DeclineDialog({ appt, onClose }: { appt: Appointment; onClose: () => void }) {
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState(false);
  const respond = useRespondAppointment();
  const invalid = reason.trim().length < 3;
  const submit = async () => {
    setTouched(true);
    if (invalid) return;
    try {
      await respond.mutateAsync({ id: appt.id, kind: 'decline', reason: reason.trim() });
      toast.success(t('clinic.appts.declined'));
      onClose();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('clinic.appts.declineTitle')}
      description={t('clinic.appts.declineDescription')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="danger" loading={respond.isPending} onClick={() => void submit()}>
            {t('common.reject')}
          </Button>
        </>
      }
    >
      <Field label={t('common.reason')} error={touched && invalid ? t('clinic.appts.reasonError') : undefined}>
        {(a) => <Textarea {...a} rows={3} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />}
      </Field>
    </Modal>
  );
}

export default function AppointmentsPage() {
  useDocumentTitle(t('clinic.nav.appointments'));
  const [f, setF] = useUrlFilters(KEYS);
  const view = f.view === 'schedule' ? 'schedule' : 'requests';
  const days = f.range === 'week' ? 7 : 1;
  const [from, setFrom] = useState(todayISO());
  const q = useClinicAppointments(view, from, days);
  const respond = useRespondAppointment();
  const [reschedule, setReschedule] = useState<Appointment | null>(null);
  const [decline, setDecline] = useState<Appointment | null>(null);

  const confirm = async (a: Appointment) => {
    try {
      await respond.mutateAsync({ id: a.id, kind: 'confirm' });
      toast.success(t('clinic.appts.confirmed'));
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const columns: Column<ClinicAppointment>[] = [
    { key: 'who', header: t('common.patient'), cell: (a) => <span className="font-medium">{a.insuredName}</span> },
    { key: 'spec', header: t('clinic.appts.specialty'), cell: (a) => SPECIALTY_LABEL[a.specialty] },
    { key: 'when', header: t('common.time'), cell: (a) => <span className="num whitespace-nowrap">{formatDateTime(a.startsAt)}</span> },
    {
      key: 'created',
      header: t('clinic.appts.request'),
      cell: (a) => (
        <span className="flex flex-wrap items-center gap-1.5 whitespace-nowrap">
          <span className="num text-muted">{formatDateTime(a.createdAt)}</span>
          {a.overdue && <Chip kind="danger">{t('clinic.appts.overdue')}</Chip>}
          {a.proposedStartsAt && <Chip kind="sky">{t('clinic.appts.proposed', { at: formatDateTime(a.proposedStartsAt) })}</Chip>}
        </span>
      ),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      cell: (a) =>
        a.proposedStartsAt ? (
          <span className="text-[12px] text-muted">{t('clinic.appts.waitingPatient')}</span>
        ) : (
          <span className="inline-flex flex-wrap justify-end gap-1.5">
            <Button size="sm" loading={respond.isPending && respond.variables?.id === a.id} onClick={() => void confirm(a)} aria-label={t('clinic.appts.confirmAria', { name: a.insuredName })}>
              {t('common.confirm')}
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setReschedule(a)}>
              {t('clinic.appts.otherTime')}
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setDecline(a)}>
              {t('common.reject')}
            </Button>
          </span>
        ),
    },
  ];

  const bySpecialty = new Map<string, ClinicAppointment[]>();
  for (const a of view === 'schedule' ? (q.data ?? []) : []) {
    const list = bySpecialty.get(a.specialty) ?? [];
    list.push(a);
    bySpecialty.set(a.specialty, list);
  }

  return (
    <>
      <PageTitle title={t('clinic.nav.appointments')} subtitle={t('clinic.appts.subtitle')} />
      <div role="tablist" aria-label={t('clinic.appts.view')} className="mb-4 flex gap-1.5">
        {(['requests', 'schedule'] as const).map((v) => (
          <button
            key={v}
            role="tab"
            type="button"
            aria-selected={view === v}
            onClick={() => setF({ view: v === 'requests' ? null : v })}
            className={cn('rounded-full px-4 py-2 font-semibold', view === v ? 'bg-accent text-white' : 'hover:bg-rail')}
          >
            {v === 'requests' ? t('clinic.appts.requests') : t('clinic.appts.schedule')}
          </button>
        ))}
      </div>
      {view === 'requests' ? (
        <Panel>
          <DataTable
            caption={t('clinic.appts.caption')}
            columns={columns}
            rows={q.data}
            rowKey={(a) => a.id}
            loading={q.isLoading}
            error={q.error}
            onRetry={() => void q.refetch()}
            empty={<EmptyState title={t('clinic.appts.allDone')} description={t('clinic.appts.allDoneHint')} />}
          />
        </Panel>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-end gap-3">
            <Field label={t('common.from')}>
              {(a) => <Input {...a} type="date" value={from} onChange={(e) => setFrom(e.target.value || todayISO())} className="w-44" />}
            </Field>
            <div className="flex gap-1.5">
              <Button variant={days === 1 ? 'primary' : 'secondary'} size="sm" onClick={() => setF({ range: null })}>
                {t('clinic.appts.dayView')}
              </Button>
              <Button variant={days === 7 ? 'primary' : 'secondary'} size="sm" onClick={() => setF({ range: 'week' })}>
                {t('clinic.appts.weekView')}
              </Button>
            </div>
          </div>
          <QueryState query={q} skeleton={<SkeletonRows rows={6} />}>
            {() =>
              bySpecialty.size === 0 ? (
                <EmptyState title={t('common.empty')} description={`${formatDate(from)}${days > 1 ? ` — ${formatDate(addDaysISO(from, days - 1))}` : ''}`} />
              ) : (
                <div className="grid gap-3 lg:grid-cols-2">
                  {[...bySpecialty.entries()].map(([spec, list]) => (
                    <Panel key={spec} title={SPECIALTY_LABEL[spec as Appointment['specialty']]}>
                      <ul className="divide-y divide-border-soft">
                        {list.map((a) => (
                          <li key={a.id} className="flex items-center justify-between gap-2 px-4 py-2">
                            <span>
                              <span className="num font-semibold">{days > 1 ? formatDateTime(a.startsAt) : formatTime(a.startsAt)}</span> · {a.insuredName}
                            </span>
                            <Chip kind={a.status === 'confirmed' ? 'success' : a.status === 'completed' ? 'neutral' : 'warning'}>
                              {a.status === 'confirmed' ? t('clinic.appts.statusConfirmed') : a.status === 'completed' ? t('clinic.appts.statusCompleted') : t('clinic.appts.statusWaiting')}
                            </Chip>
                          </li>
                        ))}
                      </ul>
                    </Panel>
                  ))}
                </div>
              )
            }
          </QueryState>
        </>
      )}
      {reschedule && <RescheduleDialog appt={reschedule} onClose={() => setReschedule(null)} />}
      {decline && <DeclineDialog appt={decline} onClose={() => setDecline(null)} />}
    </>
  );
}
