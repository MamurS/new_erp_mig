import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Bell, CalendarDays, CalendarPlus, ChevronRight, FileBadge, Headphones, MapPin, MessageCircle, Phone, QrCode, Receipt, type LucideIcon, ShieldQuestion } from 'lucide-react';
import { useI18n, type I18nKey } from '@/i18n';
import { useMe, useMeLimits, useMePolicy, useMyAppointments, useMyClaims } from '@/shared/api/queries/me';
import { useMyAssistance } from '@/shared/api/queries/assist';
import { safeUrl } from '@/shared/lib/safeUrl';
import type { LimitCategory } from '@/shared/types';
import { formatDate, formatMoney, formatTime } from '@/shared/lib/format';
import { RELATION_LABEL } from '@/shared/domain/family';
import { upcomingAppointments } from '../lib';
import { useDocumentTitle } from '@/shared/lib/hooks';
import { cn } from '@/shared/lib/cn';
import { Button } from '@/shared/ui/button';
import { Modal } from '@/shared/ui/dialog';
import { Skeleton } from '@/shared/ui/states';
import { LanguageButton } from '@/shared/ui/language-switch';
import { CardSkeletons, ClaimStepBar, Empty, LoadError, Section, StatusPill } from '../components';
import { LimitsList } from '../LimitsList';
import { MedicalHidden, ProfileSwitcher, usePerson } from '../person';

/** `medical`: about the picked person's care — hidden while an adult family member has not allowed it. */
const TILES: { to: string; label: I18nKey; icon: LucideIcon; tone: string; medical?: boolean }[] = [
  { to: '/app/booking', label: 'app.tile.booking', icon: CalendarPlus, tone: 'bg-sky text-sky-text', medical: true },
  { to: '/app/claims/new', label: 'app.tile.refund', icon: Receipt, tone: 'bg-peach text-peach-text', medical: true },
  { to: '/app/clinics', label: 'app.tile.clinics', icon: MapPin, tone: 'bg-sun text-sun-text' },
  { to: '/app/chat', label: 'app.tile.chat', icon: MessageCircle, tone: 'bg-accent-soft text-accent-text' },
  { to: '/app/coverage', label: 'app.tile.coverage', icon: ShieldQuestion, tone: 'bg-rail text-text', medical: true },
];

const CATEGORIES: LimitCategory[] = ['outpatient', 'dental', 'medicines', 'inpatient'];

/** «Ваш ассистанс 24/7» (ASSISTANCE_SPEC §5.1): shown when the policy is served by an assistance company. */
function AssistanceCard() {
  const { t } = useI18n();
  const q = useMyAssistance();
  const a = q.data?.assistance;
  if (!a) return null;
  return (
    <section className="mt-4 flex items-center gap-3 rounded-card border border-border bg-surface p-4" aria-label={t('app.home.assistance')} data-testid="assistance-card">
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent-text">
        <Headphones className="h-5 w-5" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] text-muted">{t('app.home.assistance')}</p>
        <p className="truncate font-bold" data-testid="assistance-name">
          {a.name}
        </p>
        <p className="text-[12px] text-muted">{t('app.home.assistanceHint')}</p>
      </div>
      <Button asChild className="h-11 shrink-0 rounded-btn px-4 font-semibold">
        <a href={safeUrl(`tel:${a.phone24x7.replace(/[^\d+]/g, '')}`)}>
          <Phone className="h-4 w-4" aria-hidden />
          {t('app.home.call')}
        </a>
      </Button>
    </section>
  );
}

/** The latest receipt of the picked person. */
function LatestClaim({ personId }: { personId: string | undefined }) {
  const { t } = useI18n();
  const claims = useMyClaims(personId);
  const latest = claims.data?.[0];
  return (
    <Section
      title={t('app.home.claims')}
      action={
        claims.data && claims.data.length > 0 ? (
          <Link to="/app/claims" className="flex min-h-[44px] items-center gap-0.5 px-1 font-semibold text-accent-text">
            {t('app.home.allClaims')}
            <ChevronRight className="h-4 w-4" aria-hidden />
          </Link>
        ) : null
      }
    >
      {claims.isLoading ? (
        <CardSkeletons count={1} />
      ) : claims.isError ? (
        <LoadError error={claims.error} onRetry={() => void claims.refetch()} />
      ) : latest ? (
        <Link to={`/app/claims/${latest.id}`} className="block rounded-card border border-border bg-surface p-4 hover:border-accent" data-testid="home-latest-claim">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate font-bold">{latest.providerName}</p>
              <p className="font-heading text-[18px] font-semibold">{formatMoney(latest.amountClaimed)}</p>
            </div>
            <StatusPill status={latest.status} />
          </div>
          <ClaimStepBar claim={latest} className="mt-3" />
        </Link>
      ) : (
        <Empty
          title={t('app.home.noClaims')}
          action={
            <Button asChild className="h-12 rounded-btn px-5 text-[15px] font-semibold">
              <Link to="/app/claims/new">{t('app.tile.refund')}</Link>
            </Button>
          }
        />
      )}
    </Section>
  );
}

/** The next appointment of the picked person (shown only when there is one). */
function NextAppointment({ personId }: { personId: string | undefined }) {
  const { t } = useI18n();
  const q = useMyAppointments(personId);
  const [now] = useState(() => Date.now());
  const next = upcomingAppointments(q.data ?? [], now)[0];
  if (!next) return null;
  return (
    <Section
      title={t('app.home.nextAppointment')}
      action={
        <Link to="/app/appointments" className="flex min-h-[44px] items-center gap-0.5 px-1 font-semibold text-accent-text">
          {t('app.home.allAppointments')}
          <ChevronRight className="h-4 w-4" aria-hidden />
        </Link>
      }
    >
      <div className="rounded-card border border-border bg-surface p-4" data-testid="home-next-appointment">
        <p className="font-bold">{t(`app.specialty.${next.specialty}`)}</p>
        <p className="truncate text-[14px] text-muted">{next.clinicName}</p>
        <p className="mt-0.5 flex items-center gap-1 text-[14px] font-semibold">
          <CalendarDays className="h-3.5 w-3.5 shrink-0" aria-hidden />
          {t('app.appointments.at', { date: formatDate(next.startsAt), time: formatTime(next.startsAt) })}
        </p>
      </div>
    </Section>
  );
}

/** «Сколько осталось» of the picked person. */
function Limits({ personId, onWhatCovered }: { personId: string | undefined; onWhatCovered: () => void }) {
  const { t } = useI18n();
  const limits = useMeLimits(personId);
  return (
    <Section
      title={t('app.home.limits')}
      action={
        <button type="button" onClick={onWhatCovered} className="min-h-[44px] px-1 text-[14px] font-semibold text-accent-text underline-offset-2 hover:underline">
          {t('app.home.whatCovered')}
        </button>
      }
    >
      {limits.isLoading ? (
        <CardSkeletons count={4} />
      ) : limits.isError || !limits.data ? (
        <LoadError error={limits.error} onRetry={() => void limits.refetch()} />
      ) : (
        <LimitsList limits={limits.data} />
      )}
    </Section>
  );
}

export default function HomePage() {
  const { t } = useI18n();
  useDocumentTitle(t('app.nav.home'));
  const me = useMe();
  const { personId, person, isSelf, medical } = usePerson();
  const policy = useMePolicy(personId);
  const [bellOpen, setBellOpen] = useState(false);
  const [coverOpen, setCoverOpen] = useState(false);

  return (
    <div>
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {me.isLoading ? (
            <Skeleton className="h-8 w-48" />
          ) : (
            <h1 className="font-heading text-[24px] font-semibold leading-tight">
              {t('app.home.greeting', { name: me.data?.firstName ?? '' })}
            </h1>
          )}
          <p className="mt-1 text-muted">{t('app.home.subtitle')}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <LanguageButton />
          <button
            type="button"
            aria-label={t('app.home.notifications')}
            onClick={() => setBellOpen(true)}
            className="flex h-11 w-11 items-center justify-center rounded-full border border-border bg-surface hover:bg-rail"
          >
            <Bell className="h-5 w-5" aria-hidden />
          </button>
        </div>
      </header>

      <ProfileSwitcher className="mt-4" />

      {/* Policy card of the picked person */}
      <section className="relative mt-5 overflow-hidden rounded-hero bg-accent-soft p-5" data-testid="home-policy">
        <div aria-hidden className="pointer-events-none absolute -right-10 -top-12 h-40 w-40 rounded-full bg-accent/10" />
        <div aria-hidden className="pointer-events-none absolute -bottom-16 right-16 h-32 w-32 rounded-full bg-accent/10" />
        {policy.isLoading ? (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-5 w-3/4" />
            <Skeleton className="h-7 w-1/2" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : policy.isError || !policy.data ? (
          <LoadError error={policy.error} onRetry={() => void policy.refetch()} />
        ) : (
          <div className="relative">
            {!isSelf && person && (
              <p className="mb-1 font-heading text-[18px] font-semibold" data-testid="home-person">
                {person.fullName} · <span className="text-[15px] font-normal text-muted">{RELATION_LABEL[person.relation]}</span>
              </p>
            )}
            <p className="text-[14px] font-semibold text-accent-text">{t('app.home.insuredVia', { company: policy.data.companyName })}</p>
            <p className="mt-1 font-heading text-[22px] font-semibold">{t('app.home.program', { name: policy.data.programName })}</p>
            <p className="mt-0.5 text-[14px] text-muted">
              {t('app.home.term', { from: formatDate(policy.data.startDate), to: formatDate(policy.data.endDate) })}
            </p>
            {policy.data.certificateNumber && (
              <p className="mt-0.5 text-[14px] text-muted">
                {t('app.card.certificate')}: <span className="num font-semibold text-text" data-testid="home-certificate">{policy.data.certificateNumber}</span>
              </p>
            )}
            <Button asChild className="mt-4 h-12 w-full rounded-btn text-[15px] font-semibold">
              <Link to="/app/card">
                <QrCode className="h-5 w-5" aria-hidden />
                {t('app.home.cardButton')}
              </Link>
            </Button>
            {!isSelf && (
              <Button asChild variant="secondary" className="mt-2 h-12 w-full rounded-btn text-[15px] font-semibold">
                <Link to="/app/certificate">
                  <FileBadge className="h-5 w-5" aria-hidden />
                  {t('app.card.certificate')}
                </Link>
              </Button>
            )}
          </div>
        )}
      </section>

      {isSelf && <AssistanceCard />}

      {/* Tiles */}
      <nav className="mt-4 grid grid-cols-2 gap-3">
        {TILES.filter((x) => medical || !x.medical).map(({ to, label, icon: Icon, tone }) => (
          <Link
            key={to}
            to={to}
            className="flex min-h-[104px] flex-col justify-between gap-3 rounded-card border border-border bg-surface p-4 font-bold leading-snug hover:border-accent"
          >
            <span className={cn('flex h-11 w-11 items-center justify-center rounded-full', tone)}>
              <Icon className="h-5 w-5" aria-hidden />
            </span>
            {t(label)}
          </Link>
        ))}
      </nav>

      {medical ? (
        <>
          <NextAppointment key={`a-${personId ?? 'self'}`} personId={personId} />
          <LatestClaim personId={personId} />
          <Limits personId={personId} onWhatCovered={() => setCoverOpen(true)} />
        </>
      ) : (
        <Section title={t('app.home.claims')}>
          <MedicalHidden person={person} />
        </Section>
      )}

      <Modal open={bellOpen} onOpenChange={setBellOpen} title={t('app.home.notifications')}>
        <p className="py-4 text-center text-muted">{t('app.home.noNotifications')}</p>
        <Button variant="secondary" onClick={() => setBellOpen(false)} className="h-12 w-full rounded-btn text-[15px]">
          {t('app.common.close')}
        </Button>
      </Modal>

      <Modal open={coverOpen} onOpenChange={setCoverOpen} title={t('app.program.title', { name: policy.data?.programName ?? '' })}>
        <p className="leading-relaxed">{t('app.program.desc')}</p>
        {policy.data && (
          <dl className="mt-3 divide-y divide-border-soft rounded-card border border-border px-4">
            {CATEGORIES.map((c) => (
              <div key={c} className="flex justify-between gap-3 py-2.5">
                <dt className="text-muted">{t(`app.category.${c}`)}</dt>
                <dd className="font-bold">{formatMoney(policy.data.limits[c])}</dd>
              </div>
            ))}
          </dl>
        )}
        <p className="mt-3 text-[14px] text-muted">{t('app.program.notCovered')}</p>
        <Button variant="secondary" onClick={() => setCoverOpen(false)} className="mt-4 h-12 w-full rounded-btn text-[15px]">
          {t('app.common.close')}
        </Button>
      </Modal>
    </div>
  );
}
