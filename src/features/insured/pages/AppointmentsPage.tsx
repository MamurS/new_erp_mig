import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarDays, MapPin } from 'lucide-react';
import { useI18n } from '@/i18n';
import { useAcceptProposal, useCancelMyAppointment, useMyAppointments } from '@/shared/api/queries/me';
import { errorMessage } from '@/shared/api/client';
import type { Appointment, AppointmentStatus } from '@/shared/types';
import { formatDate, formatTime } from '@/shared/lib/format';
import { useDocumentTitle } from '@/shared/lib/hooks';
import { cn } from '@/shared/lib/cn';
import { Button } from '@/shared/ui/button';
import { ConfirmDialog } from '@/shared/ui/confirm-dialog';
import { toast } from '@/shared/ui/toast';
import { BIG, CardSkeletons, Empty, LoadError, ScreenHeader, Section } from '../components';
import { isUpcomingAppointment, upcomingAppointments } from '../lib';
import { MedicalGate, PersonNote, usePerson } from '../person';

const TONE: Record<AppointmentStatus, string> = {
  requested: 'bg-sun text-sun-text',
  confirmed: 'bg-accent-soft text-accent-text',
  declined: 'bg-danger-soft text-danger-text',
  completed: 'bg-rail text-muted',
  cancelled: 'bg-rail text-muted',
};

export default function AppointmentsPage() {
  const { t } = useI18n();
  useDocumentTitle(t('app.appointments.title'));
  return (
    <div>
      <ScreenHeader title={t('app.appointments.title')} back="/app" />
      <PersonNote />
      <MedicalGate>
        <Appointments />
      </MedicalGate>
    </div>
  );
}

function Appointments() {
  const { t } = useI18n();
  const { personId } = usePerson();
  const q = useMyAppointments(personId);
  const cancel = useCancelMyAppointment();
  const accept = useAcceptProposal();
  const [target, setTarget] = useState<Appointment | null>(null);
  const [now] = useState(() => Date.now());

  const upcoming = upcomingAppointments(q.data ?? [], now);
  const past = (q.data ?? []).filter((a) => !isUpcomingAppointment(a, now));

  const confirmCancel = async () => {
    if (!target) return;
    try {
      await cancel.mutateAsync(target.id);
      toast.success(t('app.appointments.cancelled'));
      setTarget(null);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const acceptProposal = async (a: Appointment) => {
    try {
      await accept.mutateAsync(a.id);
      toast.success(t('app.appt.proposalAccepted'));
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const card = (a: Appointment, canCancel: boolean) => (
    <li key={a.id} className="rounded-card border border-border bg-surface p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-bold">{t(`app.specialty.${a.specialty}`)}</p>
          <p className="mt-0.5 flex items-center gap-1 text-[14px] text-muted">
            <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden />
            <span className="truncate">{a.clinicName}</span>
          </p>
          <p className="mt-0.5 flex items-center gap-1 text-[14px] font-semibold">
            <CalendarDays className="h-3.5 w-3.5 shrink-0" aria-hidden />
            {t('app.appointments.at', { date: formatDate(a.startsAt), time: formatTime(a.startsAt) })}
          </p>
        </div>
        <span className={cn('shrink-0 rounded-full px-2.5 py-1 text-[12px] font-bold', TONE[a.status])}>{t(`app.appt.${a.status}`)}</span>
      </div>
      {a.status === 'confirmed' && a.respondedBy && (
        <p className="mt-2 text-[13px] font-semibold text-accent-text" data-testid="appt-confirmed-by">
          {t(a.respondedBy === 'clinic' ? 'app.appt.byClinic' : 'app.appt.byOperator')}
        </p>
      )}
      {a.status === 'declined' && a.declineReason && <p className="mt-2 text-[13px] text-muted">{t('app.appt.declineReason', { reason: a.declineReason })}</p>}
      {a.status === 'requested' && a.proposedStartsAt && (
        <div className="mt-3 rounded-btn bg-sun px-3 py-2 text-sun-text" data-testid="appt-proposal">
          <p className="text-[14px] font-semibold">{t('app.appt.proposed', { date: formatDate(a.proposedStartsAt), time: formatTime(a.proposedStartsAt) })}</p>
          <Button onClick={() => void acceptProposal(a)} loading={accept.isPending} className="mt-2 h-11 w-full rounded-btn text-[15px]">
            {t('app.appt.acceptProposal')}
          </Button>
        </div>
      )}
      {canCancel && (
        <Button variant="secondary" onClick={() => setTarget(a)} className="mt-3 h-11 w-full rounded-btn text-[15px]">
          {t('app.appointments.cancel')}
        </Button>
      )}
    </li>
  );

  return (
    <>
      {q.isLoading ? (
        <CardSkeletons />
      ) : q.isError ? (
        <LoadError error={q.error} onRetry={() => void q.refetch()} />
      ) : (q.data ?? []).length === 0 ? (
        <Empty
          title={t('app.appointments.empty')}
          action={
            <Button asChild className={BIG}>
              <Link to="/app/booking">{t('app.appointments.book')}</Link>
            </Button>
          }
        />
      ) : (
        <>
          <Section title={t('app.appointments.upcoming')} className="mt-0">
            {upcoming.length === 0 ? (
              <Empty
                title={t('app.appointments.empty')}
                action={
                  <Button asChild className={BIG}>
                    <Link to="/app/booking">{t('app.appointments.book')}</Link>
                  </Button>
                }
              />
            ) : (
              <ul className="flex flex-col gap-3">{upcoming.map((a) => card(a, true))}</ul>
            )}
          </Section>
          {past.length > 0 && (
            <Section title={t('app.appointments.past')}>
              <ul className="flex flex-col gap-3">{past.map((a) => card(a, false))}</ul>
            </Section>
          )}
        </>
      )}
      <ConfirmDialog
        open={target !== null}
        onOpenChange={(o) => {
          if (!o) setTarget(null);
        }}
        title={t('app.appointments.cancelConfirm')}
        description={t('app.appointments.cancelText')}
        confirmLabel={t('app.appointments.cancel')}
        cancelLabel={t('app.appointments.keep')}
        danger
        loading={cancel.isPending}
        onConfirm={() => void confirmCancel()}
      />
    </>
  );
}
