/* Queue of insured-list changes (POLICY_SPEC §5.2): underwriters approve or reject HR requests. */
import { defineLabels, t, tm } from '@/i18n';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, MoreHorizontal, X } from 'lucide-react';
import type { PolicyChange } from '@/shared/types';
import { useDecidePolicyChanges, usePolicyChanges } from '@/shared/api/queries/policies';
import { errorMessage } from '@/shared/api/client';
import { useCan } from '@/shared/auth/guards';
import { POLICY_CHANGE_KIND_LABEL, POLICY_CHANGE_STATUS_LABEL } from '@/shared/domain/policies';
import { policyChangeDecisionSchema } from '@/shared/schemas/forms';
import { formatDate, formatDateTime, formatMoney } from '@/shared/lib/format';
import { useDocumentTitle, useUrlFilters } from '@/shared/lib/hooks';
import { Button } from '@/shared/ui/button';
import { Checkbox } from '@/shared/ui/checkbox';
import { Menu, MenuContent, MenuItem, MenuTrigger } from '@/shared/ui/dropdown';
import { Chip } from '@/shared/ui/chips';
import { DataTable, type Column } from '@/shared/ui/data-table';
import { Modal } from '@/shared/ui/dialog';
import { Field, Textarea } from '@/shared/ui/input';
import { EmptyState } from '@/shared/ui/states';
import { Tabs, TabsList, TabsTrigger } from '@/shared/ui/tabs';
import { toast } from '@/shared/ui/toast';
import { useTopbar } from '../topbar';

const TABS = ['pending', 'approved', 'rejected'] as const;
const TAB_LABEL = defineLabels('staffLc.changes.tab', TABS);
const STATUS_CHIP = { pending: 'sun', approved: 'success', rejected: 'danger' } as const;

function Delta({ value }: { value: number }) {
  if (!value) return <span className="text-muted">—</span>;
  return <span className={value > 0 ? 'num whitespace-nowrap text-success-text' : 'num whitespace-nowrap text-danger-text'}>{`${value > 0 ? '+' : '−'}${formatMoney(Math.abs(value))}`}</span>;
}

function RejectDialog({ ids, onClose, onDone }: { ids: string[]; onClose: () => void; onDone: () => void }) {
  const decide = useDecidePolicyChanges();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string>();
  const send = async () => {
    const parsed = policyChangeDecisionSchema.safeParse({ ids, decision: 'reject', reason });
    if (!parsed.success) {
      setError(tm(parsed.error.issues[0]?.message) || undefined);
      return;
    }
    try {
      await decide.mutateAsync(parsed.data);
      toast.success(t('staffLc.changes.rejectedToast', { n: ids.length }));
      onDone();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title={ids.length === 1 ? t('staffLc.changes.rejectOne') : t('staffLc.changes.rejectMany', { n: ids.length })}
      description={t('staffLc.changes.rejectDesc')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="danger" loading={decide.isPending} onClick={() => void send()}>
            {t('common.reject')}
          </Button>
        </>
      }
    >
      <Field label={t('common.reason')} error={error}>
        {(a) => <Textarea {...a} rows={3} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />}
      </Field>
    </Modal>
  );
}

export default function PolicyChangesPage() {
  useDocumentTitle(t('staffLc.changes.title'));
  useTopbar([{ label: t('staffLc.changes.title') }]);
  const canDecide = useCan('policy_changes.decide');
  const [f, setF] = useUrlFilters(['status', 'clientId'] as const);
  const status = TABS.some((k) => k === f.status) ? f.status : 'pending';
  const list = usePolicyChanges({ status, ...(f.clientId ? { clientId: f.clientId } : {}) });
  const decide = useDecidePolicyChanges();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [rejecting, setRejecting] = useState<string[] | null>(null);
  const rows = list.data;
  const pendingIds = useMemo(() => (rows ?? []).filter((r) => r.status === 'pending').map((r) => r.id), [rows]);
  const chosen = pendingIds.filter((id) => selected.has(id));
  const clientName = f.clientId ? rows?.[0]?.clientName : undefined;
  const total = (rows ?? []).filter((r) => chosen.includes(r.id)).reduce((s, r) => s + r.premiumDelta, 0);

  const toggle = (id: string, on: boolean) =>
    setSelected((s) => {
      const next = new Set(s);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const approve = async (ids: string[]) => {
    try {
      const r = await decide.mutateAsync({ ids, decision: 'approve' });
      toast.success(t('staffLc.changes.approvedToast', { n: r.approved, endorsements: r.endorsements }));
      setSelected(new Set());
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const columns: Column<PolicyChange>[] = [
    ...(canDecide && status === 'pending'
      ? [
          {
            key: 'select',
            header: '',
            className: 'w-10',
            cell: (r: PolicyChange) => <Checkbox aria-label={t('staffLc.changes.selectAria', { name: r.fullName })} checked={selected.has(r.id)} onCheckedChange={(v) => toggle(r.id, v)} />,
          } satisfies Column<PolicyChange>,
        ]
      : []),
    {
      key: 'client',
      header: t('staffLc.changes.clientPolicy'),
      cell: (r) => (
        <span className="flex flex-col">
          <Link to={`/staff/clients/${r.clientId}`} className="font-medium hover:underline">
            {r.clientName}
          </Link>
          <Link to={`/staff/policies/${r.policyId}`} className="num text-[12px] text-muted hover:underline">
            {r.policyNumber}
          </Link>
        </span>
      ),
    },
    { key: 'kind', header: t('common.type'), cell: (r) => <Chip kind={r.kind === 'add' ? 'sky' : 'peach'}>{POLICY_CHANGE_KIND_LABEL[r.kind]}</Chip> },
    {
      key: 'who',
      header: t('common.employee'),
      cell: (r) => (
        <span className="flex flex-col">
          <span className="font-medium">{r.fullName}</span>
          <span className="text-[12px] text-muted">
            {r.position}
            {r.familyMembers ? t('staffLc.changes.family', { n: r.familyMembers }) : ''}
          </span>
        </span>
      ),
    },
    { key: 'date', header: t('common.from'), cell: (r) => <span className="num">{formatDate(r.effectiveDate)}</span> },
    { key: 'delta', header: t('staffLc.changes.delta'), align: 'right', cell: (r) => <Delta value={r.premiumDelta} /> },
    {
      key: 'requested',
      header: t('staffLc.changes.request'),
      cell: (r) => (
        <span className="flex flex-col text-[12px]">
          <span>{r.requestedByName}</span>
          <span className="num text-muted">{formatDateTime(r.requestedAt)}</span>
        </span>
      ),
    },
    {
      key: 'status',
      header: t('common.status'),
      cell: (r) => (
        <span className="flex flex-col gap-0.5">
          <Chip kind={STATUS_CHIP[r.status]}>{POLICY_CHANGE_STATUS_LABEL[r.status]}</Chip>
          {r.decidedByName && <span className="text-[12px] text-muted">{r.decidedByName}</span>}
          {r.rejectionReason && <span className="text-[12px] text-muted">{r.rejectionReason}</span>}
        </span>
      ),
    },
    ...(canDecide && status === 'pending'
      ? [
          {
            key: 'actions',
            header: '',
            align: 'right' as const,
            cell: (r: PolicyChange) => (
              <Menu>
                <MenuTrigger asChild>
                  <Button size="icon" variant="ghost" aria-label={t('staffLc.changes.actionsAria', { name: r.fullName })}>
                    <MoreHorizontal className="h-4 w-4" aria-hidden />
                  </Button>
                </MenuTrigger>
                <MenuContent>
                  <MenuItem onSelect={() => void approve([r.id])}>
                    <Check className="h-4 w-4" aria-hidden /> {t('common.confirm')}
                  </MenuItem>
                  <MenuItem danger onSelect={() => setRejecting([r.id])}>
                    <X className="h-4 w-4" aria-hidden /> {t('staffLc.changes.rejectEllipsis')}
                  </MenuItem>
                </MenuContent>
              </Menu>
            ),
          } satisfies Column<PolicyChange>,
        ]
      : []),
  ];

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-[22px] font-bold">{t('staffLc.changes.title')}</h1>
          <p className="text-[12px] text-muted">
            {t('staffLc.changes.subtitle')}
          </p>
        </div>
        {f.clientId && (
          <Button variant="secondary" size="sm" onClick={() => setF({ clientId: null })}>
            {clientName ? t('staffLc.changes.showAllNamed', { name: clientName }) : t('staffLc.changes.showAll')}
          </Button>
        )}
      </div>
      <Tabs
        value={status}
        onValueChange={(v) => {
          setSelected(new Set());
          setF({ status: v === 'pending' ? null : v });
        }}
      >
        <TabsList>
          {TABS.map((k) => (
            <TabsTrigger key={k} value={k}>
              {TAB_LABEL[k]}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      {canDecide && status === 'pending' && pendingIds.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-card border border-border bg-surface px-4 py-2" data-testid="bulk-bar">
          <label className="flex items-center gap-2">
            <Checkbox aria-label={t('staffLc.changes.selectAllAria')} checked={chosen.length === pendingIds.length} onCheckedChange={(v) => setSelected(v ? new Set(pendingIds) : new Set())} />
            {t('staffLc.changes.selectAll')}
          </label>
          {chosen.length > 0 && (
            <>
              <span className="font-medium">{t('staffLc.changes.selected', { n: chosen.length })}</span>
              <span className="text-muted">{t('staffLc.changes.totalLower')}</span>
              <Delta value={total} />
              <span className="flex-1" />
              <Button size="sm" loading={decide.isPending} onClick={() => void approve(chosen)}>
                {t('staffLc.changes.approveSelected')}
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setRejecting(chosen)}>
                {t('staffLc.changes.rejectEllipsis')}
              </Button>
            </>
          )}
        </div>
      )}
      <div className="mt-3 rounded-card border border-border bg-surface">
        <DataTable
          caption={t('staffLc.changes.caption')}
          columns={columns}
          rows={rows}
          rowKey={(r) => r.id}
          loading={list.isLoading}
          error={list.error}
          onRetry={() => void list.refetch()}
          empty={<EmptyState title={status === 'pending' ? t('staffLc.changes.emptyPending') : t('staffLc.endorsements.requestsEmpty')} />}
        />
      </div>
      {rejecting && (
        <RejectDialog
          ids={rejecting}
          onClose={() => setRejecting(null)}
          onDone={() => {
            setRejecting(null);
            setSelected(new Set());
          }}
        />
      )}
    </div>
  );
}
