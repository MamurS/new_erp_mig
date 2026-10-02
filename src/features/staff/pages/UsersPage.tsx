import { useState } from 'react';
import type { StaffRole, StaffUser } from '@/shared/types';
import { useAdminUsers, usePatchUser } from '@/shared/api/queries/staff';
import { errorMessage } from '@/shared/api/client';
import { useUser } from '@/shared/auth/session';
import { ROLE_LABEL, STAFF_ROLES } from '@/shared/domain/labels';
import { formatDateTime } from '@/shared/lib/format';
import { useDocumentTitle } from '@/shared/lib/hooks';
import { Button } from '@/shared/ui/button';
import { Avatar, StatusDot } from '@/shared/ui/chips';
import { ConfirmDialog } from '@/shared/ui/confirm-dialog';
import { DataTable, type Column } from '@/shared/ui/data-table';
import { Select } from '@/shared/ui/input';
import { toast } from '@/shared/ui/toast';
import { Tooltip } from '@/shared/ui/tooltip';
import { useTopbar } from '../topbar';
import { AuthorityChangesCard, AuthorityDialog, authoritySummary } from '../admin/Authority';

type Pending = { kind: 'role'; user: StaffUser; role: StaffRole } | { kind: 'active'; user: StaffUser; active: boolean };

/** Roles with personal authority or the right to sign for MIG. */
const AUTHORITY_ROLES: StaffRole[] = ['underwriter', 'claims_officer', 'sales_manager'];

export default function UsersPage() {
  useDocumentTitle('Пользователи и роли');
  useTopbar([{ label: 'Пользователи и роли' }]);
  const me = useUser()!;
  const list = useAdminUsers();
  const patch = usePatchUser();
  const [pending, setPending] = useState<Pending | null>(null);
  const [authorityOf, setAuthorityOf] = useState<StaffUser | null>(null);

  const cols: Column<StaffUser>[] = [
    {
      key: 'name',
      header: 'Сотрудник',
      cell: (u) => (
        <span className="flex items-center gap-2">
          <Avatar name={u.fullName} />
          <span>
            <span className="block font-medium">
              {u.fullName} {u.id === me.id && <span className="text-muted">(вы)</span>}
            </span>
            <span className="block text-[12px] text-muted">{u.email}</span>
          </span>
        </span>
      ),
    },
    {
      key: 'role',
      header: 'Роль',
      cell: (u) => {
        const self = u.id === me.id;
        const select = (
          <Select
            aria-label={`Роль: ${u.fullName}`}
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
          <Tooltip content="Нельзя снять роль администратора с самого себя">
            <span tabIndex={0}>{select}</span>
          </Tooltip>
        ) : (
          select
        );
      },
    },
    {
      key: 'authority',
      header: 'Полномочия',
      cell: (u) =>
        AUTHORITY_ROLES.includes(u.role) ? (
          <span className="flex items-center gap-2">
            <span className="text-[12px] text-muted">{authoritySummary(u.authority, u.signatory)}</span>
            {u.id !== me.id && u.active && (
              <Button size="sm" variant="ghost" onClick={() => setAuthorityOf(u)} aria-label={`Полномочия: ${u.fullName}`}>
                Изменить
              </Button>
            )}
          </span>
        ) : null,
    },
    { key: 'status', header: 'Статус', cell: (u) => <StatusDot tone={u.active ? 'success' : 'muted'}>{u.active ? 'Активен' : 'Деактивирован'}</StatusDot> },
    { key: 'last', header: 'Последний вход', cell: (u) => <span className="text-muted">{u.lastLoginAt ? formatDateTime(u.lastLoginAt) : '—'}</span> },
    {
      key: 'actions',
      header: '',
      align: 'right',
      cell: (u) =>
        u.id === me.id ? null : u.active ? (
          <Button size="sm" variant="secondary" className="text-danger-text" onClick={() => setPending({ kind: 'active', user: u, active: false })}>
            Деактивировать
          </Button>
        ) : (
          <Button size="sm" variant="secondary" onClick={() => setPending({ kind: 'active', user: u, active: true })}>
            Активировать
          </Button>
        ),
    },
  ];

  const confirmText =
    pending?.kind === 'role'
      ? {
          title: 'Сменить роль?',
          description: `${pending.user.fullName}: «${ROLE_LABEL[pending.user.role]}» → «${ROLE_LABEL[pending.role]}». Права изменятся сразу, активные сессии сотрудника будут завершены. Действие записывается в журнал аудита.`,
          label: 'Сменить роль',
          toast: 'Роль изменена',
        }
      : pending?.active === false
        ? {
            title: 'Деактивировать сотрудника?',
            description: `${pending.user.fullName} больше не сможет войти, активные сессии будут завершены. Данные и журнал сохранятся.`,
            label: 'Деактивировать',
            toast: 'Сотрудник деактивирован',
          }
        : { title: 'Активировать сотрудника?', description: 'Сотрудник снова сможет входить в портал.', label: 'Активировать', toast: 'Сотрудник активирован' };

  return (
    <div>
      <div className="mb-3">
        <h1 className="text-[22px] font-bold">Пользователи и роли</h1>
        <p className="text-muted">Сотрудники MIG с доступом к порталу. У администратора нет доступа к медданным и убыткам.</p>
      </div>
      <AuthorityChangesCard />
      <div className="rounded-card border border-border bg-surface">
        <DataTable caption="Сотрудники" columns={cols} rows={list.data} rowKey={(u) => u.id} loading={list.isLoading} error={list.error} onRetry={() => void list.refetch()} rowHeight={52} />
      </div>
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
