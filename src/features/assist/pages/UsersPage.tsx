/* Users of the assistance company (asst_admin): invite, change role, deactivate (not oneself). */
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { z } from 'zod';
import type { AssistanceRole } from '@/shared/types';
import type { AssistUserView } from '@/shared/types/dto';
import { assistUserInviteSchema } from '@/shared/schemas/forms';
import { useAssistUsers, useInviteAssistUser, usePatchAssistUser } from '@/shared/api/queries/assist';
import { errorMessage } from '@/shared/api/client';
import { useUser } from '@/shared/auth/session';
import { ASSISTANCE_ROLES, ROLE_LABEL } from '@/shared/domain/labels';
import { formatDateTime } from '@/shared/lib/format';
import { useDocumentTitle } from '@/shared/lib/hooks';
import { useCreateIntent } from '@/shared/lib/createIntent';
import { Button } from '@/shared/ui/button';
import { Chip } from '@/shared/ui/chips';
import { DataTable, type Column } from '@/shared/ui/data-table';
import { Modal } from '@/shared/ui/dialog';
import { Field, Input, Select } from '@/shared/ui/input';
import { EmptyState } from '@/shared/ui/states';
import { PageHeader } from '@/shared/ui/page';
import { toast } from '@/shared/ui/toast';
import { useTopbar } from '@/features/staff/topbar';
import { roleName } from '@/features/next/NextActions';
import { EmptyHelp } from '@/features/clinic/emptyNext';
import { t, tm } from '@/i18n';

type Invite = z.input<typeof assistUserInviteSchema>;

function InviteDialog({ onClose }: { onClose: () => void }) {
  const invite = useInviteAssistUser();
  const form = useForm<Invite>({ resolver: zodResolver(assistUserInviteSchema), defaultValues: { email: '', fullName: '', role: 'asst_operator' } });
  const e = form.formState.errors;
  const submit = form.handleSubmit(async (v) => {
    try {
      await invite.mutateAsync(v);
      toast.success(t('assist.users.invited'));
      onClose();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  });
  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('assist.users.inviteTitle')}
      description={t('assist.users.inviteDescription')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button loading={invite.isPending} onClick={() => void submit()}>
            {t('assist.users.invite')}
          </Button>
        </>
      }
    >
      <form className="flex flex-col gap-3" onSubmit={(ev) => void submit(ev)} noValidate>
        <Field label={t('common.fullName')} error={tm(e.fullName?.message)}>
          {(a) => <Input {...a} maxLength={120} {...form.register('fullName')} />}
        </Field>
        <Field label={t('common.email')} error={tm(e.email?.message)}>
          {(a) => <Input {...a} type="email" maxLength={254} {...form.register('email')} />}
        </Field>
        <Field label={t('common.role')} error={tm(e.role?.message)}>
          {(a) => (
            <Select {...a} {...form.register('role')}>
              {ASSISTANCE_ROLES.map((r) => (
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

export default function UsersPage() {
  useDocumentTitle(t('assist.users.title'));
  useTopbar([{ label: t('assist.users.title') }]);
  const me = useUser();
  const q = useAssistUsers();
  const patch = usePatchAssistUser();
  const [inviting, setInviting] = useState(false);
  useCreateIntent('user', true, setInviting, true);
  const change = async (u: AssistUserView, body: { role?: AssistanceRole; active?: boolean }) => {
    try {
      await patch.mutateAsync({ id: u.id, ...body });
      toast.success(t('assist.users.saved'));
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  const columns: Column<AssistUserView>[] = [
    { key: 'name', header: t('common.fullName'), cell: (u) => <span className="font-medium">{u.fullName}</span> },
    { key: 'email', header: t('common.email'), cell: (u) => u.email },
    {
      key: 'role',
      header: t('common.role'),
      cell: (u) =>
        u.id === me?.id ? (
          ROLE_LABEL[u.role]
        ) : (
          <Select aria-label={t('assist.users.roleAria', { name: u.fullName })} value={u.role} onChange={(e) => void change(u, { role: e.target.value as AssistanceRole })}>
            {ASSISTANCE_ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </Select>
        ),
    },
    { key: 'login', header: t('assist.users.lastLogin'), cell: (u) => (u.lastLoginAt ? <span className="num">{formatDateTime(u.lastLoginAt)}</span> : '—') },
    { key: 'status', header: t('common.status'), cell: (u) => <Chip kind={u.active ? 'success' : 'neutral'}>{u.active ? t('assist.users.active') : t('assist.users.disabled')}</Chip> },
    {
      key: 'actions',
      header: '',
      align: 'right',
      cell: (u) =>
        u.id === me?.id ? null : (
          <Button size="sm" variant="ghost" onClick={() => void change(u, { active: !u.active })}>
            {u.active ? t('assist.users.disable') : t('assist.users.enable')}
          </Button>
        ),
    },
  ];
  return (
    <>
      <PageHeader title={t('assist.users.pageTitle')} actions={<Button onClick={() => setInviting(true)}>{t('assist.users.invite')}</Button>} />
      <div className="rounded-card border border-border bg-surface">
        <DataTable caption={t('assist.users.title')} columns={columns} rows={q.data} loading={q.isLoading} error={q.error} onRetry={() => void q.refetch()} rowKey={(u) => u.id}
          empty={
            <EmptyState
              testId="users-empty"
              title={t('emptyPartner.users.title')}
              why={t('emptyPartner.users.why')}
              next={t('emptyPartner.users.next', { role: roleName('asst_admin') })}
              actions={<Button onClick={() => setInviting(true)}>{t('emptyPartner.users.invite')}</Button>}
              help={<EmptyHelp article="portal-guides" section="guide-assistance" />}
            />
          }
        />
      </div>
      {inviting && <InviteDialog onClose={() => setInviting(false)} />}
    </>
  );
}
