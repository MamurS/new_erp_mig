import { t } from '@/i18n';
import { useEffect, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useOtp, useResend } from '@/shared/api/queries/auth';
import { errorMessage } from '@/shared/api/client';
import { setSession } from '@/shared/auth/session';
import { homeFor } from '@mig/domain/auth/home';
import { targetAfterLogin } from '@/shared/lib/redirect';
import { useCountdown, useDocumentTitle } from '@/shared/lib/hooks';
import { getDemo } from '@/shared/demo';
import { Button } from '@/shared/ui/button';
import { OtpInput } from '@/shared/ui/otp-input';
import { toast } from '@/shared/ui/toast';
import { AuthCard, Notice } from './AuthCard';

interface OtpState {
  challengeId: string;
  resendInSec: number;
  next?: string | null;
}

export default function OtpPage() {
  useDocumentTitle(t('auth.otp.docTitle'));
  const loc = useLocation();
  const navigate = useNavigate();
  const state = loc.state as OtpState | null;
  const [challengeId, setChallengeId] = useState(state?.challengeId ?? '');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [resendAt, setResendAt] = useState(() => Date.now() + (state?.resendInSec ?? 60) * 1000);
  const left = useCountdown(resendAt);
  const otp = useOtp();
  const resend = useResend();
  const demo = getDemo();

  useEffect(() => {
    if (state?.challengeId) setChallengeId(state.challengeId);
  }, [state?.challengeId]);

  if (!state?.challengeId) return <Navigate to="/login" replace />;

  const submit = async (value: string) => {
    if (!/^\d{6}$/.test(value) || otp.isPending) return;
    setError(null);
    try {
      const res = await otp.mutateAsync({ challengeId, code: value });
      setSession(res);
      navigate(targetAfterLogin(state.next, homeFor(res.user.role)), { replace: true });
    } catch (e) {
      setError(errorMessage(e));
      setCode('');
    }
  };

  return (
    <AuthCard
      title={t('auth.otp.title')}
      subtitle={t('auth.otp.subtitle')}
      footer={
        <p className="mt-3 text-center text-[12px] text-muted">
          {t('auth.otp.footer')}
        </p>
      }
    >
      {error && <Notice tone="danger">{error}</Notice>}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit(code);
        }}
        className="flex flex-col items-start gap-4"
      >
        <OtpInput value={code} onChange={setCode} onComplete={(v) => void submit(v)} invalid={!!error} autoFocus />
        <Button type="submit" size="lg" className="h-10 w-full text-[14px]" loading={otp.isPending} disabled={code.length !== 6}>
          {t('common.confirm')}
        </Button>
        <div className="flex w-full items-center justify-between text-[13px]">
          <Button variant="link" onClick={() => navigate('/login')}>
            {t('common.back')}
          </Button>
          {left > 0 ? (
            <span className="text-muted">{t('auth.otp.resendIn', { n: left })}</span>
          ) : (
            <Button
              variant="link"
              loading={resend.isPending}
              onClick={async () => {
                try {
                  const r = await resend.mutateAsync({ challengeId });
                  setChallengeId(r.challengeId);
                  setResendAt(Date.now() + r.resendInSec * 1000);
                  toast.success(t('auth.otp.resent'));
                } catch (e) {
                  setError(errorMessage(e));
                }
              }}
            >
              {t('auth.otp.resend')}
            </Button>
          )}
        </div>
      </form>
      {demo && <demo.CodeHint />}
    </AuthCard>
  );
}
