import { t, tm } from '@/i18n';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { z } from 'zod';
import type { StaffRole, StaffUser } from '@mig/contracts';
import { useAdminUsers, useInviteStaffUser, usePatchUser } from '@/shared/api/queries/staff';
import { staffUserInviteSchema } from '@mig/contracts/forms';
import { errorMessage } from '@/shared/api/client';
import { useUser } from '@/shared/auth/session';
import { ROLE_LABEL, STAFF_ROLES } from '@mig/domain/labels';
import { formatDateTime } from '@mig/domain/lib/format';
import { useDocumentTitle } from '@/shared/lib/hooks';
import { useCreateIntent } from '@/shared/lib/createIntent';
import { Button } from '@/shared/ui/button';
import { Avatar, StatusDot } from '@/shared/ui/chips';
import { ConfirmDialog } from '@/shared/ui/confirm-dialog';
import { DataTable, type Column } from '@/shared/ui/data-table';
import { Field, Input, Select } from '@/shared/ui/input';
import { Modal } from '@/shared/ui/dialog';
import { toast } from '@/shared/ui/toast';
import { Tooltip } from '@/shared/ui/tooltip';
import { useTopbar } from '../topbar';
import { AuthorityChangesCard, AuthorityDialog, authoritySummary } from '../admin/Authority';
import { InvitationsCard } from '../admin/InvitationsCard';
import { InvitationStatus, ResendInvitation } from '@/features/auth/InvitationStatus';

type Pending = { kind: 'role'; user: StaffUser; role: StaffRole } | { kind: 'active'; user: StaffUser; active: boolean };
type Invite = z.input<typeof staffUserInviteSchema>;

function InviteDialog({ onClose }: { onClose: () => void }) {
  const invite = useInviteStaffUser();
  const form = useForm<Invite>({ resolver: zodResolver(staffUserInviteSchema), defaultValues: { email: '', fullName: '', role: 'operator' } });
  const e = form.formState.errors;
  const submit = form.handleSubmit(async (v) => {
    try {
      await invite.mutateAsync(v);
      toast.success(t('create.staffUser.invited'));
      onClose();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  });
  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('create.staffUser.title')}
      description={t('create.staffUser.description')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button loading={invite.isPending} onClick={() => void submit()}>
            {t('create.staffUser.invite')}
          </Button>
        </>
      }
    >
      <form className="flex flex-col gap-3" onSubmit={(ev) => void submit(ev)} noValidate>
        <Field label={t('common.fullName')} error={tm(e.fullName?.message)}>
          {(a) => <Input {...a} autoComplete="off" maxLength={120} {...form.register('fullName')} />}
        </Field>
        <Field label={t('create.staffUser.email')} error={tm(e.email?.message)}>
          {(a) => <Input {...a} type="email" autoComplete="off" maxLength={254} {...form.register('email')} />}
        </Field>
        <Field label={t('common.role')} error={tm(e.role?.message)}>
          {(a) => (
            <Select {...a} {...form.register('role')}>
              {STAFF_ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABEL[r]}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </form>
    </Modal>
  );
}

/** Roles with personal authority or the right to sign for MIG. */
const AUTHORITY_ROLES: StaffRole[] = ['underwriter', 'claims_officer', 'sales_manager'];

export default function UsersPage() {
  useDocumentTitle(t('staff.users.title'));
  useTopbar([{ label: t('staff.users.title') }]);
  const me = useUser()!;
  const list = useAdminUsers();
  const patch = usePatchUser();
  const [pending, setPending] = useState<Pending | null>(null);
  const [authorityOf, setAuthorityOf] = useState<StaffUser | null>(null);
  const [inviting, setInviting] = useState(false);
  useCreateIntent('user', true, setInviting, true);

  const cols: Column<StaffUser>[] = [
    {
      key: 'name',
      header: t('common.employee'),
      cell: (u) => (
        <span className="flex items-center gap-2">
          <Avatar name={u.fullName} />
          <span>
            <span className="block font-medium">
              {u.fullName} {u.id === me.id && <span className="text-muted">{t('staff.users.you')}</span>}
            </span>
            <span className="block text-[12px] text-muted">{u.email}</span>
          </span>
        </span>
      ),
    },
    {
      key: 'role',
      header: t('common.role'),
      cell: (u) => {
        const self = u.id === me.id;
        const select = (
          <Select
            aria-label={t('staff.users.roleAria', { name: u.fullName })}
            className="h-7 w-48"
            value={u.role}
            disabled={self || !u.active}
            onChange={(e) => setPending({ kind: 'role', user: u, role: e.target.value as StaffRole })}
          >
            {STAFF_ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </Select>
        );
        return self ? (
          <Tooltip content={t('staff.users.cannotSelf')}>
            <span tabIndex={0}>{select}</span>
          </Tooltip>
        ) : (
          select
        );
      },
    },
    {
      key: 'authority',
      header: t('staff.users.authority'),
      cell: (u) =>
        AUTHORITY_ROLES.includes(u.role) ? (
          <span className="flex items-center gap-2">
            <span className="text-[12px] text-muted">{authoritySummary(u.authority, u.signatory)}</span>
            {u.id !== me.id && u.active && (
              <Button size="sm" variant="ghost" onClick={() => setAuthorityOf(u)} aria-label={t('staff.users.authorityAria', { name: u.fullName })}>
                {t('common.edit')}
              </Button>
            )}
          </span>
        ) : null,
    },
    {
      key: 'status',
      header: t('common.status'),
      cell: (u) =>
        u.active && u.invitation ? (
          <InvitationStatus invitation={u.invitation} />
        ) : (
          <StatusDot tone={u.active ? 'success' : 'muted'}>{u.active ? t('staff.clientCard.insuredActive') : t('staff.users.deactivated')}</StatusDot>
        ),
    },
    { key: 'last', header: t('staff.users.lastLogin'), cell: (u) => <span className="text-muted">{u.lastLoginAt ? formatDateTime(u.lastLoginAt) : '—'}</span> },
    {
      key: 'actions',
      header: '',
      align: 'right',
      cell: (u) =>
        u.id === me.id ? null : u.active ? (
          <span className="flex justify-end gap-2">
            {u.invitation && <ResendInvitation userId={u.id} name={u.fullName} />}
            <Button size="sm" variant="secondary" className="text-danger-text" onClick={() => setPending({ kind: 'active', user: u, active: false })}>
              {t('staff.users.deactivate')}
            </Button>
          </span>
        ) : (
          <Button size="sm" variant="secondary" onClick={() => setPending({ kind: 'active', user: u, active: true })}>
            {t('staff.users.activate')}
          </Button>
        ),
    },
  ];

  const confirmText =
    pending?.kind === 'role'
      ? {
          title: t('staff.users.roleTitle'),
          description: t('staff.users.roleText', { name: pending.user.fullName, from: ROLE_LABEL[pending.user.role], to: ROLE_LABEL[pending.role] }),
          label: t('staff.users.roleConfirm'),
          toast: t('staff.users.roleChanged'),
        }
      : pending?.active === false
        ? {
            title: t('staff.users.deactivateTitle'),
            description: t('staff.users.deactivateText', { name: pending.user.fullName }),
            label: t('staff.users.deactivate'),
            toast: t('staff.users.deactivatedToast'),
          }
        : {
            title: t('staff.users.activateTitle'),
            description: t('staff.users.activateText'),
            label: t('staff.users.activate'),
            toast: t('staff.users.activatedToast'),
          };

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="text-[22px] font-bold">{t('staff.users.title')}</h1>
          <p className="text-muted">{t('staff.users.intro')}</p>
        </div>
        <Button onClick={() => setInviting(true)}>{t('create.staffUser.add')}</Button>
      </div>
      <AuthorityChangesCard />
      <div className="rounded-card border border-border bg-surface">
        <DataTable caption={t('staff.users.caption')} columns={cols} rows={list.data} rowKey={(u) => u.id} loading={list.isLoading} error={list.error} onRetry={() => void list.refetch()} rowHeight={52} />
      </div>
      <InvitationsCard />
      {inviting && <InviteDialog onClose={() => setInviting(false)} />}
      {authorityOf && <AuthorityDialog user={authorityOf} onClose={() => setAuthorityOf(null)} />}
      <ConfirmDialog
        open={!!pending}
        onOpenChange={(o) => !o && setPending(null)}
        title={confirmText.title}
        description={confirmText.description}
        confirmLabel={confirmText.label}
        danger={pending?.kind === 'role' || pending?.active === false}
        loading={patch.isPending}
        onConfirm={async () => {
          if (!pending) return;
          try {
            await patch.mutateAsync(pending.kind === 'role' ? { id: pending.user.id, role: pending.role } : { id: pending.user.id, active: pending.active });
            toast.success(confirmText.toast);
            setPending(null);
          } catch (e) {
            toast.error(errorMessage(e));
          }
        }}
      />
    </div>
  );
}
