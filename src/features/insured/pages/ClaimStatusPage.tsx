import { Link, useParams } from 'react-router-dom';
import { Banknote, CheckCircle2, CircleX, Inbox, MessageCircle, SearchCheck, type LucideIcon } from 'lucide-react';
import { useI18n } from '@/i18n';
import { useMeLimits, useMyClaim } from '@/shared/api/queries/me';
import { ApiRequestError } from '@/shared/api/client';
import type { MyClaim } from '@/shared/types';
import { CLAIM_TO_LIMIT } from '@/shared/domain/claims';
import { formatDate, formatMoney } from '@/shared/lib/format';
import { useDocumentTitle } from '@/shared/lib/hooks';
import { cn } from '@/shared/lib/cn';
import { Button } from '@/shared/ui/button';
import { Skeleton } from '@/shared/ui/states';
import { BIG, Empty, LoadError, ScreenHeader, Section } from '../components';
import { isUuid } from '../lib';

const HERO: Record<MyClaim['status'], { icon: LucideIcon; tone: string }> = {
  received: { icon: Inbox, tone: 'bg-sky text-sky-text' },
  checking: { icon: SearchCheck, tone: 'bg-sun text-sun-text' },
  approved: { icon: CheckCircle2, tone: 'bg-accent-soft text-accent-text' },
  rejected: { icon: CircleX, tone: 'bg-danger-soft text-danger-text' },
  paid: { icon: Banknote, tone: 'bg-accent-soft text-accent-text' },
};

function NotFound() {
  const { t } = useI18n();
  return (
    <Empty
      title={`${t('status.notFound')}. ${t('status.notFoundText')}`}
      action={
        <Button asChild className={BIG}>
          <Link to="/app/claims">{t('status.toClaims')}</Link>
        </Button>
      }
    />
  );
}

export default function ClaimStatusPage() {
  const { t } = useI18n();
  useDocumentTitle(t('status.title'));
  const { claimId } = useParams();
  const validId = isUuid(claimId) ? claimId : undefined;
  const q = useMyClaim(validId);
  const limits = useMeLimits();

  const notFound = !validId || (q.error instanceof ApiRequestError && q.error.status === 404);

  let body;
  if (notFound) body = <NotFound />;
  else if (q.isLoading)
    body = (
      <div className="flex flex-col gap-3" role="status" aria-label={t('common.loading')}>
        <Skeleton className="h-40 w-full rounded-hero" />
        <Skeleton className="h-48 w-full rounded-card" />
      </div>
    );
  else if (q.isError || !q.data) body = <LoadError error={q.error} onRetry={() => void q.refetch()} />;
  else {
    const c = q.data;
    const hero = HERO[c.status];
    const Icon = hero.icon;
    const limitCat = CLAIM_TO_LIMIT[c.category];
    const usage = limits.data?.find((l) => l.category === limitCat);
    body = (
      <>
        <section className={cn('rounded-hero p-5', hero.tone)}>
          <Icon className="h-9 w-9" aria-hidden />
          <h2 className="mt-2 font-heading text-[26px] font-semibold">{t(`claimStatus.${c.status}`)}</h2>
          <p className="mt-1 text-[15px] font-semibold">
            {c.status === 'rejected' ? (c.rejectionReason ?? '') : t(`status.sub.${c.status}`)}
          </p>
          <p className="mt-3 font-heading text-[28px] font-semibold text-text">{formatMoney(c.amountClaimed)}</p>
          {c.amountApproved !== undefined && c.status !== 'rejected' && (
            <p className="text-[14px] font-semibold">{t('status.approvedAmount', { amount: formatMoney(c.amountApproved) })}</p>
          )}
          {c.expectedPayoutBy && c.status !== 'rejected' && c.status !== 'paid' && (
            <p className="mt-1 text-[14px]">{t('status.expected', { date: formatDate(c.expectedPayoutBy) })}</p>
          )}
          {(c.status === 'approved' || c.status === 'paid') && <p className="mt-1 text-[14px]">{t('status.card', { card: c.payoutCardMasked })}</p>}
          {c.status === 'rejected' && (
            <Button asChild variant="secondary" className="mt-4 h-12 w-full rounded-btn text-[15px] font-semibold">
              <Link to="/app/chat">
                <MessageCircle className="h-5 w-5" aria-hidden />
                {t('status.writeUs')}
              </Link>
            </Button>
          )}
        </section>

        <Section title={t('status.steps')}>
          <ol className="rounded-card border border-border bg-surface p-4">
            {c.steps.map((s, i) => {
              const last = i === c.steps.length - 1;
              return (
                <li key={s.key} className="relative flex gap-3 pb-4 last:pb-0">
                  {!last && <span aria-hidden className={cn('absolute left-[11px] top-6 h-[calc(100%-20px)] w-0.5', s.done ? 'bg-accent' : 'bg-rail')} />}
                  <span
                    aria-hidden
                    className={cn(
                      'relative z-[1] mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2',
                      s.done ? 'border-accent bg-accent text-white' : 'border-border bg-surface',
                    )}
                  >
                    {s.done && <CheckCircle2 className="h-4 w-4" />}
                  </span>
                  <div>
                    <p className={cn('font-bold', !s.done && 'text-muted')}>{t(`claimStep.${s.key}`)}</p>
                    {s.at && <p className="text-[13px] text-muted">{formatDate(s.at)}</p>}
                  </div>
                </li>
              );
            })}
          </ol>
        </Section>

        <Section title={t('status.details')}>
          <dl className="divide-y divide-border-soft rounded-card border border-border bg-surface px-4">
            <div className="flex justify-between gap-3 py-3">
              <dt className="text-muted">{t('status.number')}</dt>
              <dd className="num text-[14px] font-bold">{c.number}</dd>
            </div>
            <div className="flex justify-between gap-3 py-3">
              <dt className="text-muted">{t('status.what')}</dt>
              <dd className="text-right font-bold">{t(`claimCat.${c.category}`)}</dd>
            </div>
            <div className="flex justify-between gap-3 py-3">
              <dt className="text-muted">{t('status.where')}</dt>
              <dd className="text-right font-bold">{c.providerName}</dd>
            </div>
            <div className="flex justify-between gap-3 py-3">
              <dt className="text-muted">{t('status.date')}</dt>
              <dd className="font-bold">{formatDate(c.serviceDate)}</dd>
            </div>
          </dl>
          {usage && (
            <p className="mt-3 rounded-card bg-sky px-4 py-3 font-semibold text-sky-text">
              {t('status.left', { category: t(`limitAcc.${limitCat}`), amount: formatMoney(Math.max(0, usage.limit - usage.used)) })}
            </p>
          )}
        </Section>

        <Button asChild variant="secondary" className={cn(BIG, 'mt-6')}>
          <Link to="/app/chat">
            <MessageCircle className="h-5 w-5" aria-hidden />
            {t('status.question')}
          </Link>
        </Button>
      </>
    );
  }

  return (
    <div>
      <ScreenHeader title={t('status.title')} back="/app/claims" />
      {body}
    </div>
  );
}
