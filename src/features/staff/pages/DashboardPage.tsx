import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AlertTriangle, ChevronRight, KeyRound, PlugZap } from 'lucide-react';
import type { QueueItem } from '@/shared/types/dto';
import { useConfirmAppointment, useDashboard, useIntegrations, useMedicalAccessFeed, useQueue } from '@/shared/api/queries/staff';
import { errorMessage } from '@/shared/api/client';
import { useUser } from '@/shared/auth/session';
import { AUDIT_ACTION_LABEL } from '@/shared/domain/labels';
import { daysUntil, formatDate, formatDateTime, formatRelativeDays, formatTime, plural } from '@/shared/lib/format';
import { useDocumentTitle } from '@/shared/lib/hooks';
import { cn } from '@/shared/lib/cn';
import { Button } from '@/shared/ui/button';
import { Chip, StatusDot } from '@/shared/ui/chips';
import { DataTable, type Column } from '@/shared/ui/data-table';
import { Card } from '@/shared/ui/page';
import { EmptyState, ErrorState, Skeleton, SkeletonRows } from '@/shared/ui/states';
import { toast } from '@/shared/ui/toast';
import { KpiCard } from '../components/KpiCard';
import { kpNewPath } from '@/features/kp/paths';
import { can } from '@/shared/auth/permissions';
import { useTopbar } from '../topbar';

const TABS = [
  { key: 'all', label: 'Все' },
  { key: 'appointment', label: 'Записи' },
  { key: 'claim', label: 'Убытки' },
  { key: 'renewal', label: 'Продления' },
  { key: 'guarantee', label: 'ГП', action: 'guarantees.decide' },
  { key: 'registry', label: 'Реестры', action: 'registries.review' },
  { key: 'policy_change', label: 'Состав', action: 'policy_changes.decide' },
] as const;

const TYPE_CHIP: Record<QueueItem['type'], { kind: string; label: string }> = {
  appointment: { kind: 'appointment', label: 'Запись' },
  claim: { kind: 'claim', label: 'Убыток' },
  renewal: { kind: 'renewal', label: 'Продление' },
  guarantee: { kind: 'sky', label: 'ГП' },
  registry: { kind: 'peach', label: 'Реестр' },
  clinic_no_response: { kind: 'danger', label: 'Клиника не ответила' },
  policy_change: { kind: 'accent', label: 'Состав полиса' },
};

function greeting(now = new Date()): string {
  const h = Number(new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hourCycle: 'h23', timeZone: 'Asia/Tashkent' }).format(now));
  if (h < 12) return 'Доброе утро';
  if (h < 18) return 'Добрый день';
  return 'Добрый вечер';
}

export default function DashboardPage() {
  useDocumentTitle('Рабочий стол');
  useTopbar([{ label: 'Рабочий стол' }]);
  const user = useUser()!;
  const navigate = useNavigate();
  const dashboard = useDashboard();
  const [tab, setTab] = useState<(typeof TABS)[number]['key']>('all');
  const queue = useQueue(tab);
  const confirm = useConfirmAppointment();
  const [done, setDone] = useState<Map<string, QueueItem>>(new Map());
  const [showAll, setShowAll] = useState(false);
  const showMedical = user.role === 'admin' || user.role === 'doctor_expert';

  // Confirmed rows stay visible with the new status instead of disappearing (update in place).
  const rows = useMemo(() => {
    const base = (queue.data ?? []).map((r) => done.get(r.id) ?? r);
    for (const r of done.values()) {
      if (!base.some((b) => b.id === r.id) && (tab === 'all' || tab === r.type || (tab === 'appointment' && r.type === 'clinic_no_response'))) base.push(r);
    }
    return base.sort((a, b) => (a.dueAt < b.dueAt ? -1 : 1));
  }, [queue.data, done, tab]);

  const onAction = async (row: QueueItem) => {
    if (row.action === 'confirm') {
      try {
        await confirm.mutateAsync(row.entityId);
        setDone((m) => new Map(m).set(row.id, { ...row, status: 'Подтверждена', statusTone: 'success', action: 'open' }));
        toast.success('Запись подтверждена');
      } catch (e) {
        toast.error(errorMessage(e));
      }
    } else if (row.action === 'prepare_offer') {
      navigate(kpNewPath(row.entityId, row.policyId));
    } else {
      openRow(row);
    }
  };

  const openRow = (row: QueueItem) => {
    if (row.type === 'claim') navigate(`/staff/claims/${row.entityId}`);
    else if (row.type === 'renewal') navigate(`/staff/clients/${row.entityId}`);
    else if (row.type === 'guarantee') navigate('/staff/guarantees');
    else if (row.type === 'registry') navigate(`/staff/registries/${row.entityId}`);
    else if (row.type === 'policy_change') navigate(`/staff/policy-changes?clientId=${row.entityId}`);
    else navigate(`/staff/appointments?status=${done.has(row.id) ? 'confirmed' : 'requested'}`);
  };

  const columns: Column<QueueItem>[] = [
    { key: 'type', header: 'Тип', cell: (r) => <Chip kind={TYPE_CHIP[r.type].kind}>{TYPE_CHIP[r.type].label}</Chip>, className: 'w-[150px]' },
    { key: 'who', header: 'Кто', cell: (r) => <span className="font-medium">{r.who}</span> },
    { key: 'details', header: 'Детали', cell: (r) => <span className="text-muted">{r.details}</span> },
    { key: 'status', header: 'Статус', cell: (r) => <StatusDot tone={r.statusTone}>{r.status}</StatusDot> },
    {
      key: 'due',
      header: 'Срок',
      cell: (r) => {
        const d = daysUntil(r.dueAt);
        return (
          <span className={cn('whitespace-nowrap', d < 0 && 'font-medium text-danger-text')} title={formatDateTime(r.dueAt)}>
            {(r.type === 'appointment' || r.type === 'clinic_no_response') && d === 0 ? `сегодня, ${formatTime(r.dueAt)}` : formatRelativeDays(r.dueAt)}
          </span>
        );
      },
    },
    {
      key: 'action',
      header: '',
      align: 'right',
      cell: (r) => (
        <Button
          size="sm"
          variant={r.action === 'open' ? 'secondary' : 'primary'}
          loading={confirm.isPending && confirm.variables === r.entityId}
          onClick={(e) => {
            e.stopPropagation();
            void onAction(r);
          }}
        >
          {r.action === 'confirm' ? 'Подтвердить' : r.action === 'prepare_offer' ? 'Подготовить КП' : 'Открыть'}
        </Button>
      ),
    },
  ];

  const now = new Date();
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
      <div className="flex min-w-0 flex-col gap-4">
        <div>
          <h1 className="text-[22px] font-bold">
            {greeting(now)}, {dashboard.data?.firstName ?? user.displayName.split(' ')[0]}
          </h1>
          <p className="text-muted">
            {formatDate(now)} ·{' '}
            {dashboard.data ? `${dashboard.data.queueCount} ${plural(dashboard.data.queueCount, ['задача', 'задачи', 'задач'])} в очереди` : '…'}
          </p>
        </div>
        {dashboard.isError ? (
          <ErrorState error={dashboard.error} onRetry={() => void dashboard.refetch()} />
        ) : (
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {dashboard.data
              ? dashboard.data.kpis.map((k) => <KpiCard key={k.key} kpi={k} />)
              : Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-[86px] rounded-card" />)}
          </div>
        )}
        <Card title="Очередь" bodyClassName="p-0">
          <div role="tablist" aria-label="Тип задач" className="flex gap-1 border-b border-border-soft px-3 pt-2">
            {TABS.filter((t) => !('action' in t) || can(user, t.action) || (t.key === 'registry' && can(user, 'registries.pay'))).map((t) => (
              <button
                key={t.key}
                role="tab"
                type="button"
                aria-selected={tab === t.key}
                onClick={() => setTab(t.key)}
                className={cn(
                  '-mb-px border-b-2 border-transparent px-2.5 py-1.5 text-muted',
                  tab === t.key && 'border-accent font-semibold text-text',
                )}
              >
                {t.label}
              </button>
            ))}
          </div>
          <DataTable
            caption="Очередь задач"
            columns={columns}
            rows={queue.data ? (showAll ? rows : rows.slice(0, 15)) : undefined}
            rowKey={(r) => `${r.type}-${r.id}`}
            loading={queue.isLoading}
            error={queue.error}
            onRetry={() => void queue.refetch()}
            onRowClick={openRow}
            rowHeight={46}
            empty={<EmptyState title="Очередь пуста" description="Новые задачи появятся здесь автоматически" />}
            footer={
              rows.length > 15 ? (
                <Button variant="link" onClick={() => setShowAll((v) => !v)}>
                  {showAll ? 'Свернуть' : `Показать все (${rows.length})`}
                </Button>
              ) : undefined
            }
          />
        </Card>
      </div>
      <aside className="flex flex-col gap-4" aria-label="Сводка">
        <Card title="Требует внимания" bodyClassName="p-2">
          {dashboard.isLoading ? (
            <SkeletonRows rows={3} />
          ) : dashboard.data?.attention.length ? (
            <ul>
              {dashboard.data.attention.map((a) => (
                <li key={a.key}>
                  <Link to={a.to} className="flex items-center gap-2 rounded-btn px-2 py-2 hover:bg-rail">
                    <AlertTriangle className={cn('h-4 w-4', a.count ? 'text-warning' : 'text-muted')} aria-hidden />
                    <span className="flex-1">{a.label}</span>
                    <span className={cn('font-bold num', a.count ? 'text-warning-text' : 'text-muted')}>{a.count}</span>
                    <ChevronRight className="h-3.5 w-3.5 text-muted" aria-hidden />
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-2 py-3 text-muted">Всё под контролем</p>
          )}
        </Card>
        <IntegrationsCard />
        {showMedical && <MedicalAccessCard />}
      </aside>
    </div>
  );
}

function IntegrationsCard() {
  const q = useIntegrations();
  const tone = { ok: 'success', degraded: 'warning', down: 'danger' } as const;
  const label = { ok: 'Работает', degraded: 'С задержками', down: 'Недоступно' } as const;
  return (
    <Card title={<span className="flex items-center gap-1.5"><PlugZap className="h-4 w-4" aria-hidden /> Интеграции</span>} bodyClassName="p-2">
      {q.isLoading ? (
        <SkeletonRows rows={4} />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : (
        <ul>
          {q.data!.map((i) => (
            <li key={i.name} className="flex items-center justify-between gap-2 px-2 py-1.5">
              <StatusDot tone={tone[i.status]}>{i.name}</StatusDot>
              <span className="text-right text-[12px] text-muted">
                {label[i.status]} · {formatTime(i.lastSyncAt)}
                {i.queue > 0 && ` · в очереди ${i.queue}`}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function MedicalAccessCard() {
  const q = useMedicalAccessFeed(true);
  return (
    <Card title={<span className="flex items-center gap-1.5"><KeyRound className="h-4 w-4" aria-hidden /> Доступ к медданным</span>} bodyClassName="p-2">
      {q.isLoading ? (
        <SkeletonRows rows={3} />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : q.data!.length === 0 ? (
        <p className="px-2 py-3 text-muted">Обращений к данным не было</p>
      ) : (
        <ul className="flex flex-col">
          {q.data!.map((e) => (
            <li key={e.id} className="border-b border-border-soft px-2 py-1.5 last:border-0">
              <div className="flex justify-between gap-2">
                <span className="font-medium">{e.actorName}</span>
                <span className="text-[12px] text-muted">{formatDateTime(e.at)}</span>
              </div>
              <div className="text-[12px] text-muted">
                {AUDIT_ACTION_LABEL[e.action]} · {e.targetLabel}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
