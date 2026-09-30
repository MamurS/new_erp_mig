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

type Invite = z.input<typeof clinicUserInviteSchema>;

function InviteDialog({ onClose }: { onClose: () => void }) {
  const invite = useInviteClinicUser();
  const form = useForm<Invite>({ resolver: zodResolver(clinicUserInviteSchema), defaultValues: { email: '', fullName: '', role: 'clinic_registrar' } });
  const e = form.formState.errors;
  const submit = form.handleSubmit(async (v) => {
    try {
      await invite.mutateAsync(v);
      toast.success('Приглашение отправлено');
      onClose();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  });
  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title="Пригласить пользователя"
      description="Пользователь получит письмо со ссылкой. Вход — с паролем и кодом подтверждения"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Отмена
          </Button>
          <Button loading={invite.isPending} onClick={() => void submit()}>
            Пригласить
          </Button>
        </>
      }
    >
      <form className="flex flex-col gap-3" onSubmit={(ev) => void submit(ev)} noValidate>
        <Field label="ФИО" error={e.fullName?.message}>
          {(a) => <Input {...a} autoComplete="off" {...form.register('fullName')} />}
        </Field>
        <Field label="Рабочий email" error={e.email?.message}>
          {(a) => <Input {...a} type="email" autoComplete="off" {...form.register('email')} />}
        </Field>
        <Field label="Роль" error={e.role?.message}>
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
  useDocumentTitle('Пользователи клиники');
  const me = useUser();
  const q = useClinicUsers();
  const patch = usePatchClinicUser();
  const [inviting, setInviting] = useState(false);
  const [deactivate, setDeactivate] = useState<ClinicUserView | null>(null);

  const change = async (u: ClinicUserView, body: { role?: ClinicUserView['role']; active?: boolean }) => {
    try {
      await patch.mutateAsync({ id: u.id, ...body });
      toast.success(body.active === false ? 'Пользователь деактивирован' : body.active ? 'Пользователь восстановлен' : 'Роль изменена');
      setDeactivate(null);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const columns: Column<ClinicUserView>[] = [
    { key: 'name', header: 'Пользователь', cell: (u) => <span className="font-medium">{u.fullName}</span> },
    { key: 'email', header: 'Email', cell: (u) => <span className="text-muted">{u.email}</span> },
    {
      key: 'role',
      header: 'Роль',
      cell: (u) =>
        u.id === me?.id ? (
          ROLE_LABEL[u.role]
        ) : (
          <Select aria-label={`Роль: ${u.fullName}`} value={u.role} onChange={(e) => void change(u, { role: e.target.value as ClinicUserView['role'] })} className="h-9 w-56">
            <option value="clinic_registrar">{ROLE_LABEL.clinic_registrar}</option>
            <option value="clinic_admin">{ROLE_LABEL.clinic_admin}</option>
          </Select>
        ),
    },
    { key: 'login', header: 'Последний вход', cell: (u) => <span className="num text-muted">{u.lastLoginAt ? formatDateTime(u.lastLoginAt) : '—'}</span> },
    { key: 'status', header: 'Статус', cell: (u) => <Chip kind={u.active ? 'success' : 'neutral'}>{u.active ? 'Активен' : 'Деактивирован'}</Chip> },
    {
      key: 'actions',
      header: '',
      align: 'right',
      cell: (u) =>
        u.id === me?.id ? (
          <span className="text-[12px] text-muted">Это вы</span>
        ) : u.active ? (
          <Button size="sm" variant="secondary" onClick={() => setDeactivate(u)}>
            Деактивировать
          </Button>
        ) : (
          <Button size="sm" variant="secondary" onClick={() => void change(u, { active: true })}>
            Восстановить
          </Button>
        ),
    },
  ];
  return (
    <>
      <PageTitle title="Пользователи" actions={<Button onClick={() => setInviting(true)}>Пригласить пользователя</Button>} />
      <Panel>
        <DataTable caption="Пользователи клиники" columns={columns} rows={q.data} rowKey={(u) => u.id} loading={q.isLoading} error={q.error} onRetry={() => void q.refetch()} />
      </Panel>
      {inviting && <InviteDialog onClose={() => setInviting(false)} />}
      <ConfirmDialog
        open={!!deactivate}
        onOpenChange={(o) => !o && setDeactivate(null)}
        title="Деактивировать пользователя?"
        description={deactivate ? `${deactivate.fullName} больше не сможет войти в кабинет` : undefined}
        confirmLabel="Деактивировать"
        danger
        loading={patch.isPending}
        onConfirm={() => deactivate && void change(deactivate, { active: false })}
      />
    </>
  );
}
