import { useEffect, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useOtp, useResend } from '@/shared/api/queries/auth';
import { errorMessage } from '@/shared/api/client';
import { setSession } from '@/shared/auth/session';
import { homeFor } from '@/shared/auth/home';
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
  useDocumentTitle('Код подтверждения');
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
      title="Второй фактор"
      subtitle="Введите 6-значный код из приложения-аутентификатора или SMS"
      footer={
        <p className="mt-3 text-center text-[12px] text-muted">
          Вход защищён MFA. Все входы записываются в журнал аудита.
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
          Подтвердить
        </Button>
        <div className="flex w-full items-center justify-between text-[13px]">
          <Button variant="link" onClick={() => navigate('/login')}>
            Назад
          </Button>
          {left > 0 ? (
            <span className="text-muted">Отправить код повторно через {left} с</span>
          ) : (
            <Button
              variant="link"
              loading={resend.isPending}
              onClick={async () => {
                try {
                  const r = await resend.mutateAsync({ challengeId });
                  setChallengeId(r.challengeId);
                  setResendAt(Date.now() + r.resendInSec * 1000);
                  toast.success('Код отправлен повторно');
                } catch (e) {
                  setError(errorMessage(e));
                }
              }}
            >
              Отправить код повторно
            </Button>
          )}
        </div>
      </form>
      {demo && <demo.CodeHint />}
    </AuthCard>
  );
}
