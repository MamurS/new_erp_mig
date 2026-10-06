/* Profile settings of a family (FAMILY_SPEC): an adult member's consent for the employee, the payout card. */
import { useState } from 'react';
import { CreditCard, Eye } from 'lucide-react';
import { useI18n } from '@/i18n';
import type { MeProfile } from '@/shared/types/dto';
import { errorMessage } from '@/shared/api/client';
import { useFamilyConsent, useSetPayoutCard } from '@/shared/api/queries/me';
import { payoutCardSchema } from '@/shared/schemas/forms';
import { cn } from '@/shared/lib/cn';
import { Button } from '@/shared/ui/button';
import { ConfirmDialog } from '@/shared/ui/confirm-dialog';
import { Modal } from '@/shared/ui/dialog';
import { Field } from '@/shared/ui/input';
import { MaskedInput } from '@/shared/ui/masked-input';
import { toast } from '@/shared/ui/toast';
import { BIG } from './components';

/** «Разрешить {name} видеть мои обращения»: an adult family member grants or revokes (both confirmed, both audited). */
export function FamilyConsentSwitch({ granted, principalName }: { granted: boolean; principalName: string }) {
  const { t } = useI18n();
  const consent = useFamilyConsent();
  const [asking, setAsking] = useState(false);
  const label = t('app.family.consentToggle', { name: principalName });
  const apply = async () => {
    try {
      await consent.mutateAsync(!granted);
      toast.success(t(granted ? 'app.family.consentRevoked' : 'app.family.consentGranted', { name: principalName }));
      setAsking(false);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  return (
    <section className="mt-4 rounded-card border border-border bg-surface p-4" data-testid="family-consent">
      <div className="flex items-center gap-3">
        <Eye className="h-5 w-5 shrink-0 text-accent" aria-hidden />
        <span id="family-consent-label" className="flex-1 font-bold">
          {label}
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={granted}
          aria-labelledby="family-consent-label"
          onClick={() => setAsking(true)}
          className={cn('relative h-8 w-14 shrink-0 rounded-full transition-colors', granted ? 'bg-accent' : 'bg-rail')}
        >
          <span aria-hidden className={cn('absolute top-1 h-6 w-6 rounded-full bg-white shadow transition-all', granted ? 'left-7' : 'left-1')} />
        </button>
      </div>
      <p className="mt-2 text-[13px] text-muted">{t(granted ? 'app.family.consentOnHint' : 'app.family.consentOffHint', { name: principalName })}</p>
      <ConfirmDialog
        open={asking}
        onOpenChange={setAsking}
        title={t(granted ? 'app.family.revokeTitle' : 'app.family.grantTitle', { name: principalName })}
        description={t(granted ? 'app.family.revokeText' : 'app.family.grantText', { name: principalName })}
        confirmLabel={t(granted ? 'app.family.revoke' : 'app.family.grant')}
        cancelLabel={t('app.common.cancel')}
        loading={consent.isPending}
        onConfirm={() => void apply()}
      />
    </section>
  );
}

/**
 * Payout card: the full number lives only in this form's state while typing; the server answers with the
 * masked one. A family member may go back to the employee's card.
 */
export function PayoutCardActions({ profile }: { profile: MeProfile }) {
  const { t } = useI18n();
  const setCard = useSetPayoutCard();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | undefined>();
  const member = profile.relation !== 'employee';
  const principal = profile.principalFirstName ?? '';

  const close = () => {
    setOpen(false);
    setValue('');
    setError(undefined);
  };
  const save = async (card: string | null) => {
    const parsed = payoutCardSchema.safeParse({ card });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message);
      return;
    }
    try {
      await setCard.mutateAsync(parsed.data.card);
      toast.success(t(card === null ? 'app.payout.reset' : 'app.payout.saved'));
      close();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setCard.reset();
    }
  };

  return (
    <section className="mt-4 rounded-card border border-border bg-surface p-4" data-testid="payout-card">
      <p className="flex items-center gap-2 font-bold">
        <CreditCard className="h-5 w-5 text-accent" aria-hidden />
        {t('app.payout.title')}
      </p>
      <p className="mt-1 text-[14px] text-muted">
        {member && !profile.payoutCardOwn ? t('app.payout.principal', { name: principal }) : t('app.payout.own')}{' '}
        <span className="num font-semibold text-text">{profile.payoutCardMasked}</span>
      </p>
      <div className="mt-3 flex flex-col gap-2">
        <Button variant="secondary" onClick={() => setOpen(true)} className="h-11 w-full rounded-btn text-[15px]">
          {t(member && !profile.payoutCardOwn ? 'app.payout.setOwn' : 'app.payout.change')}
        </Button>
        {member && profile.payoutCardOwn && (
          <Button variant="ghost" loading={setCard.isPending} onClick={() => void save(null)} className="h-11 w-full rounded-btn text-[15px]">
            {t('app.payout.backToPrincipal', { name: principal })}
          </Button>
        )}
      </div>
      <Modal open={open} onOpenChange={(o) => (o ? setOpen(true) : close())} title={t('app.payout.title')}>
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            void save(value);
          }}
          className="flex flex-col gap-4"
        >
          <Field label={t('app.payout.number')} error={error}>
            {(a) => <MaskedInput {...a} mask="card" value={value} onChange={setValue} className="h-12 text-[15px]" />}
          </Field>
          <p className="text-[13px] text-muted">{t('app.payout.hint')}</p>
          <Button type="submit" loading={setCard.isPending} className={BIG}>
            {t('app.payout.save')}
          </Button>
        </form>
      </Modal>
    </section>
  );
}
