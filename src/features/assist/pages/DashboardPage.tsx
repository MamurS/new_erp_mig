/* Desktop of the assistance (ASSISTANCE_SPEC §6): queue by role with SLA, counters and KPI of the month. */
import { Link } from 'react-router-dom';
import { CalendarClock, ClipboardList, FileCheck, Headphones, Receipt, Send } from 'lucide-react';
import { useAssistOverview } from '@/shared/api/queries/assist';
import { useUser } from '@/shared/auth/session';
import { formatMoney } from '@/shared/lib/format';
import { useDocumentTitle } from '@/shared/lib/hooks';
import { PageHeader, Card } from '@/shared/ui/page';
import { EmptyState, QueryState } from '@/shared/ui/states';
import { useTopbar } from '@/features/staff/topbar';
import { KpiGrid, SlaBadge, Stat } from '../components';

const KIND_ICON = { appointment: CalendarClock, case: Headphones, guarantee: FileCheck, registry: ClipboardList, escalation: Send, rebill: Receipt } as const;
const KIND_LABEL = { appointment: 'Запись', case: 'Обращение', guarantee: 'ГП', registry: 'Реестр', escalation: 'В МИГ', rebill: 'Счёт МИГ' } as const;

export default function DashboardPage() {
  useDocumentTitle('Рабочий стол ассистанса');
  useTopbar([{ label: 'Рабочий стол' }]);
  const user = useUser();
  const q = useAssistOverview();
  return (
    <QueryState query={q}>
      {(o) => (
        <div className="flex flex-col gap-4">
          <PageHeader
            title={`Здравствуйте, ${user?.displayName.split(' ')[0] ?? ''}`}
            subtitle={
              <>
                {o.assistance.name} · линия 24/7 <span className="num">{o.assistance.phone24x7}</span> · полномочия по ГП до {formatMoney(o.authorityLimit)}
              </>
            }
          />
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            <Stat label="Открытые обращения" value={o.counters.openCases} />
            <Stat label="Нарушения SLA" value={o.counters.slaBreaches} tone={o.counters.slaBreaches ? 'danger' : undefined} />
            <Stat label="ГП на решение" value={o.counters.guaranteesPending} tone={o.counters.guaranteesPending ? 'warning' : undefined} />
            <Stat label="Строк реестров к проверке" value={o.counters.linesPending} />
            <Stat label="Счета МИГ на проверке" value={o.counters.rebillsInReview} />
          </div>
          <Card title="Очередь" bodyClassName="p-0">
            {o.queue.length === 0 ? (
              <EmptyState title="Очередь пуста" description="Новые обращения, записи, ГП и строки реестров появятся здесь" />
            ) : (
              <ul className="divide-y divide-border-soft" data-testid="assist-queue">
                {o.queue.map((item) => {
                  const Icon = KIND_ICON[item.kind];
                  return (
                    <li key={`${item.kind}-${item.id}`}>
                      <Link to={item.to} className="flex items-center gap-3 px-4 py-2.5 hover:bg-rail">
                        <Icon className="h-4 w-4 shrink-0 text-muted" aria-hidden />
                        <span className="w-24 shrink-0 text-[12px] text-muted">{KIND_LABEL[item.kind]}</span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium">{item.title}</span>
                          <span className="block truncate text-[12px] text-muted">{item.subtitle}</span>
                        </span>
                        {item.dueAt && <SlaBadge dueAt={item.dueAt} />}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
          <div>
            <h2 className="mb-2 text-[14px] font-bold">KPI за месяц</h2>
            <KpiGrid kpi={o.kpi} />
          </div>
        </div>
      )}
    </QueryState>
  );
}
