import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Bell, CalendarPlus, ChevronRight, Headphones, MapPin, MessageCircle, Phone, QrCode, Receipt, type LucideIcon } from 'lucide-react';
import { useI18n, type I18nKey } from '@/i18n';
import { useMe, useMeLimits, useMePolicy, useMyClaims } from '@/shared/api/queries/me';
import { useMyAssistance } from '@/shared/api/queries/assist';
import { safeUrl } from '@/shared/lib/safeUrl';
import type { LimitCategory } from '@/shared/types';
import { formatDate, formatMoney } from '@/shared/lib/format';
import { useDocumentTitle } from '@/shared/lib/hooks';
import { cn } from '@/shared/lib/cn';
import { Button } from '@/shared/ui/button';
import { Modal } from '@/shared/ui/dialog';
import { Skeleton } from '@/shared/ui/states';
import { CardSkeletons, ClaimStepBar, Empty, LangSwitch, LoadError, Section, StatusPill } from '../components';
import { LimitsList } from '../LimitsList';

const TILES: { to: string; label: I18nKey; icon: LucideIcon; tone: string }[] = [
  { to: '/app/booking', label: 'tile.booking', icon: CalendarPlus, tone: 'bg-sky text-sky-text' },
  { to: '/app/claims/new', label: 'tile.refund', icon: Receipt, tone: 'bg-peach text-peach-text' },
  { to: '/app/clinics', label: 'tile.clinics', icon: MapPin, tone: 'bg-sun text-sun-text' },
  { to: '/app/chat', label: 'tile.chat', icon: MessageCircle, tone: 'bg-accent-soft text-accent-text' },
];

const CATEGORIES: LimitCategory[] = ['outpatient', 'dental', 'medicines', 'inpatient'];

/** «Ваш ассистанс 24/7» (ASSISTANCE_SPEC §5.1): shown when the policy is served by an assistance company. */
function AssistanceCard() {
  const { t } = useI18n();
  const q = useMyAssistance();
  const a = q.data?.assistance;
  if (!a) return null;
  return (
    <section className="mt-4 flex items-center gap-3 rounded-card border border-border bg-surface p-4" aria-label={t('home.assistance')} data-testid="assistance-card">
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent-text">
        <Headphones className="h-5 w-5" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] text-muted">{t('home.assistance')}</p>
        <p className="truncate font-bold" data-testid="assistance-name">
          {a.name}
        </p>
        <p className="text-[12px] text-muted">{t('home.assistanceHint')}</p>
      </div>
      <Button asChild className="h-11 shrink-0 rounded-btn px-4 font-semibold">
        <a href={safeUrl(`tel:${a.phone24x7.replace(/[^\d+]/g, '')}`)}>
          <Phone className="h-4 w-4" aria-hidden />
          {t('home.call')}
        </a>
      </Button>
    </section>
  );
}

export default function HomePage() {
  const { t } = useI18n();
  useDocumentTitle(t('nav.home'));
  const me = useMe();
  const policy = useMePolicy();
  const limits = useMeLimits();
  const claims = useMyClaims();
  const [bellOpen, setBellOpen] = useState(false);
  const [coverOpen, setCoverOpen] = useState(false);
  const latest = claims.data?.[0];

  return (
    <div>
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {me.isLoading ? (
            <Skeleton className="h-8 w-48" />
          ) : (
            <h1 className="font-heading text-[24px] font-semibold leading-tight">
              {t('home.greeting', { name: me.data?.firstName ?? '' })}
            </h1>
          )}
          <p className="mt-1 text-muted">{t('home.subtitle')}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <LangSwitch />
          <button
            type="button"
            aria-label={t('home.notifications')}
            onClick={() => setBellOpen(true)}
            className="flex h-11 w-11 items-center justify-center rounded-full border border-border bg-surface hover:bg-rail"
          >
            <Bell className="h-5 w-5" aria-hidden />
          </button>
        </div>
      </header>

      {/* Policy card */}
      <section className="relative mt-5 overflow-hidden rounded-hero bg-accent-soft p-5">
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
            <p className="text-[14px] font-semibold text-accent-text">{t('home.insuredVia', { company: policy.data.companyName })}</p>
            <p className="mt-1 font-heading text-[22px] font-semibold">{t('home.program', { name: policy.data.programName })}</p>
            <p className="mt-0.5 text-[14px] text-muted">
              {t('home.term', { from: formatDate(policy.data.startDate), to: formatDate(policy.data.endDate) })}
            </p>
            <Button asChild className="mt-4 h-12 w-full rounded-btn text-[15px] font-semibold">
              <Link to="/app/card">
                <QrCode className="h-5 w-5" aria-hidden />
                {t('home.cardButton')}
              </Link>
            </Button>
          </div>
        )}
      </section>

      <AssistanceCard />

      {/* Tiles */}
      <nav className="mt-4 grid grid-cols-2 gap-3">
        {TILES.map(({ to, label, icon: Icon, tone }) => (
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

      {/* Latest claim */}
      <Section
        title={t('home.claims')}
        action={
          claims.data && claims.data.length > 0 ? (
            <Link to="/app/claims" className="flex min-h-[44px] items-center gap-0.5 px-1 font-semibold text-accent-text">
              {t('home.allClaims')}
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
          <Link to={`/app/claims/${latest.id}`} className="block rounded-card border border-border bg-surface p-4 hover:border-accent">
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
            title={t('home.noClaims')}
            action={
              <Button asChild className="h-12 rounded-btn px-5 text-[15px] font-semibold">
                <Link to="/app/claims/new">{t('tile.refund')}</Link>
              </Button>
            }
          />
        )}
      </Section>

      {/* Limits */}
      <Section
        title={t('home.limits')}
        action={
          <button type="button" onClick={() => setCoverOpen(true)} className="min-h-[44px] px-1 text-[14px] font-semibold text-accent-text underline-offset-2 hover:underline">
            {t('home.whatCovered')}
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

      <Modal open={bellOpen} onOpenChange={setBellOpen} title={t('home.notifications')}>
        <p className="py-4 text-center text-muted">{t('home.noNotifications')}</p>
        <Button variant="secondary" onClick={() => setBellOpen(false)} className="h-12 w-full rounded-btn text-[15px]">
          {t('common.close')}
        </Button>
      </Modal>

      <Modal open={coverOpen} onOpenChange={setCoverOpen} title={t('program.title', { name: policy.data?.programName ?? '' })}>
        <p className="leading-relaxed">{t('program.desc')}</p>
        {policy.data && (
          <dl className="mt-3 divide-y divide-border-soft rounded-card border border-border px-4">
            {CATEGORIES.map((c) => (
              <div key={c} className="flex justify-between gap-3 py-2.5">
                <dt className="text-muted">{t(`category.${c}`)}</dt>
                <dd className="font-bold">{formatMoney(policy.data.limits[c])}</dd>
              </div>
            ))}
          </dl>
        )}
        <p className="mt-3 text-[14px] text-muted">{t('program.notCovered')}</p>
        <Button variant="secondary" onClick={() => setCoverOpen(false)} className="mt-4 h-12 w-full rounded-btn text-[15px]">
          {t('common.close')}
        </Button>
      </Modal>
    </div>
  );
}
