import { useUser } from '@/shared/auth/session';
/* Card of an assistance company for MIG (ASSISTANCE_SPEC §7): KPI, contract, clients, users, integration, rebills, QA, audit. */
import { InvitationStatus, ResendInvitation } from '@/features/auth/InvitationStatus';
import { canOpenRoute } from '@/features/help/routeMap';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { AssistanceCardView } from '@mig/contracts/dto';
import type { AssistanceCase, FeeModel } from '@mig/contracts';
import { useAssistanceCard, useAssistanceCases, useResolveComplaint, useRevokeAssistKey, useUpdateContract } from '@/shared/api/queries/assist';
import { errorMessage } from '@/shared/api/client';
import { useCan } from '@/shared/auth/guards';
import { CASE_TYPE_LABEL, FEE_MODEL_LABEL } from '@mig/domain/assistance';
import { AUDIT_ACTION_LABEL, ROLE_LABEL } from '@mig/domain/labels';
import { INTEGRATION_MODE_LABEL, SCOPE_LABEL } from '@mig/domain/clinics';
import { assistanceContractSchema, complaintResolutionSchema } from '@mig/contracts/forms';
import { getLocale, t, tm } from '@/i18n';
import { formatDate, formatDateTime, formatMoney, formatNumber } from '@mig/domain/lib/format';
import { useDocumentTitle, useUrlFilters } from '@/shared/lib/hooks';
import { Button } from '@/shared/ui/button';
import { Chip } from '@/shared/ui/chips';
import { ConfirmDialog } from '@/shared/ui/confirm-dialog';
import { LegalFormChip, legalFormColumn } from '@/shared/ui/legal-form';
import { DataTable } from '@/shared/ui/data-table';
import { Field, Input, Select, Textarea } from '@/shared/ui/input';
import { Modal } from '@/shared/ui/dialog';
import { Card, Kv } from '@/shared/ui/page';
import { EmptyState, QueryState } from '@/shared/ui/states';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/ui/tabs';
import { toast } from '@/shared/ui/toast';
import { CaseStatus, KpiGrid, RebillStatus, SlaBadge, Stat } from '@/features/assist/components';
import { QaVerdict } from './QaPage';
import { HelpMore, roleName } from '@/features/next/NextActions';
import { useTopbar } from '../topbar';
import { useDmsParam } from '@/shared/api/queries/params';

const TAB_KEYS = ['overview', 'contract', 'clients', 'cases', 'users', 'integration', 'rebills', 'qa', 'audit'] as const;
const tabLabel = (k: (typeof TAB_KEYS)[number]): string =>
  ({
    overview: t('staffOps.assistCard.tab.overview'),
    contract: t('common.contract'),
    clients: t('staffOps.assistCard.tab.clients'),
    cases: t('staffOps.assistCard.tab.cases'),
    users: t('staffOps.clinicCard.tab.users'),
    integration: t('staffOps.clinicCard.tab.integration'),
    rebills: t('staffOps.assistCard.tab.rebills'),
    qa: t('staffOps.qa.title'),
    audit: t('staffOps.assistCard.tab.audit'),
  })[k];

function feeText(model: FeeModel, value: number): string {
  if (model === 'percent_of_claims') {
    const pct = String(Math.round(value * 1000) / 10);
    return t('staffOps.assistCard.feePercent', { pct: getLocale() === 'en' ? pct : pct.replace('.', ',') });
  }
  return t(model === 'pepm' ? 'staffOps.assistCard.feePepm' : 'staffOps.assistCard.feePerCase', { amount: formatMoney(value) });
}

function ContractTab({ c }: { c: AssistanceCardView }) {
  const a = c.assistance;
  const canEdit = useCan('assistance.manage');
  const update = useUpdateContract();
  const [feeModel, setFeeModel] = useState<FeeModel>(a.contract.feeModel);
  const [feeValue, setFeeValue] = useState(String(a.contract.feeValue).replace('.', ','));
  const defaultLimit = useDmsParam('assistanceGuaranteeAuthority');
  const [limit, setLimit] = useState(a.contract.guaranteeAuthorityLimit === undefined ? '' : String(a.contract.guaranteeAuthorityLimit));
  const [days, setDays] = useState(String(a.contract.rebillPaymentDays));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = async () => {
    const parsed = assistanceContractSchema.safeParse({
      feeModel,
      feeValue: Number(feeValue.replace(/\s/g, '').replace(',', '.')),
      // Empty: no individual value, the DMS parameter applies.
      guaranteeAuthorityLimit: limit.trim() ? Number(limit.replace(/\s/g, '')) : undefined,
      rebillPaymentDays: Number(days),
    });
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])));
      return;
    }
    setErrors({});
    try {
      await update.mutateAsync({ id: a.id, body: parsed.data });
      toast.success(t('staffOps.assistCard.contractUpdated'));
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title={t('staffOps.assistCard.contractTitle', { number: a.contract.number })}>
        <dl className="divide-y divide-border-soft">
          <Kv label={t('staffOps.assistCard.term')}>
            <span className="num">
              {formatDate(a.contract.validFrom)} — {formatDate(a.contract.validTo)}
            </span>
          </Kv>
          <Kv label={t('staffOps.assistCard.fee')}>
            <span data-testid="contract-fee">{feeText(a.contract.feeModel, a.contract.feeValue)}</span>
          </Kv>
          <Kv label={t('staffOps.assistCard.authority')}>
            {a.contract.guaranteeAuthorityLimit === undefined ? (
              <span data-testid="contract-authority">{t('staffOps.assistCard.authorityParam', { amount: formatMoney(defaultLimit) })}</span>
            ) : (
              <span data-testid="contract-authority">{t('staffOps.assistCard.authorityContract', { amount: formatMoney(a.contract.guaranteeAuthorityLimit) })}</span>
            )}
          </Kv>
          <Kv label={t('staffOps.assistCard.paymentTerm')}>{t('staffOps.assistCard.days', { n: a.contract.rebillPaymentDays })}</Kv>
          <Kv label={t('staffOps.assistCard.serviceCost')}>{c.feePerInsured === null ? '—' : t('staffOps.assistCard.perInsuredMonth', { amount: formatMoney(c.feePerInsured) })}</Kv>
          <Kv label={t('staffOps.assistCard.line247')}>
            <span className="num">{a.phone24x7}</span>
          </Kv>
        </dl>
      </Card>
      {canEdit && (
        <Card title={t('staffOps.assistCard.editTerms')}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('staffOps.assistances.feeModel')} error={tm(errors.feeModel) || undefined}>
              {(p) => (
                <Select {...p} value={feeModel} onChange={(e) => setFeeModel(e.target.value as FeeModel)}>
                  {(Object.keys(FEE_MODEL_LABEL) as FeeModel[]).map((k) => (
                    <option key={k} value={k}>
                      {FEE_MODEL_LABEL[k]}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label={feeModel === 'percent_of_claims' ? t('staffOps.assistances.share') : t('staffOps.guarantees.amountUzs')} error={tm(errors.feeValue) || undefined}>
              {(p) => <Input {...p} inputMode="decimal" maxLength={14} value={feeValue} onChange={(e) => setFeeValue(e.target.value)} />}
            </Field>
            <Field label={t('staffOps.assistances.authority')} error={tm(errors.guaranteeAuthorityLimit) || undefined} hint={t('staffOps.assistances.authorityHint', { amount: formatMoney(defaultLimit) })}>
              {(p) => <Input {...p} inputMode="numeric" maxLength={14} value={limit} onChange={(e) => setLimit(e.target.value)} />}
            </Field>
            <Field label={t('staffOps.assistances.paymentDays')} error={tm(errors.rebillPaymentDays) || undefined}>
              {(p) => <Input {...p} inputMode="numeric" maxLength={3} value={days} onChange={(e) => setDays(e.target.value)} />}
            </Field>
          </div>
          <Button className="mt-3" loading={update.isPending} onClick={() => void save()}>
            {t('common.save')}
          </Button>
        </Card>
      )}
    </div>
  );
}

function IntegrationTab({ c }: { c: AssistanceCardView }) {
  const canRevoke = useCan('assist.integration.manage', { sub: 'revoke_keys' });
  const revoke = useRevokeAssistKey();
  const [confirm, setConfirm] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label={t('staffOps.assistCard.mode')} value={INTEGRATION_MODE_LABEL[c.assistance.integrationMode]} />
        <Stat label={t('staffOps.clinicCard.webhooks')} value={c.webhooks.endpoints} />
        <Stat label={t('staffOps.assistCard.failedDay')} value={c.webhooks.failed24h} tone={c.webhooks.failed24h ? 'danger' : undefined} />
        <Stat label={t('staffOps.assistCard.apiErrorsDay')} value={c.apiErrors24h} tone={c.apiErrors24h ? 'warning' : undefined} />
      </div>
      <Card title={t('staffOps.clinicCard.keys')} bodyClassName="p-0">
        {c.keys.length === 0 ? (
          <EmptyState
            testId="assistance-keys-next"
            title={t('emptyStaff.clinicKeys.title')}
            why={t('emptyStaff.asstKeys.why')}
            next={t('emptyStaff.responsible', { role: roleName('asst_admin') })}
            help={<HelpMore article="administration" section="admin-integrations" />}
          />
        ) : (
          <ul className="divide-y divide-border-soft">
            {c.keys.map((k) => (
              <li key={k.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                <span className="font-medium">{k.name}</span>
                <code className="text-[12px] text-muted">{k.clientId}</code>
                <span className="min-w-0 flex-1 truncate text-[12px] text-muted">{k.scopes.map((s) => SCOPE_LABEL[s]).join(', ')}</span>
                {k.revokedAt ? (
                  <Chip kind="neutral">{t('staffOps.clinicCard.revokedAt', { date: formatDate(k.revokedAt) })}</Chip>
                ) : canRevoke ? (
                  <Button size="sm" variant="ghost" onClick={() => setConfirm(k.id)}>
                    {t('common.revoke')}
                  </Button>
                ) : (
                  <Chip kind="success">{t('staffOps.clinicCard.active')}</Chip>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
      <ConfirmDialog
        open={!!confirm}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={t('staffOps.assistCard.revokeTitle')}
        description={t('staffOps.assistCard.revokeText')}
        confirmLabel={t('common.revoke')}
        danger
        loading={revoke.isPending}
        onConfirm={async () => {
          try {
            await revoke.mutateAsync({ assistanceId: c.assistance.id, keyId: confirm! });
            toast.success(t('staffOps.clinicCard.keyRevoked'));
            setConfirm(null);
          } catch (e) {
            toast.error(errorMessage(e));
          }
        }}
      />
    </div>
  );
}

function CasesTab({ assistanceId }: { assistanceId: string }) {
  const canRead = useCan('assist.cases.manage', { sub: 'read' });
  const canComplaint = useCan('assist.cases.manage', { sub: 'complaint' });
  const q = useAssistanceCases(assistanceId, canRead);
  const resolve = useResolveComplaint();
  const [closing, setClosing] = useState<AssistanceCase | null>(null);
  const [resolution, setResolution] = useState('');
  const [error, setError] = useState<string>();
  if (!canRead) return <EmptyState title={t('staffOps.assistCard.casesCuratorOnly')} />;
  return (
    <>
      <div className="rounded-card border border-border bg-surface">
        <DataTable
          caption={t('staffOps.assistCard.casesCaption')}
          columns={[
            { key: 'num', header: t('common.number'), cell: (x) => <span className="num font-medium">{x.number}</span> },
            { key: 'type', header: t('common.type'), cell: (x) => (x.type === 'complaint' ? <Chip kind="danger">{CASE_TYPE_LABEL[x.type]}</Chip> : CASE_TYPE_LABEL[x.type]) },
            { key: 'who', header: t('common.insured'), cell: (x) => x.insuredName },
            { key: 'text', header: t('staffOps.assistCard.col.summary'), cell: (x) => <span className="line-clamp-1 text-muted">{x.resolution ?? x.description}</span> },
            { key: 'status', header: t('common.status'), cell: (x) => <CaseStatus status={x.status} /> },
            { key: 'sla', header: 'SLA', cell: (x) => <SlaBadge dueAt={x.slaDueAt} done={x.status === 'resolved'} /> },
            {
              key: 'actions',
              header: '',
              align: 'right',
              cell: (x) =>
                canComplaint && x.type === 'complaint' && x.status !== 'resolved' ? (
                  <Button size="sm" variant="secondary" onClick={() => setClosing(x)} aria-label={t('staffOps.assistCard.closeComplaintAria', { number: x.number })}>
                    {t('staffOps.assistCard.closeComplaint')}
                  </Button>
                ) : null,
            },
          ]}
          rows={q.data}
          loading={q.isLoading}
          error={q.error}
          onRetry={() => void q.refetch()}
          rowKey={(x) => x.id}
          empty={t('staffOps.assistCard.noCases')}
        />
      </div>
      {closing && (
        <Modal
          open
          onOpenChange={(o) => !o && setClosing(null)}
          title={t('staffOps.assistCard.closeComplaint')}
          description={`${closing.number} · ${closing.insuredName}`}
          footer={
            <>
              <Button variant="secondary" onClick={() => setClosing(null)}>
                {t('common.cancel')}
              </Button>
              <Button
                loading={resolve.isPending}
                onClick={async () => {
                  const parsed = complaintResolutionSchema.safeParse({ resolution });
                  if (!parsed.success) {
                    setError(parsed.error.issues[0]?.message);
                    return;
                  }
                  try {
                    await resolve.mutateAsync({ assistanceId, caseId: closing.id, resolution: parsed.data.resolution });
                    toast.success(t('staffOps.assistCard.complaintClosed'));
                    setClosing(null);
                    setResolution('');
                  } catch (e) {
                    toast.error(errorMessage(e));
                  }
                }}
              >
                {t('staffOps.assistCard.closeComplaint')}
              </Button>
            </>
          }
        >
          <p className="mb-3 rounded-btn bg-rail px-3 py-2 text-[13px]">{closing.description}</p>
          <Field label={t('staffOps.assistCard.migDecision')} error={tm(error) || undefined}>
            {(a) => <Textarea {...a} rows={3} maxLength={1000} value={resolution} onChange={(e) => setResolution(e.target.value)} />}
          </Field>
        </Modal>
      )}
    </>
  );
}

export default function AssistanceCardPage() {
  const { assistanceId = '' } = useParams();
  const q = useAssistanceCard(assistanceId);
  const navigate = useNavigate();
  const role = useUser()?.role;
  const canResend = useCan('users.manage');
  // The assistance card is open to every MIG role, its rows lead to sections that are not: no link without access.
  const may = (route: string) => !!role && canOpenRoute(role, route);
  useDocumentTitle(t('staffOps.rebills.col.assistance'));
  useTopbar([{ label: t('staffOps.assistances.title'), to: '/staff/assistance' }, { label: q.data?.assistance.name ?? t('staffOps.assistCard.crumb') }]);
  const [f, setF] = useUrlFilters(['tab'] as const);
  const tab = TAB_KEYS.some((k) => k === f.tab) ? f.tab! : 'overview';
  const canAudit = useCan('audit.read');

  return (
    <QueryState query={q}>
      {(c) => (
        <div>
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <h1 className="text-[22px] font-bold">{c.assistance.name}</h1>
            <LegalFormChip code={c.assistance.legalForm} />
            <Chip kind="accent">{INTEGRATION_MODE_LABEL[c.assistance.integrationMode]}</Chip>
            <span className="text-muted">
              {t('staffOps.assistCard.summary', { number: c.assistance.contract.number, insured: formatNumber(c.insuredCount), clients: c.clients.length })}
            </span>
          </div>
          <Tabs value={tab} onValueChange={(v) => setF({ tab: v === 'overview' ? null : v })}>
            <TabsList>
              {TAB_KEYS.filter((k) => k !== 'audit' || canAudit).map((k) => (
                <TabsTrigger key={k} value={k}>
                  {tabLabel(k)}
                </TabsTrigger>
              ))}
            </TabsList>
            <TabsContent value="overview">
              <div className="flex flex-col gap-4">
                <KpiGrid kpi={c.kpi} />
                <Card title={t('staffOps.assistCard.attention')} bodyClassName="p-0">
                  {c.attention.length === 0 ? (
                    <EmptyState title={t('staffOps.assistCard.allGood')} />
                  ) : (
                    <ul className="divide-y divide-border-soft" data-testid="assistance-attention">
                      {c.attention.map((x) => (
                        <li key={x.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                          <span className="num font-medium">{x.number}</span>
                          <span>{CASE_TYPE_LABEL[x.type]}</span>
                          <span>{x.insuredName}</span>
                          <span className="min-w-0 flex-1 truncate text-muted">{x.description}</span>
                          <CaseStatus status={x.status} />
                          <SlaBadge dueAt={x.slaDueAt} />
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>
              </div>
            </TabsContent>
            <TabsContent value="contract">
              <ContractTab c={c} />
            </TabsContent>
            <TabsContent value="clients">
              <div className="rounded-card border border-border bg-surface">
                <DataTable
                  caption={t('staffOps.assistCard.clientsCaption')}
                  columns={[
                    { key: 'name', header: t('common.client'), cell: (x) => <span className="font-medium">{x.name}</span> },
                    legalFormColumn<AssistanceCardView['clients'][number]>((x) => x.legalForm),
                    { key: 'policy', header: t('common.policy'), cell: (x) => <span className="num">{x.policyNumber}</span> },
                    { key: 'from', header: t('staffOps.assistCard.col.since'), cell: (x) => <span className="num">{formatDate(x.from)}</span> },
                    { key: 'count', header: t('staffOps.assistances.col.insured'), align: 'right', cell: (x) => <span className="num">{x.insuredCount}</span> },
                  ]}
                  rows={c.clients}
                  rowKey={(x) => x.id}
                  onRowClick={may('/staff/clients/:id') ? (x) => navigate(`/staff/clients/${x.id}`) : undefined}
                  empty={
                    <EmptyState
                      testId="assistance-clients-next"
                      title={t('emptyStaff.asstClients.title')}
                      why={t('emptyStaff.asstClients.why')}
                      next={t('emptyStaff.responsible', { role: roleName('underwriter') })}
                      help={<HelpMore article="assistance" section="assistance-assignment" />}
                    />
                  }
                />
              </div>
            </TabsContent>
            <TabsContent value="cases">
              <CasesTab assistanceId={c.assistance.id} />
            </TabsContent>
            <TabsContent value="users">
              <div className="rounded-card border border-border bg-surface">
                <DataTable
                  caption={t('staffOps.assistCard.usersCaption')}
                  columns={[
                    { key: 'name', header: t('common.fullName'), cell: (u) => u.fullName },
                    { key: 'email', header: t('common.email'), cell: (u) => u.email },
                    { key: 'role', header: t('common.role'), cell: (u) => ROLE_LABEL[u.role] },
                    { key: 'login', header: t('staffOps.clinicCard.lastLogin'), cell: (u) => (u.lastLoginAt ? <span className="num">{formatDateTime(u.lastLoginAt)}</span> : '—') },
                    { key: 'active', header: t('common.status'), cell: (u) => (u.active && u.invitation ? <InvitationStatus invitation={u.invitation} /> : <Chip kind={u.active ? 'success' : 'neutral'}>{u.active ? t('staffOps.clinicCard.active') : t('staffOps.assistCard.disabled')}</Chip>) },
                    { key: 'invite', header: '', align: 'right', cell: (u) => (u.active && u.invitation && canResend ? <ResendInvitation userId={u.id} name={u.fullName} /> : null) },
                  ]}
                  rows={c.users}
                  rowKey={(u) => u.id}
                  empty={
                    <EmptyState
                      testId="assistance-users-next"
                      title={t('emptyStaff.asstUsers.title')}
                      why={t('emptyStaff.asstUsers.why')}
                      next={t('emptyStaff.responsible', { role: roleName('admin') })}
                      help={<HelpMore article="administration" section="admin-partners" />}
                    />
                  }
                />
              </div>
            </TabsContent>
            <TabsContent value="integration">
              <IntegrationTab c={c} />
            </TabsContent>
            <TabsContent value="rebills">
              <div className="rounded-card border border-border bg-surface">
                <DataTable
                  caption={t('staffOps.assistCard.rebillsCaption')}
                  columns={[
                    { key: 'num', header: t('common.number'), cell: (b) => <span className="num font-medium">{b.number}</span> },
                    { key: 'period', header: t('common.period'), cell: (b) => <span className="num">{b.period}</span> },
                    { key: 'fee', header: t('staffOps.assistCard.fee'), align: 'right', cell: (b) => <span className="num">{formatMoney(b.totals.fee)}</span> },
                    { key: 'total', header: t('common.total'), align: 'right', cell: (b) => <span className="num">{formatMoney(b.totals.total)}</span> },
                    { key: 'flags', header: t('staffOps.rebills.col.flagged'), align: 'right', cell: (b) => <span className="num">{b.flaggedCount}</span> },
                    { key: 'status', header: t('common.status'), cell: (b) => <RebillStatus status={b.status} /> },
                  ]}
                  rows={c.rebills}
                  rowKey={(b) => b.id}
                  onRowClick={may('/staff/rebills/:id') ? (b) => navigate(`/staff/rebills/${b.id}`) : undefined}
                  empty={
                    <EmptyState
                      testId="assistance-rebills-next"
                      title={t('emptyStaff.rebills.title')}
                      why={t('emptyStaff.rebills.why')}
                      next={t('emptyStaff.rebills.next', { role: roleName('claims_officer') })}
                      help={<HelpMore article="assistance" section="assistance-rebill" />}
                    />
                  }
                />
              </div>
            </TabsContent>
            <TabsContent value="qa">
              <p className="mb-2 text-[13px] text-muted">
                {t('staffOps.assistCard.qaNote')}
                {may('/staff/qa') && (
                  <>
                    {' '}
                    <Link className="text-accent-text hover:underline" to="/staff/qa">
                      {t('staffOps.assistCard.qaLink')}
                    </Link>
                  </>
                )}
                .
              </p>
              <div className="rounded-card border border-border bg-surface">
                <DataTable
                  caption={t('staffOps.qa.title')}
                  columns={[
                    { key: 'date', header: t('staffOps.qa.col.since'), cell: (s) => <span className="num">{formatDate(s.createdAt)}</span> },
                    { key: 'label', header: t('common.decision'), cell: (s) => s.subject.label },
                    { key: 'verdict', header: t('staffOps.qa.col.verdict'), cell: (s) => <QaVerdict s={s} /> },
                    { key: 'who', header: t('staffOps.assistCard.col.expert'), cell: (s) => s.reviewedByName ?? '—' },
                  ]}
                  rows={c.qa}
                  rowKey={(s) => s.id}
                  empty={t('staffOps.qa.empty')}
                />
              </div>
            </TabsContent>
            {canAudit && (
              <TabsContent value="audit">
                <div className="rounded-card border border-border bg-surface">
                  <DataTable
                    caption={t('staffOps.assistCard.auditCaption')}
                    columns={[
                      { key: 'at', header: t('common.time'), cell: (e) => <span className="num whitespace-nowrap">{formatDateTime(e.at)}</span> },
                      { key: 'who', header: t('staffOps.assistCard.col.who'), cell: (e) => `${e.actorName} · ${ROLE_LABEL[e.actorRole]}` },
                      { key: 'what', header: t('staffOps.assistCard.col.action'), cell: (e) => AUDIT_ACTION_LABEL[e.action] },
                      { key: 'target', header: t('staffOps.assistCard.col.target'), cell: (e) => e.targetLabel ?? '—' },
                      { key: 'reason', header: t('common.reason'), cell: (e) => <span className="text-muted">{e.reason ?? ''}</span> },
                    ]}
                    rows={c.audit}
                    rowKey={(e) => e.id}
                    empty={t('staffOps.assistCard.noEvents')}
                  />
                </div>
                <Link className="mt-2 inline-block text-accent-text hover:underline" to={`/staff/audit?assistanceId=${c.assistance.id}`}>
                  {t('staffOps.assistCard.fullAudit')}
                </Link>
              </TabsContent>
            )}
          </Tabs>
        </div>
      )}
    </QueryState>
  );
}
