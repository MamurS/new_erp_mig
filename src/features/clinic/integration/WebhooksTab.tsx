import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { z } from 'zod';
import type { WebhookDelivery } from '@/shared/types';
import { webhookCreateRequest } from '@/shared/integration/schemas';
import type { WebhookEvent } from '@/shared/types';
import { usePartner } from './partner';
import { useCreateWebhook, useDeliveries, useRetryDelivery, useTestWebhook, useWebhooks } from '@/shared/api/queries/clinic';
import { errorMessage } from '@/shared/api/client';
import { WEBHOOK_EVENT_LABEL } from '@/shared/domain/clinics';
import { formatDateTime } from '@/shared/lib/format';
import { Button } from '@/shared/ui/button';
import { Chip } from '@/shared/ui/chips';
import { DataTable, type Column } from '@/shared/ui/data-table';
import { Modal } from '@/shared/ui/dialog';
import { Field, Input } from '@/shared/ui/input';
import { EmptyState } from '@/shared/ui/states';
import { toast } from '@/shared/ui/toast';
import { useCan } from '@/shared/auth/guards';
import { roleName } from '@/features/next/NextActions';
import { Panel } from '../components';
import { EmptyHelp } from '../emptyNext';
import { SecretReveal } from './SecretReveal';
import { t, tm, defineLabels } from '@/i18n';

type HookForm = z.input<typeof webhookCreateRequest>;
const STATUS_CHIP = { delivered: 'success', retrying: 'warning', failed: 'danger' } as const;
const STATUS_LABEL = defineLabels('clinic.integration.delivery', ['delivered', 'retrying', 'failed'] as const);

function CreateWebhookDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (secret: string) => void }) {
  const partner = usePartner();
  const create = useCreateWebhook(partner.base);
  const form = useForm<HookForm>({ resolver: zodResolver(webhookCreateRequest), defaultValues: { url: 'https://', events: [...(partner.events as WebhookEvent[])] }, mode: 'onTouched' });
  const e = form.formState.errors;
  const submit = form.handleSubmit(async (v) => {
    try {
      onCreated((await create.mutateAsync(v)).signingSecret);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  });
  return (
    <Modal
      open
      wide
      onOpenChange={(o) => !o && onClose()}
      title={t('clinic.webhooks.newTitle')}
      description={t('clinic.webhooks.newDescription')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button loading={create.isPending} onClick={() => void submit()}>
            {t('clinic.webhooks.create')}
          </Button>
        </>
      }
    >
      <form className="flex flex-col gap-3" onSubmit={(ev) => void submit(ev)} noValidate>
        <Field label={t('clinic.webhooks.url')} error={tm(e.url?.message)} hint={t('clinic.webhooks.urlHint')}>
          {(a) => <Input {...a} autoComplete="off" maxLength={2048} {...form.register('url')} />}
        </Field>
        <fieldset>
          <legend className="mb-1 text-[12px] font-medium text-muted">{t('clinic.webhooks.events')}</legend>
          <div className="grid gap-1.5 sm:grid-cols-2">
            {(partner.events as WebhookEvent[]).map((ev) => (
              <label key={ev} className="flex items-center gap-2">
                <input type="checkbox" value={ev} {...form.register('events')} />
                <span>
                  {WEBHOOK_EVENT_LABEL[ev]} <code className="text-[12px] text-muted">{ev}</code>
                </span>
              </label>
            ))}
          </div>
          {e.events?.message && (
            <p role="alert" className="mt-1 text-[12px] text-danger-text">
              {tm(e.events.message)}
            </p>
          )}
        </fieldset>
      </form>
    </Modal>
  );
}

export function WebhooksTab() {
  const partner = usePartner();
  const hooks = useWebhooks(partner.base);
  const deliveries = useDeliveries(partner.base);
  const test = useTestWebhook(partner.base);
  const retry = useRetryDelivery(partner.base);
  const [creating, setCreating] = useState(false);
  const isClinic = partner.type === 'clinic';
  const canManage = useCan(isClinic ? 'clinic.integration.manage' : 'assist.integration.manage');
  const helpArticle = isClinic ? 'clinics' : 'administration';
  const helpSection = isClinic ? 'clinic-mis' : 'admin-integrations';
  const [secret, setSecret] = useState<string | null>(null);

  const run = async <T,>(p: Promise<T>, ok: string) => {
    try {
      await p;
      toast.success(ok);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const columns: Column<WebhookDelivery>[] = [
    { key: 'event', header: t('clinic.webhooks.event'), cell: (d) => <code className="text-[12px]">{d.event}</code> },
    { key: 'at', header: t('common.time'), cell: (d) => <span className="num text-muted">{formatDateTime(d.lastAttemptAt)}</span> },
    { key: 'code', header: t('clinic.webhooks.code'), cell: (d) => <span className="num">{d.responseCode ?? '—'}</span> },
    { key: 'attempts', header: t('clinic.webhooks.attempts'), align: 'right', cell: (d) => <span className="num">{d.attempts}</span> },
    { key: 'status', header: t('common.status'), cell: (d) => <Chip kind={STATUS_CHIP[d.status]}>{STATUS_LABEL[d.status]}</Chip> },
    {
      key: 'retry',
      header: '',
      align: 'right',
      cell: (d) =>
        d.status === 'delivered' ? null : (
          <Button size="sm" variant="secondary" loading={retry.isPending && retry.variables === d.id} onClick={() => void run(retry.mutateAsync(d.id), t('clinic.webhooks.retried'))}>
            {t('common.retry')}
          </Button>
        ),
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <Panel title={t('clinic.webhooks.addresses')} actions={<Button onClick={() => setCreating(true)}>{t('clinic.webhooks.add')}</Button>}>
        {(hooks.data ?? []).length === 0 ? (
          hooks.isLoading ? (
            <p className="p-4 text-muted">{t('common.loading')}</p>
          ) : (
            <EmptyState
              testId="webhooks-empty"
              className="py-6"
              title={t('clinic.webhooks.empty')}
              why={t('emptyPartner.webhooks.why')}
              next={t('emptyPartner.webhooks.next', { role: roleName(isClinic ? 'clinic_admin' : 'asst_admin') })}
              actions={canManage ? <Button variant="secondary" onClick={() => setCreating(true)}>{t('emptyPartner.webhooks.create')}</Button> : undefined}
              help={<EmptyHelp article={helpArticle} section={helpSection} contact={!canManage} />}
            />
          )
        ) : (
          <ul className="divide-y divide-border-soft">
            {(hooks.data ?? []).map((h) => (
              <li key={h.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                <span className="min-w-0">
                  <code className="break-all text-[13px]">{h.url}</code>
                  <span className="block text-[12px] text-muted">
                    {t('clinic.webhooks.meta', { last4: h.secretLast4, n: h.events.length, at: formatDateTime(h.createdAt) })}
                  </span>
                </span>
                <Button size="sm" variant="secondary" loading={test.isPending && test.variables === h.id} onClick={() => void run(test.mutateAsync(h.id), t('clinic.webhooks.testSent'))}>
                  {t('clinic.webhooks.test')}
                </Button>
              </li>
            ))}
          </ul>
        )}
        <p className="border-t border-border-soft px-4 py-2 text-[12px] text-muted">
          {t('clinic.webhooks.signatureBefore')} <code>MIG-Signature: t=…,v1=…</code>
          {t('clinic.webhooks.signatureAfter')}
        </p>
      </Panel>
      <Panel title={t('clinic.webhooks.deliveries')}>
        <DataTable
          caption={t('clinic.webhooks.deliveriesCaption')}
          columns={columns}
          rows={deliveries.data}
          rowKey={(d) => d.id}
          loading={deliveries.isLoading}
          error={deliveries.error}
          onRetry={() => void deliveries.refetch()}
          empty={<EmptyState testId="deliveries-empty" title={t('clinic.webhooks.deliveriesEmpty')} why={t('emptyPartner.webhooks.deliveriesWhy')} help={<EmptyHelp article={helpArticle} section={helpSection} />} />}
        />
      </Panel>
      {creating && (
        <CreateWebhookDialog
          onClose={() => setCreating(false)}
          onCreated={(s) => {
            setCreating(false);
            setSecret(s);
          }}
        />
      )}
      {secret && <SecretReveal title={t('clinic.webhooks.createdTitle')} items={[{ label: t('clinic.webhooks.signingSecret'), value: secret, testId: 'new-webhook-secret' }]} onClose={() => setSecret(null)} />}
    </div>
  );
}
