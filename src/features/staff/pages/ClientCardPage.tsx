import { t, tm } from '@/i18n';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis } from 'recharts';
import { Mail, FilePlus2 } from 'lucide-react';
import type { InsuredListItem } from '@/shared/types/dto';
import type { Policy } from '@/shared/types';
import { useClient, useClientHistory, useClientInsured, usePolicies } from '@/shared/api/queries/staff';
import { useCan } from '@/shared/auth/guards';
import { useUser } from '@/shared/auth/session';
import { AUDIT_ACTION_LABEL, CLIENT_STATUS_LABEL, POLICY_STATUS_LABEL, PROGRAM_LABEL } from '@/shared/domain/labels';
import { formatDate, formatDateTime, formatMoney, formatMoneyShort, formatNumber, formatPercent } from '@/shared/lib/format';
import { useDebounced, useDocumentTitle, useUrlFilters } from '@/shared/lib/hooks';
import { Button } from '@/shared/ui/button';
import { Avatar, Chip, StatusDot } from '@/shared/ui/chips';
import { DataTable, type Column } from '@/shared/ui/data-table';
import { Card } from '@/shared/ui/page';
import { SearchInput } from '@/shared/ui/search-input';
import { EmptyState, ErrorState, QueryState, SkeletonRows } from '@/shared/ui/states';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/ui/tabs';
import { CLIENT_TONE, POLICY_TONE } from '../components/tones';
import { MiniKpi } from '../components/KpiCard';
import { kpNewPath } from '@/features/kp/paths';
import { RenewalCell } from '../components/cells';
import { monthShort } from '../components/months';
import { INSURED_CARD_ROLES } from '../nav';
import { useTopbar } from '../topbar';
import { ClientDocumentsTable } from '../components/ClientDocumentsTable';
import { HrLetterDialog } from '../components/HrLetterDialog';
import { AssistanceBlock } from '../assistance/AssistanceBlock';
import { useDmsParam } from '@/shared/api/queries/params';

const TAB_KEYS = ['tab', 'highlight'] as const;
const TABS = ['overview', 'insured', 'policies', 'claims', 'documents', 'history'];


export default function ClientCardPage() {
  const { clientId = '' } = useParams();
  const q = useClient(clientId);
  const lossWarn = useDmsParam('lossRatioWarn');
  const c = q.data;
  useDocumentTitle(t('staff.clientCard.docTitle'));
  useTopbar([{ label: t('staff.clients.title'), to: '/staff/clients' }, { label: c?.name ?? t('common.client') }]);
  const canOffer = useCan('kp.create');
  const canIssue = useCan('policies.write');
  const canPolicies = useCan('policies.read');
  const canInsured = useCan('insured.read');
  const navigate = useNavigate();
  const [{ tab, highlight }, setF] = useUrlFilters(TAB_KEYS);
  const [letterOpen, setLetterOpen] = useState(false);
  const visibleTabs = TABS.filter((k) => (k !== 'insured' || canInsured) && (k !== 'policies' || canPolicies));

  if (q.isLoading) return <SkeletonRows rows={10} />;
  if (q.isError || !c) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <Avatar name={c.name} square className="h-11 w-11 text-[14px]" />
          <div>
            <h1 className="text-[22px] font-bold leading-tight">
              {t('staff.clientCard.heading', { form: c.legalForm, name: c.name })}
            </h1>
            <p className="flex flex-wrap items-center gap-2 text-muted">
              {t('staff.clientCard.inn')}
              <span className="num">{c.inn}</span> · <StatusDot tone={CLIENT_TONE[c.status]}>{CLIENT_STATUS_LABEL[c.status]}</StatusDot>
              {t('staff.clientCard.manager', { name: c.managerName })}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => setLetterOpen(true)}>
            <Mail className="h-3.5 w-3.5" aria-hidden /> {t('staff.hrLetter.title')}
          </Button>
          {canIssue && (!c.activePolicyId || c.status === 'expired') && (
            <Button variant="secondary" onClick={() => navigate(`/staff/clients/${c.id}/policies/new`)}>
              <FilePlus2 className="h-3.5 w-3.5" aria-hidden /> {t('staff.clientCard.issuePolicy')}
            </Button>
          )}
          {canOffer && <Button onClick={() => navigate(kpNewPath(c.id, c.activePolicyId))}>{t('staff.dashboard.prepareOffer')}</Button>}
        </div>
      </div>
      <Tabs value={visibleTabs.includes(tab) ? tab : 'overview'} onValueChange={(v) => setF({ tab: v === 'overview' ? null : v, highlight: null })}>
        <TabsList>
          <TabsTrigger value="overview">{t('staff.clientCard.tab.overview')}</TabsTrigger>
          {canInsured && <TabsTrigger value="insured">{t('staff.clientCard.tab.insured')}</TabsTrigger>}
          {canPolicies && <TabsTrigger value="policies">{t('staff.clientCard.tab.policies')}</TabsTrigger>}
          <TabsTrigger value="claims">{t('staff.clientCard.tab.claims')}</TabsTrigger>
          <TabsTrigger value="documents">{t('common.documents')}</TabsTrigger>
          <TabsTrigger value="history">{t('staff.clientCard.tab.history')}</TabsTrigger>
        </TabsList>
        <TabsContent value="overview">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <MiniKpi label={t('staff.clients.col.insured')} value={formatNumber(c.insuredCount)} />
            <MiniKpi label={t('common.premium')} value={c.premium ? formatMoneyShort(c.premium) : '—'} />
            <MiniKpi label={t('staff.clients.col.loss')} value={c.lossRatio === null ? '—' : formatPercent(c.lossRatio)} tone={(c.lossRatio ?? 0) >= lossWarn ? 'warning' : 'default'} />
            <div className="rounded-btn bg-rail px-3 py-2">
              <div className="text-[12px] text-muted">{t('staff.clients.col.renewal')}</div>
              <div className="font-bold">
                <RenewalCell date={c.renewalDate} />
              </div>
            </div>
          </div>
          {c.activePolicyId && (
            <div className="mt-4">
              <AssistanceBlock policyId={c.activePolicyId} />
            </div>
          )}
          <Card title={t('staff.clientCard.claimsByMonth')} className="mt-4">
            <div className="h-64" role="img" aria-label={t('staff.clientCard.chartAria')}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={c.claimsByMonth.map((m) => ({ ...m, label: monthShort(m.month) }))}>
                  <CartesianGrid vertical={false} stroke="#eceef1" />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={12} />
                  <YAxis tickFormatter={(v: number) => formatMoneyShort(v).replace(`\u00a0${t('fmt.currency')}`, '')} tickLine={false} axisLine={false} fontSize={12} width={70} />
                  <RTooltip formatter={(v: number) => formatMoney(v)} labelFormatter={(l: string) => t('staff.clientCard.monthTooltip', { month: l })} />
                  <Bar dataKey="amount" name={t('common.amount')} fill="#4f46e5" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </TabsContent>
        {canInsured && (
          <TabsContent value="insured">
            <InsuredTab clientId={c.id} />
          </TabsContent>
        )}
        {canPolicies && (
          <TabsContent value="policies">
            <PoliciesTab clientId={c.id} />
          </TabsContent>
        )}
        <TabsContent value="claims">
          <Card title={t('staff.clientCard.claimsByCategory')} bodyClassName="p-0">
            <p className="px-4 pt-3 text-[12px] text-muted">{t('staff.clientCard.aggregatesOnly')}</p>
            {c.claimsByCategory.length === 0 ? (
              <EmptyState title={t('staff.clientCard.noClaims')} />
            ) : (
              <table className="mt-2 w-full">
                <caption className="sr-only">{t('staff.clientCard.claimsByCategory')}</caption>
                <thead>
                  <tr className="border-b border-border text-left text-[12px] text-muted">
                    <th className="px-4 py-2 font-normal">{t('common.category')}</th>
                    <th className="px-4 py-2 text-right font-normal">{t('staff.clientCard.count')}</th>
                    <th className="px-4 py-2 text-right font-normal">{t('common.amount')}</th>
                  </tr>
                </thead>
                <tbody>
                  {c.claimsByCategory.map((r) => (
                    <tr key={r.category} className="h-11 border-b border-border-soft">
                      <td className="px-4">{tm(r.category)}</td>
                      <td className="px-4 text-right num">{formatNumber(r.count)}</td>
                      <td className="px-4 text-right num">{formatMoney(r.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </TabsContent>
        <TabsContent value="documents">
          <ClientDocumentsTable clientId={c.id} highlightId={highlight || undefined} />
        </TabsContent>
        <TabsContent value="history">
          <HistoryTab clientId={c.id} />
        </TabsContent>
      </Tabs>
      <HrLetterDialog open={letterOpen} onOpenChange={setLetterOpen} clientId={c.id} clientName={c.name} />
    </div>
  );
}

function InsuredTab({ clientId }: { clientId: string }) {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const q = useDebounced(search.trim());
  const list = useClientInsured(clientId, { page, pageSize: 25, q });
  const user = useUser();
  const navigate = useNavigate();
  const canOpen = !!user && (INSURED_CARD_ROLES as string[]).includes(user.role);
  const cols: Column<InsuredListItem>[] = [
    { key: 'name', header: t('common.fullName'), cell: (i) => <span className="font-medium">{i.fullName}</span> },
    { key: 'position', header: t('common.position'), cell: (i) => <span className="text-muted">{i.position}</span> },
    { key: 'pinfl', header: t('staff.clientCard.colPinfl'), cell: (i) => <span className="num text-muted">{i.pinflMasked ?? '—'}</span> },
    { key: 'app', header: t('staff.clientCard.colApp'), cell: (i) => <Chip kind={i.appStatus === 'active' ? 'success' : 'neutral'}>{i.appStatus === 'active' ? t('staff.clientCard.app.active') : i.appStatus === 'invited' ? t('staff.clientCard.app.invited') : t('staff.clientCard.app.none')}</Chip> },
    { key: 'status', header: t('common.status'), cell: (i) => <StatusDot tone={i.status === 'active' ? 'success' : 'muted'}>{i.status === 'active' ? t('staff.clientCard.insuredActive') : t('staff.clientCard.insuredExcluded')}</StatusDot> },
  ];
  return (
    <Card bodyClassName="p-0">
      <div className="p-3">
        <SearchInput value={search} onChange={(v) => { setSearch(v); setPage(1); }} placeholder={t('staff.clientCard.searchName')} className="w-72" />
      </div>
      <DataTable
        caption={t('staff.clientCard.insuredCaption')}
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

function PoliciesTab({ clientId }: { clientId: string }) {
  const list = usePolicies({ clientId, pageSize: 50 });
  const navigate = useNavigate();
  const cols: Column<Policy>[] = [
    { key: 'number', header: t('common.number'), cell: (p) => <span className="num font-medium">{p.number}</span> },
    { key: 'program', header: t('common.program'), cell: (p) => PROGRAM_LABEL[p.program] },
    { key: 'term', header: t('staff.clientCard.colTerm'), cell: (p) => `${formatDate(p.startDate)} – ${formatDate(p.endDate)}` },
    { key: 'premium', header: t('common.premium'), align: 'right', cell: (p) => <span className="num">{formatMoney(p.premium)}</span> },
    { key: 'status', header: t('common.status'), cell: (p) => <StatusDot tone={POLICY_TONE[p.status]}>{POLICY_STATUS_LABEL[p.status]}</StatusDot> },
  ];
  return (
    <Card bodyClassName="p-0">
      <DataTable
        caption={t('staff.clientCard.policiesCaption')}
        columns={cols}
        rows={list.data?.items}
        rowKey={(p) => p.id}
        loading={list.isLoading}
        error={list.error}
        onRetry={() => void list.refetch()}
        onRowClick={(p) => navigate(`/staff/policies/${p.id}`)}
        empty={<EmptyState title={t('staff.clientCard.noPolicies')} description={t('staff.clientCard.noPoliciesHint')} />}
      />
    </Card>
  );
}

function HistoryTab({ clientId }: { clientId: string }) {
  const q = useClientHistory(clientId);
  return (
    <Card bodyClassName="p-0">
      <QueryState query={q}>
        {(list) =>
          list.length === 0 ? (
            <EmptyState title={t('staff.clientCard.noEvents')} />
          ) : (
            <ul className="divide-y divide-border-soft">
              {list.map((e) => (
                <li key={e.id} className="flex flex-wrap items-center gap-2 px-4 py-2.5">
                  <span className="w-36 text-[12px] text-muted">{formatDateTime(e.at)}</span>
                  <span className="font-medium">{AUDIT_ACTION_LABEL[e.action]}</span>
                  <span className="text-muted">{tm(e.targetLabel)}</span>
                  <span className="ml-auto text-[12px] text-muted">{e.actorName}</span>
                </li>
              ))}
            </ul>
          )
        }
      </QueryState>
    </Card>
  );
}
