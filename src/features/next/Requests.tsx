/*
 * Requests between people on the dashboard (DECISIONS «Запросы между сотрудниками: полный цикл»):
 * - the executor's actions in a row of «Задачи от коллег»: «Взять в работу», «Открыть», «Отклонить» (with a
 *   comment), «Отметить выполненным» (with a comment) once it is taken;
 * - «Мои запросы» of the author: what, to whom, about which object, when, the deadline, the status and the
 *   executor's comment; overdue ones are red, «Напомнить» notifies the executor again.
 */
import { t, tKey } from '@/i18n';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { QueueItem, WorkTask } from '@/shared/types/dto';
import { errorMessage } from '@/shared/api/client';
import { useMyRequests, useRejectTask, useRemindTask, useTakeTask, useTaskDone } from '@/shared/api/queries/tasks';
import { formatDate, formatDateTime } from '@/shared/lib/format';
import { cn } from '@/shared/lib/cn';
import { taskDoneSchema, taskRejectSchema } from '@/shared/schemas/forms';
import { Button } from '@/shared/ui/button';
import { Chip } from '@/shared/ui/chips';
import { DataTable, type Column } from '@/shared/ui/data-table';
import { EmptyState } from '@/shared/ui/states';
import { toast } from '@/shared/ui/toast';
import { ReasonDialog } from '@/features/staff/lifecycle/common';
import { requestTo } from './NextActions';

const STATUS_CHIP = { open: 'neutral', in_progress: 'warning', done: 'success', rejected: 'danger' } as const;

export function RequestStatusChip({ task }: { task: Pick<WorkTask, 'status' | 'overdue'> }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <Chip kind={STATUS_CHIP[task.status]}>{tKey(`next.req.status.${task.status}`)}</Chip>
      {task.overdue && <Chip kind="danger">{t('next.req.overdueBadge')}</Chip>}
    </span>
  );
}

/** The executor's buttons in a `request` row of the queue. */
export function RequestRowActions({ row, onOpen }: { row: QueueItem; onOpen: () => void }) {
  const take = useTakeTask();
  const reject = useRejectTask();
  const done = useTaskDone();
  const [dialog, setDialog] = useState<'reject' | 'done' | null>(null);
  const r = row.request;
  if (!r) return null;
  const run = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      toast.success(ok);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  return (
    <div className="flex flex-wrap justify-end gap-1.5" role="group" aria-label={t('next.req.rowActions')} onClick={(e) => e.stopPropagation()}>
      {r.status === 'open' ? (
        <Button size="sm" loading={take.isPending} onClick={() => void run(() => take.mutateAsync(row.entityId), t('next.req.takenToast'))} data-testid="request-take">
          {t('next.req.take')}
        </Button>
      ) : (
        <Button size="sm" onClick={() => setDialog('done')} data-testid="request-done">
          {t('next.req.markDone')}
        </Button>
      )}
      <Button size="sm" variant="secondary" onClick={onOpen}>
        {t('common.open')}
      </Button>
      <Button size="sm" variant="secondary" onClick={() => setDialog('reject')} data-testid="request-reject">
        {t('next.req.reject')}
      </Button>
      <ReasonDialog
        open={dialog === 'reject'}
        onClose={() => setDialog(null)}
        title={t('next.req.rejectTitle')}
        description={t('next.req.rejectDesc')}
        label={t('next.req.rejectLabel')}
        field="comment"
        schema={taskRejectSchema}
        confirmLabel={t('next.req.reject')}
        danger
        onSubmit={(comment) => reject.mutateAsync({ id: row.entityId, comment }).then(() => toast.success(t('next.req.rejectedToast')))}
      />
      <ReasonDialog
        open={dialog === 'done'}
        onClose={() => setDialog(null)}
        title={t('next.req.doneTitle')}
        description={t('next.req.doneDesc')}
        label={t('next.req.doneLabel')}
        field="comment"
        schema={taskDoneSchema}
        confirmLabel={t('next.req.markDone')}
        onSubmit={(comment) => done.mutateAsync({ id: row.entityId, comment }).then(() => toast.success(t('next.req.doneToast')))}
      />
    </div>
  );
}

/** «Мои запросы»: the author's requests, the open ones first. */
export function MyRequests() {
  const navigate = useNavigate();
  const q = useMyRequests();
  const remind = useRemindTask();
  const rows = [...(q.data ?? [])].sort((a, b) => {
    const open = (x: WorkTask) => (x.status === 'open' || x.status === 'in_progress' ? 0 : 1);
    return open(a) - open(b) || (a.createdAt < b.createdAt ? 1 : -1);
  });
  const doRemind = async (id: string) => {
    try {
      await remind.mutateAsync(id);
      toast.success(t('next.req.reminded'));
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  const columns: Column<WorkTask>[] = [
    { key: 'what', header: t('next.req.colWhat'), cell: (r) => <span className="font-medium">{tKey(`next.action.${r.action}`)}</span> },
    { key: 'to', header: t('next.req.colTo'), cell: (r) => requestTo(r) },
    { key: 'subject', header: t('next.req.colSubject'), cell: (r) => <span className="text-muted">{r.subjectLabel}</span> },
    { key: 'asked', header: t('next.req.colAsked'), cell: (r) => <span className="num whitespace-nowrap">{formatDateTime(r.createdAt)}</span> },
    { key: 'due', header: t('next.req.colDue'), cell: (r) => <span className={cn('num whitespace-nowrap', r.overdue && 'font-semibold text-danger-text')}>{formatDate(r.dueDate)}</span> },
    { key: 'status', header: t('common.status'), cell: (r) => <span data-testid="my-request-status" data-status={r.status} data-overdue={r.overdue || undefined}><RequestStatusChip task={r} /></span> },
    { key: 'answer', header: t('next.req.colAnswer'), cell: (r) => <span className="text-muted">{r.resolution ?? '—'}</span> },
    {
      key: 'action',
      header: '',
      align: 'right',
      cell: (r) =>
        r.overdue ? (
          <Button
            size="sm"
            variant="secondary"
            loading={remind.isPending && remind.variables === r.id}
            data-testid="request-remind"
            onClick={(e) => {
              e.stopPropagation();
              void doRemind(r.id);
            }}
          >
            {t('next.req.remind')}
          </Button>
        ) : null,
    },
  ];
  return (
    <div data-testid="my-requests">
      <DataTable
        caption={t('next.req.caption')}
        columns={columns}
        rows={q.data ? rows : undefined}
        rowKey={(r) => r.id}
        loading={q.isLoading}
        error={q.error}
        onRetry={() => void q.refetch()}
        onRowClick={(r) => navigate(r.subjectLink)}
        rowHeight={46}
        empty={<EmptyState title={t('next.req.empty')} description={t('next.req.emptyHint')} />}
      />
    </div>
  );
}
