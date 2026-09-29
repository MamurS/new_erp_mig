import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { useI18n } from '@/i18n';
import { useCardToken, useMe, useMePolicy } from '@/shared/api/queries/me';
import { useCountdown, useDocumentTitle } from '@/shared/lib/hooks';
import { logger } from '@/shared/lib/logger';
import { Skeleton } from '@/shared/ui/states';
import { LoadError, ScreenHeader } from '../components';
import { qrPayload } from '../lib';

export default function CardPage() {
  const { t } = useI18n();
  useDocumentTitle(t('card.title'));
  const token = useCardToken();
  const me = useMe();
  const policy = useMePolicy();
  const [qr, setQr] = useState<string | null>(null);
  const expiresAt = token.data ? Date.parse(token.data.expiresAt) : null;
  const left = useCountdown(expiresAt);
  const { refetch, isFetching } = token;

  useEffect(() => {
    const value = token.data?.token;
    if (!value) return;
    let alive = true;
    QRCode.toDataURL(qrPayload(value), { width: 560, margin: 1, errorCorrectionLevel: 'M' })
      .then((url) => {
        if (alive) setQr(url);
      })
      .catch(() => logger.warn('qr render failed'));
    return () => {
      alive = false;
    };
  }, [token.data?.token]);

  // Belt and braces: refresh as soon as the token expires, even if the interval drifted.
  useEffect(() => {
    if (expiresAt && left === 0 && !isFetching) void refetch();
  }, [expiresAt, left, isFetching, refetch]);

  return (
    <div>
      <ScreenHeader title={t('card.title')} back="/app" />
      <section className="flex flex-col items-center rounded-hero border border-border bg-surface p-5 text-center">
        {token.isError ? (
          <LoadError error={token.error} onRetry={() => void token.refetch()} />
        ) : qr && token.data ? (
          <img src={qr} alt={t('card.qrAlt')} width={280} height={280} className="h-[280px] w-[280px] max-w-full" data-testid="card-qr" />
        ) : (
          <Skeleton className="h-[280px] w-[280px] max-w-full rounded-card" />
        )}
        <p className="mt-3 text-[14px] font-semibold text-muted" aria-live="off">
          {t('card.refresh', { sec: left })}
        </p>
        <div className="mt-4 w-full border-t border-border-soft pt-4">
          {me.isLoading ? (
            <Skeleton className="mx-auto h-7 w-3/4" />
          ) : (
            <p className="font-heading text-[20px] font-semibold">{me.data?.fullName}</p>
          )}
          {policy.data && (
            <dl className="mt-3 grid grid-cols-2 gap-3 text-left">
              <div className="rounded-btn bg-rail px-3 py-2">
                <dt className="text-[12px] text-muted">{t('card.policy')}</dt>
                <dd className="font-bold num text-[14px]">{policy.data.number}</dd>
              </div>
              <div className="rounded-btn bg-rail px-3 py-2">
                <dt className="text-[12px] text-muted">{t('card.program')}</dt>
                <dd className="font-bold">{policy.data.programName}</dd>
              </div>
            </dl>
          )}
          {(me.isError || policy.isError) && (
            <div className="mt-3">
              <LoadError
                error={me.error ?? policy.error}
                onRetry={() => {
                  void me.refetch();
                  void policy.refetch();
                }}
              />
            </div>
          )}
        </div>
      </section>
      <p className="mt-4 rounded-card bg-sky px-4 py-3 text-center font-semibold text-sky-text">{t('card.hint')}</p>
    </div>
  );
}
