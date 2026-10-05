import { t } from '@/i18n';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { InsuredListItem } from '@/shared/types/dto';
import type { LimitCategory, PolicyChange } from '@/shared/types';
import { usePolicyChanges } from '@/shared/api/queries/policies';
import { POLICY_CHANGE_KIND_LABEL, POLICY_CHANGE_STATUS_LABEL } from '@/shared/domain/policies';
import { useClientInsured, usePolicy } from '@/shared/api/queries/staff';
import { useCan } from '@/shared/auth/guards';
import { useUser } from '@/shared/auth/session';
import { LIMIT_CATEGORY_LABEL, POLICY_STATUS_LABEL, PROGRAM_LABEL } from '@/shared/domain/labels';
import { formatDate, formatMoney, formatNumber } from '@/shared/lib/format';
import { useDocumentTitle } from '@/shared/lib/hooks';
import { Button } from '@/shared/ui/button';
import { StatusDot } from '@/shared/ui/chips';
import { DataTable, type Column } from '@/shared/ui/data-table';
import { LegalFormChip } from '@/shared/ui/legal-form';
import { Card, Kv } from '@/shared/ui/page';
import { ErrorState, SkeletonRows } from '@/shared/ui/states';
import { kpNewPath } from '@/features/kp/paths';
import { LimitRequestDialog } from '../components/LimitRequestDialog';
import { RenewalCell } from '../components/cells';
import { POLICY_TONE } from '../components/tones';
import { INSURED_CARD_ROLES } from '../nav';
import { useTopbar } from '../topbar';
import { DocumentsList } from '../components/DocumentsList';
import { AssistanceBlock } from '../assistance/AssistanceBlock';

export default function PolicyCardPage() {
  const { policyId = '' } = useParams();
  const q = usePolicy(policyId);
  const p = q.data;
  useDocumentTitle(t('staff.policyCard.docTitle'));
  useTopbar([{ label: t('staff.policies.title'), to: '/staff/policies' }, { label: p?.number ?? t('common.policy') }]);
  const canOffer = useCan('kp.create');
  const navigate = useNavigate();
  const canLimit = useCan('limits.request_change');
  const canInsured = useCan('insured.read');
  const canChanges = useCan('policy_changes.read');
  const [limit, setLimit] = useState(false);
  if (q.isLoading) return <SkeletonRows rows={10} />;
  if (q.isError || !p) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-bold num">{p.number}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-muted">
            <Link to={`/staff/clients/${p.clientId}`} className="hover:underline">
              {p.clientName}
            </Link>
            <LegalFormChip code={p.clientLegalForm} />
            · <StatusDot tone={POLICY_TONE[p.status]}>{POLICY_STATUS_LABEL[p.status]}</StatusDot>
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canLimit && p.status === 'active' && (
            <Button variant="secondary" onClick={() => setLimit(true)}>
              {t('staff.limitDialog.title')}
            </Button>
          )}
          {canOffer && p.status !== 'cancelled' && <Button onClick={() => navigate(kpNewPath(p.clientId, p.id))}>{t('staff.dashboard.prepareOffer')}</Button>}
        </div>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title={t('staff.policyCard.terms')}>
          <dl className="divide-y divide-border-soft">
            <Kv label={t('common.program')}>{PROGRAM_LABEL[p.program]}</Kv>
            <Kv label={t('common.start')}>{formatDate(p.startDate)}</Kv>
            <Kv label={t('common.end')}>
              {formatDate(p.endDate)} {p.status === 'active' && <>(<RenewalCell date={p.endDate} />)</>}
            </Kv>
            <Kv label={t('common.premium')}>
              <span className="num">{formatMoney(p.premium)}</span>
            </Kv>
            <Kv label={t('staff.clients.col.insured')}>{formatNumber(p.insuredCount)}</Kv>
            {p.familyCount ? <Kv label={t('staff.insuredCard.familyCount')}>{formatNumber(p.familyCount)}</Kv> : null}
            {p.tariff && (
              <Kv label={t('staff.policyCard.ratesPerYear')}>
                <span className="num">
                  {formatMoney(p.tariff.employee)} / {formatMoney(p.tariff.family)}
                </span>
              </Kv>
            )}
          </dl>
        </Card>
        <Card title={t('staff.policyCard.programLimits', { name: p.programInfo.name })}>
          <dl className="divide-y divide-border-soft">
            {(Object.keys(p.programInfo.limits) as LimitCategory[]).map((c) => (
              <Kv key={c} label={LIMIT_CATEGORY_LABEL[c]}>
                <span className="num">{formatMoney(p.programInfo.limits[c])}</span>
              </Kv>
            ))}
          </dl>
          <p className="mt-2 text-[12px] text-muted">{t('staff.policyCard.limitsNote')}</p>
        </Card>
      </div>
      <AssistanceBlock policyId={p.id} />
      {canChanges && <PolicyChangesBlock policyId={p.id} clientId={p.clientId} />}
      {canInsured && <PolicyInsured clientId={p.clientId} />}
      <Card title={t('common.documents')} bodyClassName="p-0">
        <DocumentsList docs={p.documents} />
      </Card>
      <LimitRequestDialog open={limit} onOpenChange={setLimit} policyId={p.id} currentLimits={p.programInfo.limits} />
    </div>
  );
}

function PolicyChangesBlock({ policyId, clientId }: { policyId: string; clientId: string }) {
  const q = usePolicyChanges({ policyId });
  const rows = (q.data ?? []).slice(0, 5);
  const pending = (q.data ?? []).filter((c) => c.status === 'pending').length;
  const cols: Column<PolicyChange>[] = [
    { key: 'kind', header: t('common.type'), cell: (c) => POLICY_CHANGE_KIND_LABEL[c.kind] },
    { key: 'who', header: t('common.employee'), cell: (c) => <span className="font-medium">{c.fullName}</span> },
    { key: 'date', header: t('common.from'), cell: (c) => <span className="num">{formatDate(c.effectiveDate)}</span> },
    { key: 'delta', header: t('staff.policyCard.delta'), align: 'right', cell: (c) => <span className="num">{c.premiumDelta ? `${c.premiumDelta > 0 ? '+' : '−'}${formatMoney(Math.abs(c.premiumDelta))}` : '—'}</span> },
    { key: 'status', header: t('common.status'), cell: (c) => <StatusDot tone={c.status === 'approved' ? 'success' : c.status === 'rejected' ? 'danger' : 'warning'}>{POLICY_CHANGE_STATUS_LABEL[c.status]}</StatusDot> },
  ];
  return (
    <Card
      title={pending ? t('staff.policyCard.changesPending', { n: pending }) : t('staff.policyCard.changes')}
      actions={
        <Link to={`/staff/policy-changes?clientId=${clientId}`} className="text-[13px] text-accent-text hover:underline">
          {t('staff.policyCard.allClientRequests')}
        </Link>
      }
      bodyClassName="p-0"
    >
      <DataTable caption={t('staff.policyCard.changesCaption')} columns={cols} rows={rows} rowKey={(c) => c.id} loading={q.isLoading} error={q.error} onRetry={() => void q.refetch()} empty={<p className="p-4 text-muted">{t('staff.policyCard.noChanges')}</p>} />
    </Card>
  );
}

function PolicyInsured({ clientId }: { clientId: string }) {
  const [page, setPage] = useState(1);
  const list = useClientInsured(clientId, { page, pageSize: 25 });
  const user = useUser();
  const navigate = useNavigate();
  const canOpen = !!user && (INSURED_CARD_ROLES as string[]).includes(user.role);
  const cols: Column<InsuredListItem>[] = [
    { key: 'name', header: t('common.fullName'), cell: (i) => <span className="font-medium">{i.fullName}</span> },
    { key: 'position', header: t('common.position'), cell: (i) => <span className="text-muted">{i.position}</span> },
    { key: 'status', header: t('common.status'), cell: (i) => <StatusDot tone={i.status === 'active' ? 'success' : 'muted'}>{i.status === 'active' ? t('staff.clientCard.insuredActive') : t('staff.clientCard.insuredExcluded')}</StatusDot> },
  ];
  return (
    <Card title={t('staff.clientCard.tab.insured')} bodyClassName="p-0">
      <DataTable
        caption={t('staff.policyCard.insuredCaption')}
        columns={cols}
        rows={list.data?.items}
        rowKey={(i) => i.id}
        loading={list.isLoading}
        error={list.error}
        onRetry={() => void list.refetch()}
        onRowClick={canOpen ? (i) => navigate(`/staff/insured/${i.id}`) : undefined}
        page={page}
        pageSize={25}
        total={list.data?.total}
        onPageChange={setPage}
      />
    </Card>
  );
}
