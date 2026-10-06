/*
 * Requests of employees from the app «Моя семья → Добавить» (FAMILY_SPEC): HR approves (→ a change request for
 * MIG, then an endorsement) or rejects with a reason the employee sees in the app.
 */
import { useState } from 'react';
import { Check, X } from 'lucide-react';
import type { FamilyRequest } from '@/shared/types/dto';
import { useDecideFamilyRequest, useHrFamilyRequests } from '@/shared/api/queries/hr';
import { errorMessage } from '@/shared/api/client';
import { familyRequestDecisionSchema } from '@/shared/schemas/forms';
import { RELATION_LABEL } from '@/shared/domain/family';
import { addDaysISO, formatDate, formatDateTime, todayISO } from '@/shared/lib/format';
import { useDocumentTitle, useUrlFilters } from '@/shared/lib/hooks';
import { cn } from '@/shared/lib/cn';
import { Button } from '@/shared/ui/button';
import { Chip } from '@/shared/ui/chips';
import { ConfirmDialog } from '@/shared/ui/confirm-dialog';
import { Field, Textarea } from '@/shared/ui/input';
import { MaskedInput } from '@/shared/ui/masked-input';
import { Breadcrumbs } from '@/shared/ui/page';
import { EmptyState, ErrorState, SkeletonRows } from '@/shared/ui/states';
import { toast } from '@/shared/ui/toast';
import { HR_BTN, HrCard, HrHeader } from '../ui';
import { FAMILY_REQUEST_TABS, requestsOf, type FamilyRequestTab } from '../family/familyList';
import { defineLabels, t, tm, tp } from '@/i18n';

const TAB_LABEL = defineLabels('hr.familyReq.tab', FAMILY_REQUEST_TABS);

export default function FamilyRequestsPage() {
  useDocumentTitle(t('hr.nav.familyRequests'));
  const all = useHrFamilyRequests();
  const [filters, setFilters] = useUrlFilters(['status'] as const);
  const tab: FamilyRequestTab = (FAMILY_REQUEST_TABS as readonly string[]).includes(filters.status) ? (filters.status as FamilyRequestTab) : 'pending';
  const [deciding, setDeciding] = useState<{ request: FamilyRequest; decision: 'approve' | 'reject' } | null>(null);
  const rows = requestsOf(all.data ?? [], tab);

  return (
    <>
      <Breadcrumbs items={[{ label: t('hr.nav.family'), to: '/hr/family' }, { label: t('hr.nav.familyRequests') }]} />
      <HrHeader title={t('hr.familyReq.title')} subtitle={t('hr.familyReq.subtitle')} className="mt-3" />
      <div className="mb-4 flex flex-wrap gap-2" role="group" aria-label={t('common.status')}>
        {FAMILY_REQUEST_TABS.map((s) => {
          const n = requestsOf(all.data ?? [], s).length;
          return (
            <button
              key={s}
              type="button"
              aria-pressed={tab === s}
              onClick={() => setFilters({ status: s === 'pending' ? null : s })}
              className={cn(
                'h-11 rounded-full border px-4 text-[14px] font-semibold transition-colors',
                tab === s ? 'border-accent bg-accent-soft text-accent-text' : 'border-border text-text hover:bg-rail',
              )}
            >
              {TAB_LABEL[s]} <span className="num text-muted">{n}</span>
            </button>
          );
        })}
      </div>

      {all.isLoading ? (
        <SkeletonRows rows={4} />
      ) : all.isError ? (
        <ErrorState className="rounded-card border border-border bg-surface" error={all.error} onRetry={() => void all.refetch()} />
      ) : rows.length === 0 ? (
        <HrCard>
          <EmptyState title={t(tab === 'pending' ? 'hr.familyReq.emptyPending' : 'hr.familyReq.empty')} description={t('hr.familyReq.emptyHint')} />
        </HrCard>
      ) : (
        <ul className="flex flex-col gap-3" data-testid="family-requests">
          {rows.map((r) => (
            <li key={r.id}>
              <HrCard className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="font-heading text-[18px] font-semibold">{r.fullName}</p>
                  <p className="text-muted">
                    {RELATION_LABEL[r.relation]}
                    {r.isStudent ? ` · ${t('hr.family.student')}` : ''} · {tp('hr.familyReq.age', r.age)} · <span className="num">{r.birthDateMasked}</span>
                  </p>
                  <p className="mt-1 text-[14px]">{t('hr.familyReq.from', { name: r.employeeName, date: formatDateTime(r.createdAt) })}</p>
                  <p className="text-[13px] text-muted">{t('hr.familyReq.consent', { date: formatDateTime(r.consentAt) })}</p>
                  {r.status === 'approved' && (
                    <p className="mt-1 text-[14px] text-success-text">{t('hr.familyReq.approvedText', { name: r.decidedByName ?? '—' })}</p>
                  )}
                  {r.status === 'rejected' && r.rejectionReason && (
                    <p className="mt-1 text-[14px] text-danger-text" data-testid="family-request-reason">
                      {t('hr.employees.reason', { reason: r.rejectionReason })}
                    </p>
                  )}
                </div>
                {r.status === 'pending' ? (
                  <div className="flex flex-wrap gap-2">
                    <Button className={HR_BTN} onClick={() => setDeciding({ request: r, decision: 'approve' })} aria-label={t('hr.familyReq.approveFor', { name: r.fullName })}>
                      <Check className="h-4 w-4" aria-hidden />
                      {t('hr.familyReq.approve')}
                    </Button>
                    <Button variant="secondary" className={HR_BTN} onClick={() => setDeciding({ request: r, decision: 'reject' })} aria-label={t('hr.familyReq.rejectFor', { name: r.fullName })}>
                      <X className="h-4 w-4" aria-hidden />
                      {t('hr.familyReq.reject')}
                    </Button>
                  </div>
                ) : (
                  <Chip kind={r.status === 'approved' ? 'success' : 'danger'}>{TAB_LABEL[r.status]}</Chip>
                )}
              </HrCard>
            </li>
          ))}
        </ul>
      )}

      {deciding && <DecisionDialog request={deciding.request} decision={deciding.decision} onClose={() => setDeciding(null)} />}
    </>
  );
}

function DecisionDialog({ request, decision, onClose }: { request: FamilyRequest; decision: 'approve' | 'reject'; onClose: () => void }) {
  const decide = useDecideFamilyRequest();
  const [startDate, setStartDate] = useState(() => formatDate(addDaysISO(todayISO(), 1)));
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | undefined>();
  const approve = decision === 'approve';

  const submit = () => {
    const parsed = familyRequestDecisionSchema.safeParse(approve ? { decision, startDate } : { decision, reason });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message);
      return;
    }
    setError(undefined);
    decide.mutate(
      { id: request.id, ...parsed.data },
      {
        onSuccess: () => {
          toast.success(t(approve ? 'hr.familyReq.approved' : 'hr.familyReq.rejected'));
          onClose();
        },
        onError: (e) => setError(errorMessage(e)),
      },
    );
  };

  return (
    <ConfirmDialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title={t(approve ? 'hr.familyReq.approveTitle' : 'hr.familyReq.rejectTitle')}
      description={t(approve ? 'hr.familyReq.approveText' : 'hr.familyReq.rejectText', { name: request.fullName, employee: request.employeeName })}
      confirmLabel={t(approve ? 'hr.familyReq.approve' : 'hr.familyReq.reject')}
      danger={!approve}
      loading={decide.isPending}
      onConfirm={submit}
    >
      {approve ? (
        <Field label={t('hr.add.startDate')} error={tm(error) || undefined}>
          {(f) => <MaskedInput mask="date" {...f} value={startDate} onChange={setStartDate} className="h-12" />}
        </Field>
      ) : (
        <Field label={t('hr.familyReq.reason')} error={tm(error) || undefined}>
          {(f) => <Textarea {...f} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} />}
        </Field>
      )}
    </ConfirmDialog>
  );
}
