import { useIntegrationOverview } from '@/shared/api/queries/clinic';
import { getDemo } from '@/shared/demo';
import { INTEGRATION_MODE_LABEL, WEBHOOK_EVENT_LABEL } from '@/shared/domain/clinics';
import { formatDateTime } from '@/shared/lib/format';
import { Chip } from '@/shared/ui/chips';
import { QueryState, SkeletonRows } from '@/shared/ui/states';
import { Panel } from '../components';
import { usePartner } from './partner';

const DELIVERY_LABEL = { delivered: 'Доставлен', retrying: 'Повтор', failed: 'Не доставлен' } as const;

export function OverviewTab() {
  const partner = usePartner();
  const q = useIntegrationOverview(partner.base);
  // The assistance simulator is for companies connected by API (api or hybrid mode).
  const Simulator = partner.type === 'assistance' ? (q.data && q.data.mode !== 'portal' ? getDemo()?.AssistSimulator : undefined) : getDemo()?.MisSimulator;
  return (
    <div className="flex flex-col gap-4">
      <QueryState query={q} skeleton={<SkeletonRows rows={3} />}>
        {(o) => (
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5" data-testid="integration-overview">
            <Panel className="p-4">
              <div className="text-[12px] text-muted">Режим</div>
              <div className="font-semibold">{INTEGRATION_MODE_LABEL[o.mode]}</div>
            </Panel>
            <Panel className="p-4">
              <div className="text-[12px] text-muted">Подключение</div>
              <Chip kind={o.connected ? 'success' : 'neutral'}>{o.connected ? 'Запросы идут' : 'Запросов за сутки нет'}</Chip>
              <div className="mt-1 text-[12px] text-muted">Активных ключей: {o.activeKeys}</div>
            </Panel>
            <Panel className="p-4">
              <div className="text-[12px] text-muted">Запросы за 24 ч</div>
              <div className="num font-semibold">{o.requests24h}</div>
            </Panel>
            <Panel className="p-4">
              <div className="text-[12px] text-muted">Ошибки за 24 ч</div>
              <div className={o.errors24h ? 'num font-semibold text-danger-text' : 'num font-semibold'}>{o.errors24h}</div>
            </Panel>
            <Panel className="p-4">
              <div className="text-[12px] text-muted">Последний вебхук</div>
              {o.lastWebhook ? (
                <>
                  <div className="font-semibold">{WEBHOOK_EVENT_LABEL[o.lastWebhook.event]}</div>
                  <div className="text-[12px] text-muted">
                    {formatDateTime(o.lastWebhook.at)} · {DELIVERY_LABEL[o.lastWebhook.status]}
                  </div>
                </>
              ) : (
                <div className="text-muted">—</div>
              )}
            </Panel>
          </div>
        )}
      </QueryState>
      {Simulator && <Simulator />}
    </div>
  );
}
