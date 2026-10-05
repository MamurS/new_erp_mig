/* Guarantee letters queue (CLINIC_SPEC §5): doctor_expert approves / rejects / requests documents; four-eyes above the threshold. */
import { AiHint } from '@/features/ai/AiHint';
import { useState } from 'react';
import { Download } from 'lucide-react';
import type { GuaranteeStatus } from '@/shared/types';
import type { GuaranteeView } from '@/shared/types/dto';
import { useDecideGuarantee, useStaffGuarantees } from '@/shared/api/queries/clinic';
import { errorMessage } from '@/shared/api/client';
import { downloadFile } from '@/shared/api/files';
import { useUser } from '@/shared/auth/session';
import { can } from '@/shared/auth/permissions';
import { GUARANTEE_STATUS_CHIP, GUARANTEE_STATUS_LABEL, needsSecondApproval } from '@/shared/domain/clinics';
import { guaranteeDecisionSchema } from '@/shared/schemas/forms';
import { t, tm } from '@/i18n';
import { addDaysISO, formatDate, formatDateTime, formatMoney, todayISO } from '@/shared/lib/format';
import { useDocumentTitle, useUrlFilters } from '@/shared/lib/hooks';
import { Button } from '@/shared/ui/button';
import { Chip } from '@/shared/ui/chips';
import { legalFormColumn } from '@/shared/ui/legal-form';
import { DataTable, type Column } from '@/shared/ui/data-table';
import { Modal } from '@/shared/ui/dialog';
import { Field, Input, Textarea } from '@/shared/ui/input';
import { Kv } from '@/shared/ui/page';
import { EmptyState } from '@/shared/ui/states';
import { Tabs, TabsList, TabsTrigger } from '@/shared/ui/tabs';
import { toast } from '@/shared/ui/toast';
import { useTopbar } from '../topbar';
import { useDmsParam } from '@/shared/api/queries/params';

const TAB_KEYS = ['requested', 'info_requested', 'approved,used', 'rejected,expired', 'all'] as const;
const tabs = (): [string, string][] => [
  ['requested', t('staffOps.guarantees.tab.requested')],
  ['info_requested', t('staffOps.guarantees.tab.infoRequested')],
  ['approved,used', t('staffOps.guarantees.tab.approved')],
  ['rejected,expired', t('staffOps.guarantees.tab.rejected')],
  ['all', t('common.all')],
];

type Mode = 'approve' | 'reject' | 'request_info';

function DecisionDialog({ g, onClose }: { g: GuaranteeView; onClose: () => void }) {
  const user = useUser()!;
  const decide = useDecideGuarantee();
  const threshold = useDmsParam('guaranteeDualApprovalThreshold');
  const validityDays = useDmsParam('guaranteeValidityDays');
  // MIG decides escalations and letters of clients without an assistance (ASSISTANCE_SPEC §9.1).
  const canDecide = can(user, 'guarantees.decide') && can(user, 'assist.guarantees.decide', { assistanceId: g.assistanceId ?? null, escalated: g.escalated === true }) && g.status === 'requested';
  const firstApproval = g.approvals[0];
  const alreadyApprovedByMe = g.approvals.some((a) => a.byId === user.id);
  const [mode, setMode] = useState<Mode>('approve');
  const [amount, setAmount] = useState(String(g.approvedAmount ?? g.estimatedCost));
  const [validUntil, setValidUntil] = useState(g.validUntil ?? addDaysISO(todayISO(), validityDays));
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const amountNum = Number(amount.replace(/\s/g, ''));

  const submit = async () => {
    const raw = mode === 'approve' ? { action: mode, amount: amountNum, validUntil } : { action: mode, reason };
    const parsed = guaranteeDecisionSchema.safeParse(raw);
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])));
      return;
    }
    setErrors({});
    try {
      const res = await decide.mutateAsync({ id: g.id, body: parsed.data });
      toast.success(
        res.status === 'approved'
          ? t('staffOps.guarantees.toast.approved')
          : res.status === 'requested'
            ? t('staffOps.guarantees.toast.firstApproval')
            : res.status === 'rejected'
              ? t('staffOps.guarantees.toast.rejected')
              : t('staffOps.guarantees.toast.infoRequested'),
      );
      onClose();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <Modal
      open
      wide
      onOpenChange={(o) => !o && onClose()}
      title={t('staffOps.guarantees.dialogTitle', { number: g.number })}
      description={`${g.clinicName} · ${formatDateTime(g.createdAt)}`}
      footer={
        canDecide ? (
          <>
            <Button variant="secondary" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button loading={decide.isPending} disabled={mode === 'approve' && alreadyApprovedByMe} onClick={() => void submit()}>
              {mode === 'approve' ? t('common.approve') : mode === 'reject' ? t('common.reject') : t('staffOps.guarantees.requestDocs')}
            </Button>
          </>
        ) : (
          <Button variant="secondary" onClick={onClose}>
            {t('common.close')}
          </Button>
        )
      }
    >
      <div className="mb-3">
        <AiHint subject={{ type: 'guarantee', id: g.id }} />
      </div>
      <div className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
        <Kv label={t('common.patient')}>{g.insuredName}</Kv>
        <Kv label={t('common.status')}>
          <Chip kind={GUARANTEE_STATUS_CHIP[g.status]}>{GUARANTEE_STATUS_LABEL[g.status]}</Chip>
        </Kv>
        <Kv label={t('common.service')}>
          {g.serviceCode} · {g.serviceName}
        </Kv>
        <Kv label={t('staffOps.registry.col.icd')}>{g.icd10}</Kv>
        <Kv label={t('staffOps.guarantees.estimatedCost')}>
          <span className="num">{formatMoney(g.estimatedCost)}</span>
        </Kv>
        {g.approvedAmount !== undefined && (
          <Kv label={t('staffOps.guarantees.approvedAmount')}>
            <span className="num">{formatMoney(g.approvedAmount)}</span>
            {g.validUntil ? t('staffOps.guarantees.until', { date: formatDate(g.validUntil) }) : ''}
          </Kv>
        )}
      </div>
      <p className="mt-3 text-[13px]" data-testid="decision-owner">
        {t('staffOps.guarantees.decidedBy')} <span className="font-semibold">{g.assistanceId && !g.escalated ? g.assistanceName : t('common.mig')}</span>
        {g.escalated && g.assistanceName ? t('staffOps.guarantees.escalationFrom', { name: g.assistanceName }) : ''}
      </p>
      {g.escalated && g.assistanceOpinion && (
        <p className="mt-2 rounded-btn bg-warning-soft px-3 py-2 text-[13px] text-warning-text" data-testid="assistance-opinion">
          {t('staffOps.guarantees.assistanceOpinion', { text: g.assistanceOpinion })}
        </p>
      )}
      {g.comment && <p className="mt-3 rounded-btn bg-rail px-3 py-2 text-[13px]">{t('staffOps.guarantees.clinicComment', { text: g.comment })}</p>}
      {g.infoComment && <p className="mt-2 rounded-btn bg-rail px-3 py-2 text-[13px]">{t('staffOps.guarantees.clinicInfo', { text: g.infoComment })}</p>}
      {g.reason && <p className="mt-2 text-[13px] text-muted">{t('staffOps.guarantees.decisionReason', { text: g.reason })}</p>}
      {g.attachments.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-2">
          {g.attachments.map((a) => (
            <li key={a.id}>
              <Button size="sm" variant="secondary" onClick={() => void downloadFile(a.id, a.fileName).catch((e: unknown) => toast.error(errorMessage(e)))}>
                <Download className="h-3.5 w-3.5" aria-hidden /> {a.fileName}
              </Button>
            </li>
          ))}
        </ul>
      )}
      {firstApproval && g.status === 'requested' && (
        <p className="mt-3 rounded-btn bg-warning-soft px-3 py-2 text-[13px] text-warning-text" data-testid="four-eyes-note">
          {t('staffOps.guarantees.firstApprovalNote', { name: firstApproval.byName, date: formatDateTime(firstApproval.at), threshold: formatMoney(threshold) })}
          {alreadyApprovedByMe && t('staffOps.guarantees.alreadyApproved')}
        </p>
      )}
      {canDecide && (
        <div className="mt-4 flex flex-col gap-3 border-t border-border-soft pt-4">
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t('common.decision')}>
            {(
              [
                ['approve', t('common.approve')],
                ['reject', t('common.reject')],
                ['request_info', t('staffOps.guarantees.requestDocs')],
              ] as const
            ).map(([m, label]) => (
              <label key={m} className="flex items-center gap-1.5">
                <input type="radio" name="decision" checked={mode === m} onChange={() => setMode(m)} />
                {label}
              </label>
            ))}
          </div>
          {mode === 'approve' ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t('staffOps.guarantees.amountUzs')} error={tm(errors.amount) || undefined} hint={needsSecondApproval(amountNum, threshold) ? t('staffOps.guarantees.aboveThreshold') : undefined}>
                {(a) => <Input {...a} inputMode="numeric" maxLength={14} value={amount} onChange={(e) => setAmount(e.target.value)} />}
              </Field>
              <Field label={t('common.validUntil')} error={tm(errors.validUntil) || undefined}>
                {(a) => <Input {...a} type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />}
              </Field>
            </div>
          ) : (
            <Field label={mode === 'reject' ? t('staffOps.guarantees.denialReason') : t('staffOps.guarantees.whichDocs')} error={tm(errors.reason) || undefined}>
              {(a) => <Textarea {...a} rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />}
            </Field>
          )}
        </div>
      )}
    </Modal>
  );
}

export default function GuaranteesQueuePage() {
  useDocumentTitle(t('staffOps.guarantees.title'));
  const threshold = useDmsParam('guaranteeDualApprovalThreshold');
  useTopbar([{ label: t('staffOps.guarantees.title') }]);
  const [f, setF] = useUrlFilters(['status', 'clinicId', 'scope'] as const);
  const status = TAB_KEYS.some((k) => k === f.status) ? f.status : 'requested';
  const list = useStaffGuarantees({ ...(status === 'all' ? {} : { status }), ...(f.clinicId ? { clinicId: f.clinicId } : {}), ...(f.scope === 'all' ? { scope: 'all' } : {}) });
  const [open, setOpen] = useState<GuaranteeView | null>(null);
  const cols: Column<GuaranteeView>[] = [
    { key: 'num', header: t('common.number'), cell: (g) => <span className="num font-medium">{g.number}</span> },
    { key: 'created', header: t('common.created'), cell: (g) => <span className="num text-muted">{formatDateTime(g.createdAt)}</span> },
    { key: 'clinic', header: t('common.clinic'), cell: (g) => g.clinicName },
    legalFormColumn<GuaranteeView>((g) => g.clinicLegalForm),
    { key: 'patient', header: t('common.patient'), cell: (g) => g.insuredName },
    {
      key: 'owner',
      header: t('staffOps.guarantees.col.owner'),
      cell: (g) =>
        g.escalated ? (
          <Chip kind="warning">{t('staffOps.guarantees.escalation', { name: g.assistanceName ?? '' })}</Chip>
        ) : g.assistanceId ? (
          <span className="text-muted">{g.assistanceName}</span>
        ) : (
          <span>{t('common.mig')}</span>
        ),
    },
    { key: 'service', header: t('common.service'), cell: (g) => <span className="line-clamp-2">{g.serviceName}</span> },
    { key: 'cost', header: t('common.amount'), align: 'right', cell: (g) => <span className="num whitespace-nowrap">{formatMoney(g.approvedAmount ?? g.estimatedCost)}</span> },
    {
      key: 'status',
      header: t('common.status'),
      cell: (g: GuaranteeView) => (
        <span className="flex flex-wrap items-center gap-1">
          <Chip kind={GUARANTEE_STATUS_CHIP[g.status as GuaranteeStatus]}>{GUARANTEE_STATUS_LABEL[g.status]}</Chip>
          {g.status === 'requested' && g.approvals.length > 0 && <Chip kind="warning">{t('staffOps.guarantees.oneOfTwo')}</Chip>}
        </span>
      ),
    },
  ];
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-[22px] font-bold">{t('staffOps.guarantees.title')}</h1>
        <div className="flex flex-wrap items-center gap-3 text-[12px] text-muted">
          <span>{t('staffOps.guarantees.policyNote', { threshold: formatMoney(threshold) })}</span>
          <label className="flex items-center gap-1.5 text-text">
            <input type="checkbox" checked={f.scope === 'all'} onChange={(e) => setF({ scope: e.target.checked ? 'all' : null })} />
            {t('staffOps.guarantees.showAssistance')}
          </label>
        </div>
      </div>
      <Tabs value={status} onValueChange={(v) => setF({ status: v === 'requested' ? null : v })}>
        <TabsList>
          {tabs().map(([k, label]) => (
            <TabsTrigger key={k} value={k}>
              {label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <div className="mt-3 rounded-card border border-border bg-surface">
        <DataTable
          caption={t('staffOps.guarantees.title')}
          columns={cols}
          rows={list.data}
          rowKey={(g) => g.id}
          onRowClick={setOpen}
          loading={list.isLoading}
          error={list.error}
          onRetry={() => void list.refetch()}
          empty={<EmptyState title={t('staffOps.guarantees.empty')} />}
        />
      </div>
      {open && <DecisionDialog key={open.id} g={open} onClose={() => setOpen(null)} />}
    </div>
  );
}
