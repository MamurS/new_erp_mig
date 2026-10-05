/* Clinic users (CLINIC_SPEC §4.7, clinic_admin): invite, change role, deactivate (not oneself). */
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { z } from 'zod';
import type { ClinicUserView } from '@/shared/types/dto';
import { clinicUserInviteSchema } from '@/shared/schemas/forms';
import { useClinicUsers, useInviteClinicUser, usePatchClinicUser } from '@/shared/api/queries/clinic';
import { errorMessage } from '@/shared/api/client';
import { useUser } from '@/shared/auth/session';
import { ROLE_LABEL } from '@/shared/domain/labels';
import { formatDateTime } from '@/shared/lib/format';
import { useDocumentTitle } from '@/shared/lib/hooks';
import { Button } from '@/shared/ui/button';
import { Chip } from '@/shared/ui/chips';
import { ConfirmDialog } from '@/shared/ui/confirm-dialog';
import { DataTable, type Column } from '@/shared/ui/data-table';
import { Modal } from '@/shared/ui/dialog';
import { Field, Input, Select } from '@/shared/ui/input';
import { toast } from '@/shared/ui/toast';
import { PageTitle, Panel } from '../components';
import { t, tm } from '@/i18n';

type Invite = z.input<typeof clinicUserInviteSchema>;

function InviteDialog({ onClose }: { onClose: () => void }) {
  const invite = useInviteClinicUser();
  const form = useForm<Invite>({ resolver: zodResolver(clinicUserInviteSchema), defaultValues: { email: '', fullName: '', role: 'clinic_registrar' } });
  const e = form.formState.errors;
  const submit = form.handleSubmit(async (v) => {
    try {
      await invite.mutateAsync(v);
      toast.success(t('clinic.users.invited'));
      onClose();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  });
  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('clinic.users.inviteTitle')}
      description={t('clinic.users.inviteDescription')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button loading={invite.isPending} onClick={() => void submit()}>
            {t('clinic.users.invite')}
          </Button>
        </>
      }
    >
      <form className="flex flex-col gap-3" onSubmit={(ev) => void submit(ev)} noValidate>
        <Field label={t('common.fullName')} error={tm(e.fullName?.message)}>
          {(a) => <Input {...a} autoComplete="off" {...form.register('fullName')} />}
        </Field>
        <Field label={t('clinic.users.workEmail')} error={tm(e.email?.message)}>
          {(a) => <Input {...a} type="email" autoComplete="off" {...form.register('email')} />}
        </Field>
        <Field label={t('common.role')} error={tm(e.role?.message)}>
          {(a) => (
            <Select {...a} {...form.register('role')}>
              <option value="clinic_registrar">{ROLE_LABEL.clinic_registrar}</option>
              <option value="clinic_admin">{ROLE_LABEL.clinic_admin}</option>
            </Select>
          )}
        </Field>
      </form>
    </Modal>
  );
}

export default function UsersPage() {
  useDocumentTitle(t('clinic.users.caption'));
  const me = useUser();
  const q = useClinicUsers();
  const patch = usePatchClinicUser();
  const [inviting, setInviting] = useState(false);
  const [deactivate, setDeactivate] = useState<ClinicUserView | null>(null);

  const change = async (u: ClinicUserView, body: { role?: ClinicUserView['role']; active?: boolean }) => {
    try {
      await patch.mutateAsync({ id: u.id, ...body });
      toast.success(body.active === false ? t('clinic.users.deactivated') : body.active ? t('clinic.users.restored') : t('clinic.users.roleChanged'));
      setDeactivate(null);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const columns: Column<ClinicUserView>[] = [
    { key: 'name', header: t('clinic.users.user'), cell: (u) => <span className="font-medium">{u.fullName}</span> },
    { key: 'email', header: t('common.email'), cell: (u) => <span className="text-muted">{u.email}</span> },
    {
      key: 'role',
      header: t('common.role'),
      cell: (u) =>
        u.id === me?.id ? (
          ROLE_LABEL[u.role]
        ) : (
          <Select aria-label={t('clinic.users.roleAria', { name: u.fullName })} value={u.role} onChange={(e) => void change(u, { role: e.target.value as ClinicUserView['role'] })} className="h-9 w-56">
            <option value="clinic_registrar">{ROLE_LABEL.clinic_registrar}</option>
            <option value="clinic_admin">{ROLE_LABEL.clinic_admin}</option>
          </Select>
        ),
    },
    { key: 'login', header: t('clinic.users.lastLogin'), cell: (u) => <span className="num text-muted">{u.lastLoginAt ? formatDateTime(u.lastLoginAt) : '—'}</span> },
    { key: 'status', header: t('common.status'), cell: (u) => <Chip kind={u.active ? 'success' : 'neutral'}>{u.active ? t('clinic.users.active') : t('clinic.users.inactive')}</Chip> },
    {
      key: 'actions',
      header: '',
      align: 'right',
      cell: (u) =>
        u.id === me?.id ? (
          <span className="text-[12px] text-muted">{t('clinic.users.you')}</span>
        ) : u.active ? (
          <Button size="sm" variant="secondary" onClick={() => setDeactivate(u)}>
            {t('clinic.users.deactivate')}
          </Button>
        ) : (
          <Button size="sm" variant="secondary" onClick={() => void change(u, { active: true })}>
            {t('clinic.users.restore')}
          </Button>
        ),
    },
  ];
  return (
    <>
      <PageTitle title={t('clinic.nav.users')} actions={<Button onClick={() => setInviting(true)}>{t('clinic.users.inviteTitle')}</Button>} />
      <Panel>
        <DataTable caption={t('clinic.users.caption')} columns={columns} rows={q.data} rowKey={(u) => u.id} loading={q.isLoading} error={q.error} onRetry={() => void q.refetch()} />
      </Panel>
      {inviting && <InviteDialog onClose={() => setInviting(false)} />}
      <ConfirmDialog
        open={!!deactivate}
        onOpenChange={(o) => !o && setDeactivate(null)}
        title={t('clinic.users.deactivateTitle')}
        description={deactivate ? t('clinic.users.deactivateDescription', { name: deactivate.fullName }) : undefined}
        confirmLabel={t('clinic.users.deactivate')}
        danger
        loading={patch.isPending}
        onConfirm={() => deactivate && void change(deactivate, { active: false })}
      />
    </>
  );
}
