/*
 * «Приглашения» of /staff/admin/users: accounts of the other portals (HR of clients, clinics, assistance companies)
 * that have not set a password yet — MIG's own employees show their status in the table above.
 */
import { t } from '@/i18n';
import type { InvitationView } from '@mig/contracts';
import { useInvitations } from '@/shared/api/queries/invitations';
import { DataTable, type Column } from '@/shared/ui/data-table';
import { InvitationStatus, ResendInvitation } from '@/features/auth/InvitationStatus';

export function InvitationsCard() {
  const list = useInvitations();
  const rows = (list.data ?? []).filter((x) => x.portal !== 'staff');
  const cols: Column<InvitationView>[] = [
    {
      key: 'name',
      header: t('common.fullName'),
      cell: (x) => (
        <span>
          <span className="block font-medium">{x.fullName}</span>
          <span className="block text-[12px] text-muted">{x.email}</span>
        </span>
      ),
    },
    {
      key: 'portal',
      header: t('auth.invite.list.portal'),
      cell: (x) => (
        <span>
          <span className="block">{t(`auth.invite.portal.${x.portal}`)}</span>
          {x.organization && <span className="block text-[12px] text-muted">{x.organization}</span>}
        </span>
      ),
    },
    { key: 'status', header: t('common.status'), cell: (x) => <InvitationStatus invitation={x} /> },
    { key: 'actions', header: '', align: 'right', cell: (x) => <ResendInvitation userId={x.userId} name={x.fullName} /> },
  ];
  return (
    <section className="mt-6" aria-labelledby="invitations-title">
      <h2 id="invitations-title" className="text-[16px] font-semibold">
        {t('auth.invite.list.title')}
      </h2>
      <p className="mb-2 text-muted">{t('auth.invite.list.description')}</p>
      <div className="rounded-card border border-border bg-surface">
        <DataTable
          caption={t('auth.invite.list.title')}
          columns={cols}
          rows={rows}
          rowKey={(x) => x.userId}
          loading={list.isLoading}
          error={list.error}
          onRetry={() => void list.refetch()}
          empty={t('auth.invite.list.empty')}
          rowHeight={52}
        />
      </div>
    </section>
  );
}
