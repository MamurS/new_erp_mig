/*
 * «Приглашение отправлено / истекло» of an account that has not set its password yet, with «Отправить повторно» for
 * whoever manages it (the server checks who may: the MIG administrator, the clinic's or the assistance's own one).
 */
import { t } from '@/i18n';
import type { InvitationBrief } from '@mig/contracts';
import { formatDate } from '@mig/domain/lib/format';
import { errorMessage } from '@/shared/api/client';
import { useResendInvitation } from '@/shared/api/queries/invitations';
import { Button } from '@/shared/ui/button';
import { StatusDot } from '@/shared/ui/chips';
import { toast } from '@/shared/ui/toast';

export function InvitationStatus({ invitation }: { invitation: InvitationBrief }) {
  const expired = invitation.status === 'expired';
  const label = expired ? t('auth.invite.status.expired') : invitation.sentAt ? t('auth.invite.status.pending') : t('auth.invite.status.queued');
  return (
    <span className="flex flex-col">
      <StatusDot tone={expired ? 'danger' : 'warning'}>{label}</StatusDot>
      {!expired && <span className="text-[12px] text-muted">{t('auth.invite.until', { date: formatDate(invitation.expiresAt) })}</span>}
    </span>
  );
}

export function ResendInvitation({ userId, name }: { userId: string; name: string }) {
  const resend = useResendInvitation();
  return (
    <Button
      size="sm"
      variant="secondary"
      loading={resend.isPending}
      aria-label={t('auth.invite.resendAria', { name })}
      onClick={() =>
        resend.mutate(userId, {
          onSuccess: () => toast.success(t('auth.invite.resent')),
          onError: (e) => toast.error(errorMessage(e)),
        })
      }
    >
      {t('auth.invite.resend')}
    </Button>
  );
}
