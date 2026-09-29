import { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useI18n } from '@/i18n';
import { usePhoneLogin, usePhoneVerify } from '@/shared/api/queries/auth';
import { errorMessage } from '@/shared/api/client';
import { setSession } from '@/shared/auth/session';
import { targetAfterLogin } from '@/shared/lib/redirect';
import { formatPhone } from '@/shared/lib/masks';
import { useCountdown, useDocumentTitle } from '@/shared/lib/hooks';
import { getDemo } from '@/shared/demo';
import { Button } from '@/shared/ui/button';
import { OtpInput } from '@/shared/ui/otp-input';
import { toast } from '@/shared/ui/toast';
import { AuthNotice, AuthShell } from '../AuthShell';
import { BIG } from '../components';
import type { CodeState } from './PhoneLoginPage';

export default function CodePage() {
  const { t } = useI18n();
  useDocumentTitle(t('login.code.title'));
  const loc = useLocation();
  const navigate = useNavigate();
  const state = loc.state as CodeState | null;
  const [challengeId, setChallengeId] = useState(state?.challengeId ?? '');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [resendAt, setResendAt] = useState(() => Date.now() + (state?.resendInSec ?? 60) * 1000);
  const left = useCountdown(resendAt);
  const verify = usePhoneVerify();
  const resend = usePhoneLogin();
  const demo = getDemo();

  if (!state?.challengeId) return <Navigate to="/app/login" replace />;

  const submit = async (value: string) => {
    if (!/^\d{6}$/.test(value) || verify.isPending) return;
    setError(null);
    try {
      const res = await verify.mutateAsync({ challengeId, code: value });
      setSession(res);
      const target = targetAfterLogin(state.next, '/app');
      if (!res.user.consentGivenAt) navigate(`/app/consent?next=${encodeURIComponent(target)}`, { replace: true });
      else navigate(target, { replace: true });
    } catch (e) {
      setError(errorMessage(e) || t('login.code.invalid'));
      setCode('');
    }
  };

  const doResend = async () => {
    setError(null);
    try {
      const r = await resend.mutateAsync({ phone: state.phone });
      setChallengeId(r.challengeId);
      setResendAt(Date.now() + r.resendInSec * 1000);
      toast.success(t('login.code.resent'));
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <AuthShell title={t('login.code.title')} subtitle={t('login.code.sentTo', { phone: formatPhone(state.phone) })}>
      {error && <AuthNotice tone="danger">{error}</AuthNotice>}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit(code);
        }}
        className="flex flex-col gap-5"
      >
        <div className="flex justify-center">
          <OtpInput value={code} onChange={setCode} onComplete={(v) => void submit(v)} invalid={!!error} large autoFocus groupLabel={t('login.code.group')} digitLabel={(n) => t('login.code.digit', { n })} />
        </div>
        <Button type="submit" loading={verify.isPending} disabled={code.length !== 6} className={BIG}>
          {t('login.code.submit')}
        </Button>
        <div className="flex flex-col items-center gap-1 text-[14px]">
          {left > 0 ? (
            <p className="flex min-h-[44px] items-center text-muted" aria-live="polite">
              {t('login.code.resendIn', { sec: left })}
            </p>
          ) : (
            <Button variant="link" loading={resend.isPending} onClick={() => void doResend()} className="min-h-[44px] text-[15px] font-semibold">
              {t('login.code.resend')}
            </Button>
          )}
          <Button variant="link" onClick={() => navigate('/app/login', { replace: true })} className="min-h-[44px] text-[15px] font-semibold">
            {t('login.code.changePhone')}
          </Button>
        </div>
      </form>
      {demo && <demo.CodeHint />}
    </AuthShell>
  );
}
