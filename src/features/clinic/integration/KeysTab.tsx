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
import { t, tm } from '@/i18n';

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
      title={t('clinic.keys.newTitle')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button loading={create.isPending} onClick={() => void submit()}>
            {t('clinic.keys.create')}
          </Button>
        </>
      }
    >
      <form className="flex flex-col gap-3" onSubmit={(ev) => void submit(ev)} noValidate>
        <Field label={t('common.name')} error={tm(e.name?.message)} hint={t('clinic.keys.nameHint')}>
          {(a) => <Input {...a} autoComplete="off" maxLength={60} {...form.register('name')} />}
        </Field>
        <fieldset>
          <legend className="mb-1 text-[12px] font-medium text-muted">{t('clinic.keys.scopes')}</legend>
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
              {tm(e.scopes.message)}
            </p>
          )}
        </fieldset>
        <Field label={t('clinic.keys.ip')} error={e.ipAllowlist ? (e.ipAllowlist.message ? tm(e.ipAllowlist.message) : t('clinic.keys.ipError')) : undefined} hint={t('clinic.keys.ipHint')}>
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
      toast.success(t('clinic.keys.revoked'));
      setRevoking(null);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const columns: Column<IntegrationClient>[] = [
    { key: 'name', header: t('common.name'), cell: (k) => <span className="font-medium">{k.name}</span> },
    { key: 'id', header: 'client_id', cell: (k) => <code className="text-[12px]">{k.clientId}</code> },
    { key: 'secret', header: t('clinic.keys.secret'), cell: (k) => <code className="text-[12px] text-muted">••••{k.secretLast4}</code> },
    { key: 'scopes', header: t('clinic.keys.scopesShort'), cell: (k) => <span className="text-[12px] text-muted">{k.scopes.length === partner.scopes.length ? t('clinic.keys.allScopes') : k.scopes.join(', ')}</span> },
    { key: 'created', header: t('clinic.keys.created'), cell: (k) => <span className="num text-muted">{formatDateTime(k.createdAt)}</span> },
    { key: 'used', header: t('clinic.keys.lastUsed'), cell: (k) => <span className="num text-muted">{k.lastUsedAt ? formatDateTime(k.lastUsedAt) : '—'}</span> },
    {
      key: 'actions',
      header: '',
      align: 'right',
      cell: (k) =>
        k.revokedAt ? (
          <Chip kind="neutral">{t('clinic.keys.revokedAt', { at: formatDateTime(k.revokedAt) })}</Chip>
        ) : (
          <Button size="sm" variant="secondary" onClick={() => setRevoking(k)} aria-label={t('clinic.keys.revokeAria', { name: k.name })}>
            {t('common.revoke')}
          </Button>
        ),
    },
  ];
  return (
    <>
      <Panel
        title={t('clinic.integration.tab.keys')}
        actions={<Button onClick={() => setCreating(true)}>{t('clinic.keys.create')}</Button>}
      >
        <p className="px-4 pt-3 text-[12px] text-muted">{t('clinic.keys.rotation')}</p>
        <DataTable caption={t('clinic.integration.tab.keys')} columns={columns} rows={q.data} rowKey={(k) => k.id} loading={q.isLoading} error={q.error} onRetry={() => void q.refetch()} empty={<EmptyState title={t('clinic.keys.empty')} />} />
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
          title={t('clinic.keys.createdTitle')}
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
        title={t('clinic.keys.revokeTitle')}
        description={t('clinic.keys.revokeDescription')}
        confirmLabel={t('common.revoke')}
        danger
        loading={revoke.isPending}
        onConfirm={() => void doRevoke()}
      />
    </>
  );
}
