import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { LimitChangeRequest } from '@/shared/types';
import { useDecideLimit, useLimitRequests } from '@/shared/api/queries/staff';
import { errorMessage } from '@/shared/api/client';
import { useUser } from '@/shared/auth/session';
import { can } from '@/shared/auth/permissions';
import { canDecideLimitRequest, FOUR_EYES_LIMIT_HINT } from '@/shared/domain/limits';
import { LIMIT_CATEGORY_LABEL } from '@/shared/domain/labels';
import { formatDate, formatMoney } from '@/shared/lib/format';
import { useDocumentTitle, useUrlFilters } from '@/shared/lib/hooks';
import { cn } from '@/shared/lib/cn';
import { Button } from '@/shared/ui/button';
import { StatusDot } from '@/shared/ui/chips';
import { ConfirmDialog } from '@/shared/ui/confirm-dialog';
import { DataTable, type Column } from '@/shared/ui/data-table';
import { Field, Textarea } from '@/shared/ui/input';
import { EmptyState } from '@/shared/ui/states';
import { toast } from '@/shared/ui/toast';
import { Tooltip } from '@/shared/ui/tooltip';
import { useTopbar } from '../topbar';

const STATUS = {
  pending: { tone: 'warning', label: 'Ожидает решения' },
  approved: { tone: 'success', label: 'Подтверждён' },
  rejected: { tone: 'danger', label: 'Отклонён' },
} as const;

export default function LimitRequestsPage() {
  useDocumentTitle('Изменения лимитов');
  useTopbar([{ label: 'Запросы на изменение лимитов' }]);
  const user = useUser()!;
  const [f, setF] = useUrlFilters(['status'] as const);
  const list = useLimitRequests({ status: f.status });
  const decide = useDecideLimit();
  const [rejecting, setRejecting] = useState<LimitChangeRequest | null>(null);
  const [comment, setComment] = useState('');
  const isApprover = can(user, 'limits.approve_change');

  const approve = async (r: LimitChangeRequest) => {
    try {
      await decide.mutateAsync({ id: r.id, decision: 'approve' });
      toast.success('Изменение лимита подтверждено');
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const cols: Column<LimitChangeRequest>[] = [
    { key: 'date', header: 'Создан', cell: (r) => formatDate(r.createdAt) },
    { key: 'policy', header: 'Полис', cell: (r) => <Link to={`/staff/policies/${r.policyId}`} className="num text-accent-text hover:underline" onClick={(e) => e.stopPropagation()}>{r.policyNumber}</Link> },
    { key: 'scope', header: 'Для кого', cell: (r) => (r.insuredId ? 'Застрахованный' : 'Весь полис') },
    { key: 'cat', header: 'Категория', cell: (r) => LIMIT_CATEGORY_LABEL[r.category] },
    { key: 'change', header: 'Изменение', align: 'right', cell: (r) => <span className="num whitespace-nowrap">{formatMoney(r.from, false)} → <b>{formatMoney(r.to)}</b></span> },
    { key: 'why', header: 'Обоснование', cell: (r) => <span className="line-clamp-2 text-muted">{r.justification}</span> },
    { key: 'by', header: 'Автор', cell: (r) => (r.requestedById === user.id ? <b>Вы</b> : r.requestedByName) },
    { key: 'status', header: 'Статус', cell: (r) => <StatusDot tone={STATUS[r.status].tone}>{STATUS[r.status].label}{r.decidedByName ? ` · ${r.decidedByName}` : ''}</StatusDot> },
    {
      key: 'actions',
      header: '',
      align: 'right',
      cell: (r) => {
        if (!isApprover || r.status !== 'pending') return null;
        const allowed = canDecideLimitRequest(user, r);
        const buttons = (
          <span className="flex justify-end gap-1.5">
            <Button size="sm" disabled={!allowed} loading={decide.isPending && decide.variables?.id === r.id} onClick={() => void approve(r)}>
              Подтвердить
            </Button>
            <Button size="sm" variant="secondary" disabled={!allowed} onClick={() => setRejecting(r)}>
              Отклонить
            </Button>
          </span>
        );
        return allowed ? buttons : (
          <Tooltip content={FOUR_EYES_LIMIT_HINT}>
            <span tabIndex={0} aria-label={FOUR_EYES_LIMIT_HINT} data-testid="four-eyes-hint">
              {buttons}
            </span>
          </Tooltip>
        );
      },
    },
  ];

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-[22px] font-bold">Запросы на изменение лимитов</h1>
          <p className="text-muted">
            {user.role === 'operator' ? 'Ваши запросы. Решение принимает андеррайтер.' : 'Решение по запросу принимает сотрудник, который его не создавал.'}
          </p>
        </div>
      </div>
      <div role="tablist" aria-label="Статус" className="mb-3 flex gap-1">
        {[
          { key: '', label: 'Все' },
          { key: 'pending', label: 'Ожидают решения' },
          { key: 'approved', label: 'Подтверждённые' },
          { key: 'rejected', label: 'Отклонённые' },
        ].map((t) => (
          <button key={t.key} role="tab" type="button" aria-selected={f.status === t.key} onClick={() => setF({ status: t.key })} className={cn('rounded-btn px-2.5 py-1', f.status === t.key ? 'bg-text text-white' : 'text-muted hover:bg-rail')}>
            {t.label}
          </button>
        ))}
      </div>
      <div className="rounded-card border border-border bg-surface">
        <DataTable
          caption="Запросы на изменение лимитов"
          columns={cols}
          rows={list.data}
          rowKey={(r) => r.id}
          loading={list.isLoading}
          error={list.error}
          onRetry={() => void list.refetch()}
          rowHeight={52}
          empty={<EmptyState title="Запросов нет" description="Запросить изменение лимита можно из карточки застрахованного или полиса" />}
        />
      </div>
      <ConfirmDialog
        open={!!rejecting}
        onOpenChange={(o) => {
          if (!o) {
            setRejecting(null);
            setComment('');
          }
        }}
        title="Отклонить запрос"
        description="Лимит останется прежним. Автор запроса увидит ваш комментарий."
        confirmLabel="Отклонить"
        danger
        loading={decide.isPending}
        disabled={comment.trim().length < 3}
        onConfirm={async () => {
          if (!rejecting) return;
          try {
            await decide.mutateAsync({ id: rejecting.id, decision: 'reject', comment: comment.trim() });
            toast.success('Запрос отклонён');
            setRejecting(null);
            setComment('');
          } catch (e) {
            toast.error(errorMessage(e));
          }
        }}
      >
        <Field label="Комментарий" hint="Минимум 3 символа">
          {(a) => <Textarea {...a} value={comment} maxLength={500} onChange={(e) => setComment(e.target.value)} />}
        </Field>
      </ConfirmDialog>
    </div>
  );
}
