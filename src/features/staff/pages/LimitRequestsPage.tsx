import { t, tm } from '@/i18n';
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
  pending: { tone: 'warning', label: 'staff.limitReq.status.pending' },
  approved: { tone: 'success', label: 'staff.limitReq.status.approved' },
  rejected: { tone: 'danger', label: 'staff.limitReq.status.rejected' },
} as const;

export default function LimitRequestsPage() {
  useDocumentTitle(t('staff.limitReq.docTitle'));
  useTopbar([{ label: t('staff.limitReq.title') }]);
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
      toast.success(t('staff.limitReq.approved'));
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const cols: Column<LimitChangeRequest>[] = [
    { key: 'date', header: t('staff.claimCard.created'), cell: (r) => formatDate(r.createdAt) },
    { key: 'policy', header: t('common.policy'), cell: (r) => <Link to={`/staff/policies/${r.policyId}`} className="num text-accent-text hover:underline" onClick={(e) => e.stopPropagation()}>{r.policyNumber}</Link> },
    { key: 'scope', header: t('staff.limitReq.colScope'), cell: (r) => (r.insuredId ? t('common.insured') : t('staff.limitReq.wholePolicy')) },
    { key: 'cat', header: t('common.category'), cell: (r) => LIMIT_CATEGORY_LABEL[r.category] },
    { key: 'change', header: t('staff.limitReq.colChange'), align: 'right', cell: (r) => <span className="num whitespace-nowrap">{formatMoney(r.from, false)} → <b>{formatMoney(r.to)}</b></span> },
    { key: 'why', header: t('staff.limitReq.colJustification'), cell: (r) => <span className="line-clamp-2 text-muted">{r.justification}</span> },
    { key: 'by', header: t('staff.docs.colAuthor'), cell: (r) => (r.requestedById === user.id ? <b>{t('staff.limitReq.you')}</b> : r.requestedByName) },
    { key: 'status', header: t('common.status'), cell: (r) => <StatusDot tone={STATUS[r.status].tone}>{t(STATUS[r.status].label)}{r.decidedByName ? ` · ${r.decidedByName}` : ''}</StatusDot> },
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
              {t('common.confirm')}
            </Button>
            <Button size="sm" variant="secondary" disabled={!allowed} onClick={() => setRejecting(r)}>
              {t('common.reject')}
            </Button>
          </span>
        );
        return allowed ? buttons : (
          <Tooltip content={tm(FOUR_EYES_LIMIT_HINT)}>
            <span tabIndex={0} aria-label={tm(FOUR_EYES_LIMIT_HINT)} data-testid="four-eyes-hint">
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
          <h1 className="text-[22px] font-bold">{t('staff.limitReq.title')}</h1>
          <p className="text-muted">
            {user.role === 'operator' ? t('staff.limitReq.operatorHint') : t('staff.limitReq.approverHint')}
          </p>
        </div>
      </div>
      <div role="tablist" aria-label={t('common.status')} className="mb-3 flex gap-1">
        {[
          { key: '', label: t('common.all') },
          { key: 'pending', label: t('staff.limitReq.tab.pending') },
          { key: 'approved', label: t('staff.limitReq.tab.approved') },
          { key: 'rejected', label: t('staff.limitReq.tab.rejected') },
        ].map((st) => (
          <button key={st.key} role="tab" type="button" aria-selected={f.status === st.key} onClick={() => setF({ status: st.key })} className={cn('rounded-btn px-2.5 py-1', f.status === st.key ? 'bg-text text-white' : 'text-muted hover:bg-rail')}>
            {st.label}
          </button>
        ))}
      </div>
      <div className="rounded-card border border-border bg-surface">
        <DataTable
          caption={t('staff.limitReq.title')}
          columns={cols}
          rows={list.data}
          rowKey={(r) => r.id}
          loading={list.isLoading}
          error={list.error}
          onRetry={() => void list.refetch()}
          rowHeight={52}
          empty={<EmptyState title={t('staff.limitReq.empty')} description={t('staff.limitReq.emptyHint')} />}
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
        title={t('staff.limitReq.rejectTitle')}
        description={t('staff.limitReq.rejectText')}
        confirmLabel={t('common.reject')}
        danger
        loading={decide.isPending}
        disabled={comment.trim().length < 3}
        onConfirm={async () => {
          if (!rejecting) return;
          try {
            await decide.mutateAsync({ id: rejecting.id, decision: 'reject', comment: comment.trim() });
            toast.success(t('staff.limitReq.rejected'));
            setRejecting(null);
            setComment('');
          } catch (e) {
            toast.error(errorMessage(e));
          }
        }}
      >
        <Field label={t('common.comment')} hint={t('staff.limitReq.commentHint')}>
          {(a) => <Textarea {...a} value={comment} maxLength={500} onChange={(e) => setComment(e.target.value)} />}
        </Field>
      </ConfirmDialog>
    </div>
  );
}
