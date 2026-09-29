import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useI18n } from '@/i18n';
import { useConsent } from '@/shared/api/queries/me';
import { errorMessage } from '@/shared/api/client';
import { updateUser } from '@/shared/auth/session';
import { targetAfterLogin } from '@/shared/lib/redirect';
import { useDocumentTitle } from '@/shared/lib/hooks';
import { Button } from '@/shared/ui/button';
import { Checkbox } from '@/shared/ui/checkbox';
import { toast } from '@/shared/ui/toast';
import { AuthNotice, AuthShell } from '../AuthShell';
import { BIG } from '../components';

const CONSENT_VERSION = '1.0';

export default function ConsentPage() {
  const { t } = useI18n();
  useDocumentTitle(t('consent.title'));
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const consent = useConsent();
  const [agreed, setAgreed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    try {
      const res = await consent.mutateAsync(CONSENT_VERSION);
      updateUser({ consentGivenAt: res.consentGivenAt });
      toast.success(t('consent.saved'));
      const target = targetAfterLogin(params.get('next'), '/app');
      navigate(target.startsWith('/app/consent') ? '/app' : target, { replace: true });
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <AuthShell title={t('consent.title')}>
      {error && <AuthNotice tone="danger">{error}</AuthNotice>}
      <div className="flex flex-col gap-3 rounded-card border border-border bg-surface p-5 text-[15px] leading-relaxed">
        <p>{t('consent.text1')}</p>
        <p>{t('consent.text2')}</p>
        <p className="text-[13px] text-muted">{t('consent.text3')}</p>
      </div>
      <label htmlFor="consent-check" className="mt-5 flex min-h-[44px] cursor-pointer items-center gap-3 text-[15px] font-semibold">
        <Checkbox id="consent-check" checked={agreed} onCheckedChange={setAgreed} className="h-6 w-6" />
        {t('consent.checkbox')}
      </label>
      <div className="mt-auto pt-6">
        <Button disabled={!agreed} loading={consent.isPending} onClick={() => void submit()} className={BIG}>
          {t('consent.continue')}
        </Button>
      </div>
    </AuthShell>
  );
}
