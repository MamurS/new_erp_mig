import { useEffect, useRef, useState } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { useI18n } from '@/i18n';
import { usePhoneLogin } from '@/shared/api/queries/auth';
import { errorMessage } from '@/shared/api/client';
import { takeLogoutNotice, useSession } from '@/shared/auth/session';
import { targetAfterLogin } from '@/shared/lib/redirect';
import { useDocumentTitle } from '@/shared/lib/hooks';
import { phoneLoginSchema } from '@/shared/schemas/forms';
import { getDemo } from '@/shared/demo';
import { Button } from '@/shared/ui/button';
import { Field } from '@/shared/ui/input';
import { MaskedInput } from '@/shared/ui/masked-input';
import { AuthNotice, AuthShell } from '../AuthShell';
import { BIG } from '../components';

export interface CodeState {
  challengeId: string;
  resendInSec: number;
  phone: string;
  next: string | null;
}

export default function PhoneLoginPage() {
  const { t } = useI18n();
  useDocumentTitle(t('login.title'));
  const session = useSession();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const login = usePhoneLogin();
  const [notice] = useState(() => takeLogoutNotice());
  const [phone, setPhone] = useState('+998 ');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const demo = getDemo();
  const next = params.get('next');

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  if (session?.user.role === 'insured') return <Navigate to={targetAfterLogin(next, '/app')} replace />;

  const submit = async () => {
    setServerError(null);
    const parsed = phoneLoginSchema.safeParse({ phone });
    if (!parsed.success) {
      setFieldError(t('login.phoneError'));
      inputRef.current?.focus();
      return;
    }
    setFieldError(null);
    try {
      const res = await login.mutateAsync(parsed.data);
      const state: CodeState = { challengeId: res.challengeId, resendInSec: res.resendInSec, phone: parsed.data.phone, next };
      navigate('/app/login/code', { state });
    } catch (e) {
      setServerError(errorMessage(e));
    }
  };

  return (
    <AuthShell title={t('login.title')} subtitle={t('login.subtitle')}>
      {notice && <AuthNotice>{notice}</AuthNotice>}
      {serverError && <AuthNotice tone="danger">{serverError}</AuthNotice>}
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        className="flex flex-col gap-5"
      >
        <Field label={t('login.phone')} error={fieldError ?? undefined}>
          {(a) => (
            <MaskedInput
              {...a}
              ref={inputRef}
              mask="phone"
              type="tel"
              value={phone}
              onChange={setPhone}
              onBlur={() => {
                if (phone.replace(/\D/g, '').length > 3 && !phoneLoginSchema.safeParse({ phone }).success) setFieldError(t('login.phoneError'));
              }}
              className="h-14 text-[20px] font-semibold tracking-wide"
            />
          )}
        </Field>
        <Button type="submit" loading={login.isPending} className={`${BIG} h-14 text-[16px]`}>
          {t('login.getCode')}
        </Button>
      </form>
      {demo && (
        <demo.PhoneLoginHint
          onPick={(p) => {
            setPhone(p);
            setFieldError(null);
          }}
        />
      )}
    </AuthShell>
  );
}
