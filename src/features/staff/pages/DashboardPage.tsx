import { t, tm, tp } from '@/i18n';
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AlertTriangle, ChevronRight, KeyRound, PlugZap } from 'lucide-react';
import type { QueueItem, QueueType } from '@/shared/types/dto';
import { useConfirmAppointment, useDashboard, useIntegrations, useMedicalAccessFeed, useQueue } from '@/shared/api/queries/staff';
import { errorMessage } from '@/shared/api/client';
import { useUser } from '@/shared/auth/session';
import { AUDIT_ACTION_LABEL } from '@/shared/domain/labels';
import { daysUntil, formatDate, formatDateTime, formatRelativeDays, formatTime } from '@/shared/lib/format';
import { useDocumentTitle, useUrlFilters } from '@/shared/lib/hooks';
import { cn } from '@/shared/lib/cn';
import { Button } from '@/shared/ui/button';
import { Chip, StatusDot } from '@/shared/ui/chips';
import { DataTable, formatSort, parseSort, type Column } from '@/shared/ui/data-table';
import { formatLegalForms, legalFormColumn, parseLegalForms } from '@/shared/ui/legal-form';
import { Card } from '@/shared/ui/page';
import { EmptyState, ErrorState, Skeleton, SkeletonRows } from '@/shared/ui/states';
import { toast } from '@/shared/ui/toast';
import { KpiCard } from '../components/KpiCard';
import { kpNewPath } from '@/features/kp/paths';
import { canSeeQueueType, QUEUE_TYPE_META } from '@/shared/domain/queue';
import { useTopbar } from '../topbar';

/** Where a queue row leads. */
function queueRowPath(row: QueueItem, confirmed: boolean): string {
  const id = row.entityId;
  switch (row.type) {
    case 'claim':
    case 'appeal':
    case 'fraud_flag':
    case 'opinion':
      return `/staff/claims/${id}`;
    case 'payout':
      return row.subject === 'registry' ? `/staff/registries/${id}` : `/staff/claims/${id}`;
    case 'renewal':
      return `/staff/clients/${id}`;
    case 'loss_ratio':
      return `/staff/clients/${id}/loss`;
    case 'guarantee':
    case 'escalation':
      return '/staff/guarantees';
    case 'rebill':
      return `/staff/rebills/${id}`;
    case 'assistance_sla':
    case 'complaint':
      return `/staff/assistance/${id}`;
    case 'registry':
      return `/staff/registries/${id}`;
    case 'policy_change':
      return `/staff/policy-changes?clientId=${id}`;
    case 'deal':
    case 'lead':
    case 'kp':
      return `/staff/deals/${id}`;
    case 'quote':
      return `/staff/quotes/${id}`;
    case 'contract':
      return `/staff/contracts/${id}`;
    case 'endorsement':
      return `/staff/endorsements/${id}`;
    case 'scan':
      return row.subject === 'endorsement' ? `/staff/endorsements/${id}` : `/staff/contracts/${id}`;
    case 'invoice':
      return '/staff/invoices?status=unpaid,overdue';
    case 'bank_payment':
      return '/staff/invoices/queue';
    case 'limit_request':
      return '/staff/limit-requests?status=pending';
    case 'qa_sample':
      return '/staff/qa';
    case 'param_change':
      return '/staff/admin/parameters';
    case 'authority_change':
      return '/staff/admin/users';
    case 'ai_change':
      return '/staff/admin/ai';
    case 'integration_error':
      return `/staff/clinics/${id}`;
    case 'appointment':
    case 'clinic_no_response':
      return `/staff/appointments?status=${confirmed ? 'confirmed' : 'requested'}`;
  }
}

function greeting(now = new Date()): string {
  const h = Number(new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hourCycle: 'h23', timeZone: 'Asia/Tashkent' }).format(now));
  if (h < 12) return t('staff.dashboard.morning');
  if (h < 18) return t('staff.dashboard.afternoon');
  return t('staff.dashboard.evening');
}

export default function DashboardPage() {
  useDocumentTitle(t('staff.dashboard.title'));
  useTopbar([{ label: t('staff.dashboard.title') }]);
  const user = useUser()!;
  const navigate = useNavigate();
  const dashboard = useDashboard();
  const [tab, setTab] = useState<QueueType | 'all'>('all');
  const [f, setF] = useUrlFilters(['form', 'sort'] as const);
  const forms = parseLegalForms(f.form);
  const sort = parseSort(f.sort);
  const queue = useQueue(tab, {
    ...(forms.length ? { form: forms.join(',') } : {}),
    ...(sort ? { sort: `${sort.key}:${sort.dir}` } : {}),
  });
  const confirm = useConfirmAppointment();
  const [done, setDone] = useState<Map<string, QueueItem>>(new Map());
  const [showAll, setShowAll] = useState(false);
  const showMedical = user.role === 'admin' || user.role === 'doctor_expert';

  // Confirmed rows stay visible with the new status instead of disappearing (update in place).
  const rows = useMemo(() => {
    const base = (queue.data ?? []).map((r) => done.get(r.id) ?? r);
    for (const r of done.values()) {
      if (!base.some((b) => b.id === r.id) && (tab === 'all' || tab === r.type)) base.push(r);
    }
    // The server sorts when a column sort is chosen; by default the queue goes by deadline.
    return f.sort ? base : base.sort((a, b) => (a.dueAt < b.dueAt ? -1 : 1));
  }, [queue.data, done, tab, f.sort]);

  const onAction = async (row: QueueItem) => {
    if (row.action === 'confirm') {
      try {
        await confirm.mutateAsync(row.entityId);
        setDone((m) => new Map(m).set(row.id, { ...row, status: t('staff.dashboard.confirmedStatus'), statusTone: 'success', action: 'open' }));
        toast.success(t('staff.dashboard.confirmed'));
      } catch (e) {
        toast.error(errorMessage(e));
      }
    } else if (row.action === 'prepare_offer') {
      navigate(kpNewPath(row.entityId, row.policyId));
    } else {
      openRow(row);
    }
  };

  const openRow = (row: QueueItem) => navigate(queueRowPath(row, done.has(row.id)));

  const columns: Column<QueueItem>[] = [
    { key: 'type', header: t('common.type'), cell: (r) => <Chip kind={QUEUE_TYPE_META[r.type].chip}>{QUEUE_TYPE_META[r.type].label}</Chip>, className: 'w-[150px]' },
    { key: 'who', header: t('staff.dashboard.colWho'), sortKey: 'who', cell: (r) => <span className="font-medium">{r.who}</span> },
    legalFormColumn<QueueItem>((r) => r.legalForm, { selected: forms, onChange: (v) => setF({ form: formatLegalForms(v) }) }),
    { key: 'details', header: t('staff.dashboard.colDetails'), cell: (r) => <span className="text-muted">{tm(r.details)}</span> },
    { key: 'status', header: t('common.status'), cell: (r) => <StatusDot tone={r.statusTone}>{tm(r.status)}</StatusDot> },
    {
      key: 'due',
      header: t('staff.dashboard.colDue'),
      sortKey: 'dueAt',
      cell: (r) => {
        const d = daysUntil(r.dueAt);
        return (
          <span className={cn('whitespace-nowrap', d < 0 && 'font-medium text-danger-text')} title={formatDateTime(r.dueAt)}>
            {(r.type === 'appointment' || r.type === 'clinic_no_response') && d === 0 ? t('staff.dashboard.todayAt', { time: formatTime(r.dueAt) }) : formatRelativeDays(r.dueAt)}
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
          {r.action === 'confirm' ? t('common.confirm') : r.action === 'prepare_offer' ? t('staff.dashboard.prepareOffer') : t('common.open')}
        </Button>
      ),
    },
  ];

  // Tabs are the kinds of work in this role's queue (the server already filtered them by rights).
  const queueTabs: { key: QueueType | 'all'; label: string; count?: number }[] = [
    { key: 'all', label: t('common.all') },
    ...(dashboard.data?.queueTypes ?? []).filter((q) => canSeeQueueType(user, q.type)).map((q) => ({ key: q.type, label: QUEUE_TYPE_META[q.type].tab, count: q.count })),
  ];

  const now = new Date();
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
      <div className="flex min-w-0 flex-col gap-4">
        <div>
          <h1 className="text-[22px] font-bold">
            {t('staff.dashboard.greeting', { greeting: greeting(now), name: dashboard.data?.firstName ?? user.displayName.split(' ')[0] ?? '' })}
          </h1>
          <p className="text-muted">
            {formatDate(now)} ·{' '}
            {dashboard.data ? tp('staff.dashboard.queueCount', dashboard.data.queueCount) : '…'}
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
        <Card title={t('staff.dashboard.queue')} bodyClassName="p-0">
          <div role="tablist" aria-label={t('staff.dashboard.queueTabs')} className="flex gap-1 overflow-x-auto border-b border-border-soft px-3 pt-2" data-testid="queue-tabs">
            {queueTabs.map((qt) => (
              <button
                key={qt.key}
                role="tab"
                type="button"
                aria-selected={tab === qt.key}
                onClick={() => setTab(qt.key)}
                className={cn('-mb-px whitespace-nowrap border-b-2 border-transparent px-2.5 py-1.5 text-muted', tab === qt.key && 'border-accent font-semibold text-text')}
              >
                {qt.label}
                {qt.count !== undefined && <span className="ml-1 text-[11px] text-muted num">{qt.count}</span>}
              </button>
            ))}
          </div>
          <DataTable
            caption={t('staff.dashboard.queueCaption')}
            columns={columns}
            rows={queue.data ? (showAll ? rows : rows.slice(0, 15)) : undefined}
            sort={sort}
            onSortChange={(s) => setF({ sort: formatSort(s) })}
            rowKey={(r) => `${r.type}-${r.id}`}
            loading={queue.isLoading}
            error={queue.error}
            onRetry={() => void queue.refetch()}
            onRowClick={openRow}
            rowHeight={46}
            empty={<EmptyState title={t('staff.dashboard.queueEmpty')} description={t('staff.dashboard.queueEmptyHint')} />}
            footer={
              rows.length > 15 ? (
                <Button variant="link" onClick={() => setShowAll((v) => !v)}>
                  {showAll ? t('staff.dashboard.collapse') : t('staff.dashboard.showAll', { n: rows.length })}
                </Button>
              ) : undefined
            }
          />
        </Card>
      </div>
      <aside className="flex flex-col gap-4" aria-label={t('staff.dashboard.summary')}>
        <Card title={t('staff.dashboard.attention')} bodyClassName="p-2">
          {dashboard.isLoading ? (
            <SkeletonRows rows={3} />
          ) : dashboard.data?.attention.length ? (
            <ul>
              {dashboard.data.attention.map((a) => (
                <li key={a.key}>
                  <Link to={a.to} className="flex items-center gap-2 rounded-btn px-2 py-2 hover:bg-rail">
                    <AlertTriangle className={cn('h-4 w-4', a.count ? 'text-warning' : 'text-muted')} aria-hidden />
                    <span className="flex-1">{tm(a.label)}</span>
                    <span className={cn('font-bold num', a.count ? 'text-warning-text' : 'text-muted')}>{a.count}</span>
                    <ChevronRight className="h-3.5 w-3.5 text-muted" aria-hidden />
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-2 py-3 text-muted">{t('staff.dashboard.allGood')}</p>
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
  const label = { ok: t('staff.dashboard.intOk'), degraded: t('staff.dashboard.intDegraded'), down: t('staff.dashboard.intDown') };
  return (
    <Card title={<span className="flex items-center gap-1.5"><PlugZap className="h-4 w-4" aria-hidden /> {t('staff.dashboard.integrations')}</span>} bodyClassName="p-2">
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
                {i.queue > 0 && t('staff.dashboard.intQueued', { n: i.queue })}
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
    <Card title={<span className="flex items-center gap-1.5"><KeyRound className="h-4 w-4" aria-hidden /> {t('staff.dashboard.medicalAccess')}</span>} bodyClassName="p-2">
      {q.isLoading ? (
        <SkeletonRows rows={3} />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : q.data!.length === 0 ? (
        <p className="px-2 py-3 text-muted">{t('staff.dashboard.medicalNone')}</p>
      ) : (
        <ul className="flex flex-col">
          {q.data!.map((e) => (
            <li key={e.id} className="border-b border-border-soft px-2 py-1.5 last:border-0">
              <div className="flex justify-between gap-2">
                <span className="font-medium">{e.actorName}</span>
                <span className="text-[12px] text-muted">{formatDateTime(e.at)}</span>
              </div>
              <div className="text-[12px] text-muted">
                {AUDIT_ACTION_LABEL[e.action]} · {tm(e.targetLabel)}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
