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
import { Panel } from '../components';
import { SecretReveal } from './SecretReveal';

type HookForm = z.input<typeof webhookCreateRequest>;
const STATUS = { delivered: ['success', 'Доставлен'], retrying: ['warning', 'Повтор'], failed: ['danger', 'Не доставлен'] } as const;

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
      title="Новый вебхук"
      description="МИГ отправляет тонкие события: только id события, тип, время и id объекта. Подробности МИС запрашивает через API"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Отмена
          </Button>
          <Button loading={create.isPending} onClick={() => void submit()}>
            Создать вебхук
          </Button>
        </>
      }
    >
      <form className="flex flex-col gap-3" onSubmit={(ev) => void submit(ev)} noValidate>
        <Field label="Адрес получателя" error={e.url?.message} hint="Только https://, без localhost, .local и адресов внутренних сетей">
          {(a) => <Input {...a} autoComplete="off" maxLength={2048} {...form.register('url')} />}
        </Field>
        <fieldset>
          <legend className="mb-1 text-[12px] font-medium text-muted">События</legend>
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
              {e.events.message}
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
    { key: 'event', header: 'Событие', cell: (d) => <code className="text-[12px]">{d.event}</code> },
    { key: 'at', header: 'Время', cell: (d) => <span className="num text-muted">{formatDateTime(d.lastAttemptAt)}</span> },
    { key: 'code', header: 'Код ответа', cell: (d) => <span className="num">{d.responseCode ?? '—'}</span> },
    { key: 'attempts', header: 'Попытки', align: 'right', cell: (d) => <span className="num">{d.attempts}</span> },
    { key: 'status', header: 'Статус', cell: (d) => <Chip kind={STATUS[d.status][0]}>{STATUS[d.status][1]}</Chip> },
    {
      key: 'retry',
      header: '',
      align: 'right',
      cell: (d) =>
        d.status === 'delivered' ? null : (
          <Button size="sm" variant="secondary" loading={retry.isPending && retry.variables === d.id} onClick={() => void run(retry.mutateAsync(d.id), 'Повторная доставка выполнена')}>
            Повторить
          </Button>
        ),
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <Panel title="Адреса" actions={<Button onClick={() => setCreating(true)}>Добавить вебхук</Button>}>
        {(hooks.data ?? []).length === 0 ? (
          <p className="p-4 text-muted">{hooks.isLoading ? 'Загрузка…' : 'Вебхуков пока нет'}</p>
        ) : (
          <ul className="divide-y divide-border-soft">
            {(hooks.data ?? []).map((h) => (
              <li key={h.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                <span className="min-w-0">
                  <code className="break-all text-[13px]">{h.url}</code>
                  <span className="block text-[12px] text-muted">
                    Секрет подписи ••••{h.secretLast4} · событий: {h.events.length} · создан {formatDateTime(h.createdAt)}
                  </span>
                </span>
                <Button size="sm" variant="secondary" loading={test.isPending && test.variables === h.id} onClick={() => void run(test.mutateAsync(h.id), 'Тестовое событие отправлено')}>
                  Отправить тестовое событие
                </Button>
              </li>
            ))}
          </ul>
        )}
        <p className="border-t border-border-soft px-4 py-2 text-[12px] text-muted">
          Подпись: заголовок <code>MIG-Signature: t=…,v1=…</code>, v1 = HMAC-SHA256(секрет, «t.тело»). Отклоняйте события старше 5 минут. Повторы: через 1, 5, 30 минут, 2 и 12 часов.
        </p>
      </Panel>
      <Panel title="Журнал доставок">
        <DataTable
          caption="Журнал доставок вебхуков"
          columns={columns}
          rows={deliveries.data}
          rowKey={(d) => d.id}
          loading={deliveries.isLoading}
          error={deliveries.error}
          onRetry={() => void deliveries.refetch()}
          empty={<EmptyState title="Доставок пока не было" />}
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
      {secret && <SecretReveal title="Вебхук создан" items={[{ label: 'Секрет подписи', value: secret, testId: 'new-webhook-secret' }]} onClose={() => setSecret(null)} />}
    </div>
  );
}
