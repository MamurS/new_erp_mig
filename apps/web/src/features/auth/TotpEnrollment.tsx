/*
 * The first sign-in of a staff, HR, clinic or assistance user without a second factor (BACKEND_SPEC §7): the API
 * answers the password step with `totpEnrollment` (an otpauth URI and its secret); the person adds it to an
 * authenticator app — QR or the key typed in — and confirms it with the app's first code on the same code screen.
 *
 * The secret stays in memory only (not in the router's history state, the URL or any storage): a reload loses it,
 * and the next sign-in starts a new enrolment (the API removes the unfinished factor).
 */
import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import type { TotpEnrollment } from '@mig/contracts/dto';
import { t } from '@/i18n';
import { logger } from '@/shared/lib/logger';
import { Skeleton } from '@/shared/ui/states';

let pending: { challengeId: string; enrollment: TotpEnrollment } | null = null;

/** Keeps the enrolment of a password step until its code screen takes it. */
export function holdEnrollment(challengeId: string, enrollment: TotpEnrollment | undefined): void {
  pending = enrollment ? { challengeId, enrollment } : null;
}

/** The enrolment of this challenge, if its password step started one. */
export function enrollmentFor(challengeId: string): TotpEnrollment | null {
  return pending && pending.challengeId === challengeId ? pending.enrollment : null;
}

export function forgetEnrollment(): void {
  pending = null;
}

/** The key grouped by four characters, as authenticator apps show it. */
export function groupedSecret(secret: string): string {
  return secret.replace(/\s+/g, '').replace(/(.{4})(?=.)/g, '$1 ');
}

export function TotpEnrollmentStep({ enrollment }: { enrollment: TotpEnrollment }) {
  const [qr, setQr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    QRCode.toDataURL(enrollment.uri, { width: 360, margin: 1, errorCorrectionLevel: 'M' })
      .then((url) => {
        if (alive) setQr(url);
      })
      .catch(() => logger.warn('totp qr render failed'));
    return () => {
      alive = false;
    };
  }, [enrollment.uri]);

  return (
    <section className="mb-5 flex flex-col gap-3" data-testid="totp-enrollment" aria-label={t('auth.totp.title')}>
      <p className="text-[13px]">{t('auth.totp.step1')}</p>
      <div className="flex justify-center">
        {qr ? (
          <img src={qr} alt={t('auth.totp.qrAlt')} width={180} height={180} className="h-[180px] w-[180px] rounded-btn border border-border" data-testid="totp-qr" />
        ) : (
          <Skeleton className="h-[180px] w-[180px] rounded-btn" />
        )}
      </div>
      <details className="text-[13px]">
        <summary className="cursor-pointer text-accent-text">{t('auth.totp.manual')}</summary>
        <p className="mt-2 break-all rounded-btn bg-rail px-3 py-2 num text-[13px] tracking-wide" data-testid="totp-secret">
          {groupedSecret(enrollment.secret)}
        </p>
      </details>
      <p className="text-[13px]">{t('auth.totp.step2')}</p>
    </section>
  );
}
