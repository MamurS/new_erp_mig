import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { z } from 'zod';
import type { IntegrationClient } from '@/shared/types';
import { keyCreateRequest } from '@/shared/integration/schemas';
import type { IntegrationScope } from '@/shared/types';
import { usePartner } from './partner';
import { useCreateKey, useIntegrationKeys, useRevokeKey } from '@/shared/api/queries/clinic';
import { errorMessage } from '@/shared/api/client';
import { SCOPE_LABEL } from '@/shared/domain/clinics';
import { formatDateTime } from '@/shared/lib/format';
import { Button } from '@/shared/ui/button';
import { Chip } from '@/shared/ui/chips';
import { ConfirmDialog } from '@/shared/ui/confirm-dialog';
import { DataTable, type Column } from '@/shared/ui/data-table';
import { Modal } from '@/shared/ui/dialog';
import { Field, Input, Textarea } from '@/shared/ui/input';
import { EmptyState } from '@/shared/ui/states';
import { toast } from '@/shared/ui/toast';
import { Panel } from '../components';
import { SecretReveal } from './SecretReveal';

type KeyForm = z.input<typeof keyCreateRequest>;

function CreateKeyDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (v: { clientId: string; clientSecret: string }) => void }) {
  const partner = usePartner();
  const create = useCreateKey(partner.base);
  const form = useForm<KeyForm, unknown, z.output<typeof keyCreateRequest>>({ resolver: zodResolver(keyCreateRequest), defaultValues: { name: '', scopes: [partner.defaultScope as IntegrationScope], ipAllowlist: '' } });
  const e = form.formState.errors;
  const submit = form.handleSubmit(async (v) => {
    try {
      onCreated(await create.mutateAsync({ name: v.name, scopes: v.scopes, ipAllowlist: v.ipAllowlist.join(', ') }));
    } catch (err) {
      toast.error(errorMessage(err));
    }
  });
  return (
    <Modal
      open
      wide
      onOpenChange={(o) => !o && onClose()}
      title="Новый ключ API"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Отмена
          </Button>
          <Button loading={create.isPending} onClick={() => void submit()}>
            Создать ключ
          </Button>
        </>
      }
    >
      <form className="flex flex-col gap-3" onSubmit={(ev) => void submit(ev)} noValidate>
        <Field label="Название" error={e.name?.message} hint="Например, «МИС регистратуры»">
          {(a) => <Input {...a} autoComplete="off" maxLength={60} {...form.register('name')} />}
        </Field>
        <fieldset>
          <legend className="mb-1 text-[12px] font-medium text-muted">Области доступа</legend>
          <div className="grid gap-1.5 sm:grid-cols-2">
            {(partner.scopes as IntegrationScope[]).map((s) => (
              <label key={s} className="flex items-center gap-2">
                <input type="checkbox" value={s} {...form.register('scopes')} />
                <span>
                  {SCOPE_LABEL[s]} <code className="text-[12px] text-muted">{s}</code>
                </span>
              </label>
            ))}
          </div>
          {e.scopes?.message && (
            <p role="alert" className="mt-1 text-[12px] text-danger-text">
              {e.scopes.message}
            </p>
          )}
        </fieldset>
        <Field label="Разрешённые IP (необязательно)" error={e.ipAllowlist ? (e.ipAllowlist.message ?? 'Проверьте адреса: IP или подсеть, например 203.0.113.0/24') : undefined} hint="Через запятую или с новой строки: 203.0.113.10, 198.51.100.0/24">
          {(a) => <Textarea {...a} rows={2} maxLength={1000} {...form.register('ipAllowlist')} />}
        </Field>
      </form>
    </Modal>
  );
}

export function KeysTab() {
  const partner = usePartner();
  const q = useIntegrationKeys(partner.base);
  const revoke = useRevokeKey(partner.base);
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<{ clientId: string; clientSecret: string } | null>(null);
  const [revoking, setRevoking] = useState<IntegrationClient | null>(null);

  const doRevoke = async () => {
    if (!revoking) return;
    try {
      await revoke.mutateAsync(revoking.id);
      toast.success('Ключ отозван');
      setRevoking(null);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const columns: Column<IntegrationClient>[] = [
    { key: 'name', header: 'Название', cell: (k) => <span className="font-medium">{k.name}</span> },
    { key: 'id', header: 'client_id', cell: (k) => <code className="text-[12px]">{k.clientId}</code> },
    { key: 'secret', header: 'Секрет', cell: (k) => <code className="text-[12px] text-muted">••••{k.secretLast4}</code> },
    { key: 'scopes', header: 'Области', cell: (k) => <span className="text-[12px] text-muted">{k.scopes.length === partner.scopes.length ? 'все' : k.scopes.join(', ')}</span> },
    { key: 'created', header: 'Создан', cell: (k) => <span className="num text-muted">{formatDateTime(k.createdAt)}</span> },
    { key: 'used', header: 'Последнее использование', cell: (k) => <span className="num text-muted">{k.lastUsedAt ? formatDateTime(k.lastUsedAt) : '—'}</span> },
    {
      key: 'actions',
      header: '',
      align: 'right',
      cell: (k) =>
        k.revokedAt ? (
          <Chip kind="neutral">Отозван {formatDateTime(k.revokedAt)}</Chip>
        ) : (
          <Button size="sm" variant="secondary" onClick={() => setRevoking(k)} aria-label={`Отозвать ${k.name}`}>
            Отозвать
          </Button>
        ),
    },
  ];
  return (
    <>
      <Panel
        title="Ключи API"
        actions={<Button onClick={() => setCreating(true)}>Создать ключ</Button>}
      >
        <p className="px-4 pt-3 text-[12px] text-muted">Ротация: создайте новый ключ, переключите МИС на него, затем отзовите старый.</p>
        <DataTable caption="Ключи API" columns={columns} rows={q.data} rowKey={(k) => k.id} loading={q.isLoading} error={q.error} onRetry={() => void q.refetch()} empty={<EmptyState title="Ключей пока нет" />} />
      </Panel>
      {creating && (
        <CreateKeyDialog
          onClose={() => setCreating(false)}
          onCreated={(v) => {
            setCreating(false);
            setCreated(v);
          }}
        />
      )}
      {created && (
        <SecretReveal
          title="Ключ создан"
          items={[
            { label: 'client_id', value: created.clientId, testId: 'new-client-id' },
            { label: 'client_secret', value: created.clientSecret, testId: 'new-client-secret' },
          ]}
          onClose={() => setCreated(null)}
        />
      )}
      <ConfirmDialog
        open={!!revoking}
        onOpenChange={(o) => !o && setRevoking(null)}
        title="Отозвать ключ?"
        description="Ключ сразу перестанет выдавать токены, а уже выданные токены перестанут работать"
        confirmLabel="Отозвать"
        danger
        loading={revoke.isPending}
        onConfirm={() => void doRevoke()}
      />
    </>
  );
}
