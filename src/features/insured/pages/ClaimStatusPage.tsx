import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Banknote, CheckCircle2, CircleX, FileText, Inbox, MessageCircle, Scale, SearchCheck, type LucideIcon } from 'lucide-react';
import { useAppeal, useMyClaimLetter } from '@/shared/api/queries/lifecycle';
import { appealSchema } from '@/shared/schemas/forms';
import { letterDocument } from '@/features/documents/builders';
import { DocPreview, DocPrintButton, useStubDocument } from '@/features/documents/DocPreview';
import { Modal } from '@/shared/ui/dialog';
import { Field, Textarea } from '@/shared/ui/input';
import { toast } from '@/shared/ui/toast';
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
import { limitLeft } from '@/shared/domain/assistance';

const HERO: Record<MyClaim['status'], { icon: LucideIcon; tone: string }> = {
  received: { icon: Inbox, tone: 'bg-sky text-sky-text' },
  checking: { icon: SearchCheck, tone: 'bg-sun text-sun-text' },
  approved: { icon: CheckCircle2, tone: 'bg-accent-soft text-accent-text' },
  rejected: { icon: CircleX, tone: 'bg-danger-soft text-danger-text' },
  paid: { icon: Banknote, tone: 'bg-accent-soft text-accent-text' },
};

function AppealBlock({ claim }: { claim: MyClaim }) {
  const { t } = useI18n();
  const appeal = useAppeal();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [error, setError] = useState<string>();
  if (claim.appealStatus)
    return (
      <p className="mt-4 rounded-btn bg-surface/70 px-3 py-2 text-[14px] font-semibold text-text" role="status" data-testid="appeal-status">
        {t(claim.appealStatus === 'open' ? 'app.status.appealOpen' : 'app.status.appealResolved')}
      </p>
    );
  if (!claim.canAppeal) return null;
  const send = async () => {
    const parsed = appealSchema.safeParse({ text });
    if (!parsed.success) return setError(t('app.status.appealError'));
    setError(undefined);
    try {
      await appeal.mutateAsync({ claimId: claim.id, text: parsed.data.text });
      toast.success(t('app.status.appealSent'));
      setOpen(false);
    } catch {
      toast.error(t('app.common.loadError'));
    }
  };
  return (
    <>
      <Button variant="secondary" className="mt-3 h-12 w-full rounded-btn text-[15px] font-semibold" onClick={() => setOpen(true)}>
        <Scale className="h-5 w-5" aria-hidden />
        {t('app.status.appeal')}
      </Button>
      <Modal
        open={open}
        onOpenChange={setOpen}
        title={t('app.status.appeal')}
        description={t('app.status.appealHint')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              {t('app.common.cancel')}
            </Button>
            <Button loading={appeal.isPending} onClick={() => void send()}>
              {t('app.status.appealSend')}
            </Button>
          </>
        }
      >
        <Field label={t('app.status.appealField')} error={error}>
          {(a) => <Textarea {...a} rows={4} maxLength={1000} value={text} onChange={(e) => setText(e.target.value)} />}
        </Field>
      </Modal>
    </>
  );
}

function LetterBlock({ claim }: { claim: MyClaim }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const q = useMyClaimLetter(claim.id, open);
  const input = useMemo(() => (q.data ? letterDocument(q.data) : null), [q.data]);
  const doc = useStubDocument(input);
  if (!claim.letterAvailable) return null;
  return (
    <>
      <Button variant="ghost" className="mt-2 h-11 w-full rounded-btn text-[15px] font-semibold" onClick={() => setOpen(true)}>
        <FileText className="h-5 w-5" aria-hidden />
        {t('app.status.letter')}
      </Button>
      <Modal open={open} onOpenChange={setOpen} title={t('app.status.letter')} wide>
        {doc && input ? (
          <>
            <DocPreview doc={doc} label={t('app.status.letter')} height="h-[55vh]" />
            <DocPrintButton input={() => input} className="mt-3" />
          </>
        ) : (
          <p className="text-muted">{t('app.common.loading')}</p>
        )}
      </Modal>
    </>
  );
}

function NotFound() {
  const { t } = useI18n();
  return (
    <Empty
      title={`${t('app.status.notFound')}. ${t('app.status.notFoundText')}`}
      action={
        <Button asChild className={BIG}>
          <Link to="/app/claims">{t('app.status.toClaims')}</Link>
        </Button>
      }
    />
  );
}

export default function ClaimStatusPage() {
  const { t } = useI18n();
  useDocumentTitle(t('app.status.title'));
  const { claimId } = useParams();
  const validId = isUuid(claimId) ? claimId : undefined;
  const q = useMyClaim(validId);
  const limits = useMeLimits();

  const notFound = !validId || (q.error instanceof ApiRequestError && q.error.status === 404);

  let body;
  if (notFound) body = <NotFound />;
  else if (q.isLoading)
    body = (
      <div className="flex flex-col gap-3" role="status" aria-label={t('app.common.loading')}>
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
          <h2 className="mt-2 font-heading text-[26px] font-semibold">{t(`app.claimStatus.${c.status}`)}</h2>
          <p className="mt-1 text-[15px] font-semibold">
            {c.status === 'rejected' ? (c.rejectionReason ?? '') : t(`app.status.sub.${c.status}`)}
          </p>
          {c.status !== 'rejected' && c.rejectionReason && <p className="mt-1 text-[14px]">{c.rejectionReason}</p>}
          {c.clauseRef && (
            <p className="mt-1 text-[14px]" data-testid="claim-clause">
              {t('app.status.clause', { clause: c.clauseRef })}
            </p>
          )}
          <p className="mt-3 font-heading text-[28px] font-semibold text-text">{formatMoney(c.amountClaimed)}</p>
          {c.amountApproved !== undefined && c.status !== 'rejected' && (
            <p className="text-[14px] font-semibold">{t('app.status.approvedAmount', { amount: formatMoney(c.amountApproved) })}</p>
          )}
          {c.expectedPayoutBy && c.status !== 'rejected' && c.status !== 'paid' && (
            <p className="mt-1 text-[14px]">{t('app.status.expected', { date: formatDate(c.expectedPayoutBy) })}</p>
          )}
          {(c.status === 'approved' || c.status === 'paid') && <p className="mt-1 text-[14px]">{t('app.status.card', { card: c.payoutCardMasked })}</p>}
          {c.status === 'rejected' && (
            <Button asChild variant="secondary" className="mt-4 h-12 w-full rounded-btn text-[15px] font-semibold">
              <Link to="/app/chat">
                <MessageCircle className="h-5 w-5" aria-hidden />
                {t('app.status.writeUs')}
              </Link>
            </Button>
          )}
          <AppealBlock claim={c} />
          <LetterBlock claim={c} />
        </section>

        <Section title={t('app.status.steps')}>
          <ol className="rounded-card border border-border bg-surface p-4">
            {c.steps.map((s, i) => {
              const last = i === c.steps.length - 1;
              return (
                <li key={s.key} className="relative flex gap-3 pb-4 last:pb-0">
                  {!last && <span aria-hidden className={cn('absolute left-[11px] top-6 h-[calc(100%-20px)] w-0.5', s.done ? 'bg-accent' : 'bg-rail')} />}
                  <span
                    aria-hidden
                    className={cn(
                      'relative z-1 mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2',
                      s.done ? 'border-accent bg-accent text-white' : 'border-border bg-surface',
                    )}
                  >
                    {s.done && <CheckCircle2 className="h-4 w-4" />}
                  </span>
                  <div>
                    <p className={cn('font-bold', !s.done && 'text-muted')}>{t(`app.claimStep.${s.key}`)}</p>
                    {s.at && <p className="text-[13px] text-muted">{formatDate(s.at)}</p>}
                  </div>
                </li>
              );
            })}
          </ol>
        </Section>

        <Section title={t('app.status.details')}>
          <dl className="divide-y divide-border-soft rounded-card border border-border bg-surface px-4">
            <div className="flex justify-between gap-3 py-3">
              <dt className="text-muted">{t('app.status.number')}</dt>
              <dd className="num text-[14px] font-bold">{c.number}</dd>
            </div>
            <div className="flex justify-between gap-3 py-3">
              <dt className="text-muted">{t('app.status.what')}</dt>
              <dd className="text-right font-bold">{t(`app.claimCat.${c.category}`)}</dd>
            </div>
            <div className="flex justify-between gap-3 py-3">
              <dt className="text-muted">{t('app.status.where')}</dt>
              <dd className="text-right font-bold">{c.providerName}</dd>
            </div>
            <div className="flex justify-between gap-3 py-3">
              <dt className="text-muted">{t('app.status.date')}</dt>
              <dd className="font-bold">{formatDate(c.serviceDate)}</dd>
            </div>
          </dl>
          {usage && (
            <p className="mt-3 rounded-card bg-sky px-4 py-3 font-semibold text-sky-text">
              {t('app.status.left', { category: t(`app.limitAcc.${limitCat}`), amount: formatMoney(limitLeft(usage.limit, usage.used, usage.reserved ?? 0)) })}
            </p>
          )}
        </Section>

        <Button asChild variant="secondary" className={cn(BIG, 'mt-6')}>
          <Link to="/app/chat">
            <MessageCircle className="h-5 w-5" aria-hidden />
            {t('app.status.question')}
          </Link>
        </Button>
      </>
    );
  }

  return (
    <div>
      <ScreenHeader title={t('app.status.title')} back="/app/claims" />
      {body}
    </div>
  );
}
