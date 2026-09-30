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
import { Button } from '@/shared/ui/button';
import { Chip } from '@/shared/ui/chips';
import { DataTable, type Column } from '@/shared/ui/data-table';
import { Modal } from '@/shared/ui/dialog';
import { Field, Input, Select } from '@/shared/ui/input';
import { PageHeader } from '@/shared/ui/page';
import { toast } from '@/shared/ui/toast';
import { useTopbar } from '@/features/staff/topbar';

type Invite = z.input<typeof assistUserInviteSchema>;

function InviteDialog({ onClose }: { onClose: () => void }) {
  const invite = useInviteAssistUser();
  const form = useForm<Invite>({ resolver: zodResolver(assistUserInviteSchema), defaultValues: { email: '', fullName: '', role: 'asst_operator' } });
  const e = form.formState.errors;
  const submit = form.handleSubmit(async (v) => {
    try {
      await invite.mutateAsync(v);
      toast.success('Пользователь приглашён');
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
      description="Вход по email и паролю с кодом подтверждения (MFA)"
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
          {(a) => <Input {...a} maxLength={120} {...form.register('fullName')} />}
        </Field>
        <Field label="Email" error={e.email?.message}>
          {(a) => <Input {...a} type="email" maxLength={254} {...form.register('email')} />}
        </Field>
        <Field label="Роль" error={e.role?.message}>
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
  useDocumentTitle('Пользователи');
  useTopbar([{ label: 'Пользователи' }]);
  const me = useUser();
  const q = useAssistUsers();
  const patch = usePatchAssistUser();
  const [inviting, setInviting] = useState(false);
  const change = async (u: AssistUserView, body: { role?: AssistanceRole; active?: boolean }) => {
    try {
      await patch.mutateAsync({ id: u.id, ...body });
      toast.success('Сохранено');
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  const columns: Column<AssistUserView>[] = [
    { key: 'name', header: 'ФИО', cell: (u) => <span className="font-medium">{u.fullName}</span> },
    { key: 'email', header: 'Email', cell: (u) => u.email },
    {
      key: 'role',
      header: 'Роль',
      cell: (u) =>
        u.id === me?.id ? (
          ROLE_LABEL[u.role]
        ) : (
          <Select aria-label={`Роль ${u.fullName}`} value={u.role} onChange={(e) => void change(u, { role: e.target.value as AssistanceRole })}>
            {ASSISTANCE_ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </Select>
        ),
    },
    { key: 'login', header: 'Последний вход', cell: (u) => (u.lastLoginAt ? <span className="num">{formatDateTime(u.lastLoginAt)}</span> : '—') },
    { key: 'status', header: 'Статус', cell: (u) => <Chip kind={u.active ? 'success' : 'neutral'}>{u.active ? 'Активен' : 'Отключён'}</Chip> },
    {
      key: 'actions',
      header: '',
      align: 'right',
      cell: (u) =>
        u.id === me?.id ? null : (
          <Button size="sm" variant="ghost" onClick={() => void change(u, { active: !u.active })}>
            {u.active ? 'Отключить' : 'Включить'}
          </Button>
        ),
    },
  ];
  return (
    <>
      <PageHeader title="Пользователи ассистанса" actions={<Button onClick={() => setInviting(true)}>Пригласить</Button>} />
      <div className="rounded-card border border-border bg-surface">
        <DataTable caption="Пользователи" columns={columns} rows={q.data} loading={q.isLoading} error={q.error} onRetry={() => void q.refetch()} rowKey={(u) => u.id} />
      </div>
      {inviting && <InviteDialog onClose={() => setInviting(false)} />}
    </>
  );
}
