import { tashkentParts } from '@mig/domain/lib/format';
import { useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, MapPin } from 'lucide-react';
import { useI18n } from '@/i18n';
import { useBookAppointment, useMeLimits, useNearbyClinics } from '@/shared/api/queries/me';
import { useSlots } from '@/shared/api/queries/staff';
import { errorMessage } from '@/shared/api/client';
import type { Clinic, Specialty } from '@mig/contracts';
import { formatMoney, formatTime } from '@mig/domain/lib/format';
import { useDocumentTitle } from '@/shared/lib/hooks';
import { isNearLimit } from '@mig/domain/limits';
import { cn } from '@/shared/lib/cn';
import { Button } from '@/shared/ui/button';
import { Skeleton } from '@/shared/ui/states';
import { toast } from '@/shared/ui/toast';
import { BIG, CardSkeletons, ChoiceChip, Empty, LoadError, ScreenHeader, SPECIALTY_ICON, WizardSteps } from '../components';
import { NoMedical, PersonNote, usePerson } from '../person';
import { dayLabel, isSpecialty, isUuid, limitForSpecialty, nextDays, SPECIALTIES } from '../lib';
import { limitLeft } from '@mig/domain/assistance';
import { useDmsParam } from '@/shared/api/queries/params';

interface SlotPick {
  clinicId: string;
  clinicName: string;
  clinicAddress: string;
  startsAt: string;
}

/** Wizard entry point from /app/clinics: router state or safe query params (ids and enum values only). */
function useEntry(): { specialty: Specialty | null; clinicId: string | null } {
  const loc = useLocation();
  const [params] = useSearchParams();
  const st = (loc.state ?? null) as { specialty?: unknown; clinicId?: unknown } | null;
  const specialty = st?.specialty ?? params.get('specialty');
  const clinicId = st?.clinicId ?? params.get('clinicId');
  return { specialty: isSpecialty(specialty) ? specialty : null, clinicId: isUuid(clinicId) ? clinicId : null };
}

const MAX_SLOTS = 8;
const MAX_CLINICS = 6;

function ClinicSlots({ clinic, day, picked, onPick }: { clinic: Clinic; day: string; picked: SlotPick | null; onPick: (p: SlotPick) => void }) {
  const { t } = useI18n();
  const slots = useSlots(clinic.id, day);
  return (
    <li className={cn('rounded-card border bg-surface p-4', picked?.clinicId === clinic.id ? 'border-accent' : 'border-border')}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-bold">{clinic.name}</p>
          <p className="mt-0.5 flex items-start gap-1 text-[13px] text-muted">
            <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            <span>{clinic.address}</span>
          </p>
        </div>
        {clinic.distanceKm !== undefined && (
          <span className="shrink-0 rounded-full bg-sky px-2 py-0.5 text-[12px] font-bold text-sky-text">{t('app.clinics.km', { km: clinic.distanceKm })}</span>
        )}
      </div>
      <div className="mt-3">
        {slots.isLoading ? (
          <div className="flex gap-2">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-11 w-16" />
            ))}
          </div>
        ) : slots.isError ? (
          <LoadError error={slots.error} onRetry={() => void slots.refetch()} />
        ) : slots.data && slots.data.length > 0 ? (
          <div role="group" aria-label={t('app.booking.slotsLabel', { clinic: clinic.name })} className="flex flex-wrap gap-2">
            {slots.data.slice(0, MAX_SLOTS).map((s) => {
              const selected = picked?.clinicId === clinic.id && picked.startsAt === s.startsAt;
              return (
                <ChoiceChip
                  key={s.startsAt}
                  selected={selected}
                  onClick={() => onPick({ clinicId: clinic.id, clinicName: clinic.name, clinicAddress: clinic.address, startsAt: s.startsAt })}
                  className="num min-w-[64px]"
                >
                  {formatTime(s.startsAt)}
                </ChoiceChip>
              );
            })}
            {slots.data.some((s) => s.fromClinicSystem) && <p className="w-full text-[12px] text-muted">{t('app.booking.fromClinic')}</p>}
          </div>
        ) : (
          <p className="text-[14px] text-muted">{t('app.booking.noSlots')}</p>
        )}
      </div>
    </li>
  );
}

export default function BookingPage() {
  const { medical } = usePerson();
  return medical ? <Booking /> : <NoMedical />;
}

function Booking() {
  const { t } = useI18n();
  useDocumentTitle(t('app.booking.title'));
  const navigate = useNavigate();
  const entry = useEntry();
  const [step, setStep] = useState<0 | 1 | 2 | 3>(entry.specialty ? 1 : 0);
  const [specialty, setSpecialty] = useState<Specialty | null>(entry.specialty);
  const days = useMemo(() => nextDays(4), []);
  // Clinics take patients until 18:00: late in the day, start with tomorrow.
  const [day, setDay] = useState<string>(() => (tashkentParts(new Date()).hh >= 17 ? days[1] : days[0]) ?? '');
  const [picked, setPicked] = useState<SlotPick | null>(null);
  const [error, setError] = useState<string | null>(null);
  const book = useBookAppointment();
  const { personId } = usePerson();

  const labels = [t('app.booking.step1'), t('app.booking.step2'), t('app.booking.step3')];

  const goBack = () => {
    setError(null);
    if (step === 1 || step === 2) setStep((step - 1) as 0 | 1);
    else navigate('/app');
  };

  const submit = async () => {
    if (!specialty || !picked) return;
    setError(null);
    try {
      await book.mutateAsync({ clinicId: picked.clinicId, specialty, startsAt: picked.startsAt, personId });
      toast.success(t('app.booking.booked'));
      setStep(3);
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  if (step === 3) {
    return (
      <div className="animate-step flex flex-col items-center px-2 pt-10 text-center">
        <span className="flex h-20 w-20 items-center justify-center rounded-full bg-accent-soft text-accent">
          <CheckCircle2 className="h-10 w-10" aria-hidden />
        </span>
        <h1 className="mt-5 font-heading text-[26px] font-semibold">{t('app.booking.successTitle')}</h1>
        <p className="mt-2 text-[16px]" role="status">
          {t('app.booking.success')}
        </p>
        <div className="mt-8 flex w-full flex-col gap-3">
          <Button asChild className={BIG}>
            <Link to="/app/appointments">{t('app.booking.toAppointments')}</Link>
          </Button>
          <Button asChild variant="secondary" className={BIG}>
            <Link to="/app">{t('app.booking.toHome')}</Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <ScreenHeader title={t('app.booking.title')} back={goBack} />
      <PersonNote />
      <WizardSteps labels={labels} current={step} />
      <div key={step} className="animate-step">
        {step === 0 && (
          <StepDoctor
            value={specialty}
            onPick={(s) => {
              if (s !== specialty) setPicked(null);
              setSpecialty(s);
              setStep(1);
            }}
          />
        )}
        {step === 1 && specialty && (
          <StepWhere
            specialty={specialty}
            preferredClinicId={entry.clinicId}
            days={days}
            day={day}
            onDay={(d) => {
              setDay(d);
              setPicked(null);
            }}
            picked={picked}
            onPick={setPicked}
            onContinue={() => setStep(2)}
          />
        )}
        {step === 2 && specialty && picked && (
          <div>
            <h2 className="font-heading text-[20px] font-semibold">{t('app.booking.confirmTitle')}</h2>
            <dl className="mt-3 divide-y divide-border-soft rounded-card border border-border bg-surface px-4">
              <div className="py-3">
                <dt className="text-[13px] text-muted">{t('app.booking.doctor')}</dt>
                <dd className="font-bold">{t(`app.specialty.${specialty}`)}</dd>
              </div>
              <div className="py-3">
                <dt className="text-[13px] text-muted">{t('app.booking.clinic')}</dt>
                <dd className="font-bold">{picked.clinicName}</dd>
                <dd className="text-[14px] text-muted">{picked.clinicAddress}</dd>
              </div>
              <div className="py-3">
                <dt className="text-[13px] text-muted">{t('app.booking.when')}</dt>
                <dd className="font-bold">
                  {dayLabel(day, t)}, {formatTime(picked.startsAt)}
                </dd>
              </div>
            </dl>
            {error && (
              <p role="alert" className="mt-3 rounded-btn bg-danger-soft px-4 py-3 font-semibold text-danger-text">
                {error}
              </p>
            )}
            <Button onClick={() => void submit()} loading={book.isPending} className={cn(BIG, 'mt-5')}>
              {t('app.booking.submit')}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function StepDoctor({ value, onPick }: { value: Specialty | null; onPick: (s: Specialty) => void }) {
  const { t } = useI18n();
  return (
    <div>
      <h2 className="font-heading text-[20px] font-semibold">{t('app.booking.chooseDoctor')}</h2>
      <ul className="mt-3 grid grid-cols-2 gap-3">
        {SPECIALTIES.map((s) => {
          const Icon = SPECIALTY_ICON[s];
          return (
            <li key={s}>
              <button
                type="button"
                aria-pressed={value === s}
                onClick={() => onPick(s)}
                className={cn(
                  'flex min-h-[96px] w-full flex-col items-start justify-between gap-2 rounded-card border bg-surface p-4 text-left font-bold hover:border-accent',
                  value === s ? 'border-accent' : 'border-border',
                )}
              >
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-sky text-sky-text">
                  <Icon className="h-5 w-5" aria-hidden />
                </span>
                {t(`app.specialty.${s}`)}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function StepWhere(p: {
  specialty: Specialty;
  preferredClinicId: string | null;
  days: string[];
  day: string;
  onDay: (d: string) => void;
  picked: SlotPick | null;
  onPick: (p: SlotPick) => void;
  onContinue: () => void;
}) {
  const { t } = useI18n();
  const clinics = useNearbyClinics(p.specialty);
  const limits = useMeLimits(usePerson().personId);
  const cat = limitForSpecialty(p.specialty);
  const usage = limits.data?.find((l) => l.category === cat);
  const lowShare = useDmsParam('limitLowShare');
  const warn = usage && isNearLimit(usage.used, usage.limit, lowShare);

  const list = useMemo(() => {
    const all = clinics.data ?? [];
    const pref = all.find((c) => c.id === p.preferredClinicId);
    const rest = all.filter((c) => c.id !== p.preferredClinicId);
    return (pref ? [pref, ...rest] : rest).slice(0, MAX_CLINICS);
  }, [clinics.data, p.preferredClinicId]);

  return (
    <div className="pb-4">
      {warn && usage && (
        <div role="note" className="mb-4 flex gap-2 rounded-card bg-peach px-4 py-3 text-[14px] font-semibold text-peach-text">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>
            {t('app.booking.limitWarn', { category: t(`app.limitAcc.${cat}`), amount: formatMoney(limitLeft(usage.limit, usage.used, usage.reserved ?? 0)) })}
          </span>
        </div>
      )}
      <h2 className="font-heading text-[18px] font-semibold">{t('app.booking.chooseDay')}</h2>
      <div role="group" aria-label={t('app.booking.chooseDay')} className="-mx-4 mt-2 flex gap-2 overflow-x-auto px-4 pb-1">
        {p.days.map((d) => (
          <ChoiceChip key={d} selected={p.day === d} onClick={() => p.onDay(d)}>
            {dayLabel(d, t)}
          </ChoiceChip>
        ))}
      </div>
      <h2 className="mt-5 font-heading text-[18px] font-semibold">{t('app.booking.clinicsNearby')}</h2>
      <div className="mt-2">
        {clinics.isLoading ? (
          <CardSkeletons count={3} />
        ) : clinics.isError ? (
          <LoadError error={clinics.error} onRetry={() => void clinics.refetch()} />
        ) : list.length === 0 ? (
          <Empty title={t('app.clinics.empty')} />
        ) : (
          <ul className="flex flex-col gap-3">
            {list.map((c) => (
              <ClinicSlots key={c.id} clinic={c} day={p.day} picked={p.picked} onPick={p.onPick} />
            ))}
          </ul>
        )}
      </div>
      <div className="sticky bottom-[76px] mt-4 rounded-card border border-border bg-surface p-3 shadow-lg">
        <p className="mb-2 truncate text-center text-[14px] font-semibold" aria-live="polite" data-testid="booking-summary">
          {p.picked
            ? t('app.booking.summary', { clinic: p.picked.clinicName, time: formatTime(p.picked.startsAt), day: dayLabel(p.day, t).toLowerCase() })
            : t('app.booking.pickSlot')}
        </p>
        <Button disabled={!p.picked} onClick={p.onContinue} className={BIG}>
          {t('app.common.continue')}
        </Button>
      </div>
    </div>
  );
}
