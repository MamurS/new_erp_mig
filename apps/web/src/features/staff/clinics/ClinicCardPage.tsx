/* Clinic card for MIG staff (CLINIC_SPEC §5): overview, users, integration health, guarantee letters, registries. */
import { InvitationStatus, ResendInvitation } from '@/features/auth/InvitationStatus';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { z } from 'zod';
import type { IntegrationClient, IntegrationMode } from '@mig/contracts';
import type { ClinicUserView, GuaranteeView, RegistrySummary } from '@mig/contracts/dto';
import { useClinicCard, useInviteClinicAdmin, useSetClinicMode, useStaffGuarantees, useStaffRegistries, useStaffRevokeKey } from '@/shared/api/queries/clinic';
import { errorMessage } from '@/shared/api/client';
import { useCan } from '@/shared/auth/guards';
import { ROLE_LABEL, SPECIALTY_LABEL } from '@mig/domain/labels';
import { GUARANTEE_STATUS_CHIP, GUARANTEE_STATUS_LABEL, INTEGRATION_MODE_LABEL, REGISTRY_STATUS_CHIP, REGISTRY_STATUS_LABEL } from '@mig/domain/clinics';
import { clinicAdminInviteSchema } from '@mig/contracts/forms';
import { t, tm } from '@/i18n';
import { formatDate, formatDateTime, formatMoney, formatPercent } from '@mig/domain/lib/format';
import { useDocumentTitle, useUrlFilters } from '@/shared/lib/hooks';
import { Button } from '@/shared/ui/button';
import { Chip } from '@/shared/ui/chips';
import { ConfirmDialog } from '@/shared/ui/confirm-dialog';
import { LegalFormChip } from '@/shared/ui/legal-form';
import { DataTable, type Column } from '@/shared/ui/data-table';
import { Modal } from '@/shared/ui/dialog';
import { Field, Input, Select } from '@/shared/ui/input';
import { Card, Kv } from '@/shared/ui/page';
import { EmptyState, ErrorState, SkeletonRows } from '@/shared/ui/states';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/ui/tabs';
import { toast } from '@/shared/ui/toast';
import { HelpMore, roleName } from '@/features/next/NextActions';
import { useTopbar } from '../topbar';
import { useDmsParam } from '@/shared/api/queries/params';

type InviteForm = z.input<typeof clinicAdminInviteSchema>;

function InviteAdminDialog({ clinicId, onClose }: { clinicId: string; onClose: () => void }) {
  const invite = useInviteClinicAdmin();
  const form = useForm<InviteForm, unknown, z.output<typeof clinicAdminInviteSchema>>({ resolver: zodResolver(clinicAdminInviteSchema), defaultValues: { email: '', fullName: '' } });
  const e = form.formState.errors;
  const submit = form.handleSubmit(async (v) => {
    try {
      await invite.mutateAsync({ id: clinicId, ...v });
      toast.success(t('staffOps.clinicCard.inviteSent'));
      onClose();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  });
  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('staffOps.clinicCard.inviteTitle')}
      description={t('staffOps.clinicCard.inviteText')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button loading={invite.isPending} onClick={() => void submit()}>
            {t('staffOps.clinicCard.invite')}
          </Button>
        </>
      }
    >
      <form className="flex flex-col gap-3" onSubmit={(ev) => void submit(ev)} noValidate>
        <Field label={t('common.fullName')} error={tm(e.fullName?.message) || undefined}>
          {(a) => <Input {...a} autoComplete="off" maxLength={120} {...form.register('fullName')} />}
        </Field>
        <Field label={t('common.email')} error={tm(e.email?.message) || undefined}>
          {(a) => <Input {...a} type="email" autoComplete="off" maxLength={254} {...form.register('email')} />}
        </Field>
      </form>
    </Modal>
  );
}

export default function ClinicCardPage() {
  const { clinicId = '' } = useParams();
  const navigate = useNavigate();
  const q = useClinicCard(clinicId);
  const responseNorm = useDmsParam('clinicResponseMinutes');
  useDocumentTitle(t('common.clinic'));
  useTopbar([{ label: t('staffOps.clinicCard.clinics'), to: '/staff/clinics' }, { label: q.data?.clinic.name ?? t('common.clinic') }]);
  const [f, setF] = useUrlFilters(['tab'] as const);
  const tab = ['overview', 'users', 'integration', 'guarantees', 'registries'].includes(f.tab) ? f.tab : 'overview';
  const canManage = useCan('clinics.manage');
  const canInvite = useCan('clinic.users.manage', { sub: 'first_admin' });
  const canResend = useCan('users.manage');
  const canRevoke = useCan('clinic.integration.manage', { sub: 'revoke_keys' });
  const canGuarantees = useCan('guarantees.read');
  const canReview = useCan('registries.review');
  const canPay = useCan('registries.pay');
  const canRegistries = canReview || canPay;
  const guarantees = useStaffGuarantees({ clinicId }, canGuarantees);
  const registries = useStaffRegistries({ clinicId }, canRegistries);
  const setMode = useSetClinicMode();
  const revoke = useStaffRevokeKey();
  const [inviting, setInviting] = useState(false);
  const [revoking, setRevoking] = useState<IntegrationClient | null>(null);
  const [mode, setModeValue] = useState<IntegrationMode | null>(null);

  if (q.isLoading) return <SkeletonRows rows={8} />;
  if (q.isError || !q.data) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const card = q.data;
  const c = card.clinic;
  const hasAdmin = card.users.some((u) => u.role === 'clinic_admin' && u.active);

  const saveMode = async () => {
    if (!mode) return;
    try {
      await setMode.mutateAsync({ id: c.id, integrationMode: mode });
      toast.success(t('staffOps.clinicCard.modeChanged'));
      setModeValue(null);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  const doRevoke = async () => {
    if (!revoking) return;
    try {
      await revoke.mutateAsync({ clinicId: c.id, keyId: revoking.id });
      toast.success(t('staffOps.clinicCard.keyRevoked'));
      setRevoking(null);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const userCols: Column<ClinicUserView>[] = [
    { key: 'name', header: t('common.fullName'), cell: (u) => <span className="font-medium">{u.fullName}</span> },
    { key: 'email', header: t('common.email'), cell: (u) => <span className="text-muted">{u.email}</span> },
    { key: 'role', header: t('common.role'), cell: (u) => ROLE_LABEL[u.role] },
    { key: 'active', header: t('common.status'), cell: (u) => (u.active && u.invitation ? <InvitationStatus invitation={u.invitation} /> : <Chip kind={u.active ? 'success' : 'neutral'}>{u.active ? t('staffOps.clinicCard.active') : t('staffOps.clinicCard.blocked')}</Chip>) },
    { key: 'login', header: t('staffOps.clinicCard.lastLogin'), cell: (u) => <span className="num text-muted">{u.lastLoginAt ? formatDateTime(u.lastLoginAt) : '—'}</span> },
    { key: 'invite', header: '', align: 'right', cell: (u) => (u.active && u.invitation && canResend ? <ResendInvitation userId={u.id} name={u.fullName} /> : null) },
  ];
  const keyCols: Column<IntegrationClient>[] = [
    { key: 'name', header: t('common.name'), cell: (k) => <span className="font-medium">{k.name}</span> },
    { key: 'id', header: 'client_id', cell: (k) => <code className="text-[12px]">{k.clientId}</code> },
    { key: 'scopes', header: t('staffOps.clinicCard.scopes'), cell: (k) => <span className="text-[12px] text-muted">{k.scopes.join(', ')}</span> },
    { key: 'used', header: t('staffOps.clinicCard.lastUsed'), cell: (k) => <span className="num text-muted">{k.lastUsedAt ? formatDateTime(k.lastUsedAt) : '—'}</span> },
    {
      key: 'actions',
      header: '',
      align: 'right',
      cell: (k) =>
        k.revokedAt ? (
          <Chip kind="neutral">{t('staffOps.clinicCard.revokedAt', { date: formatDateTime(k.revokedAt) })}</Chip>
        ) : canRevoke ? (
          <Button size="sm" variant="secondary" onClick={() => setRevoking(k)} aria-label={t('staffOps.clinicCard.revokeKeyAria', { name: k.name })}>
            {t('common.revoke')}
          </Button>
        ) : (
          <Chip kind="success">{t('staffOps.clinicCard.active')}</Chip>
        ),
    },
  ];
  const gCols: Column<GuaranteeView>[] = [
    { key: 'num', header: t('common.number'), cell: (g) => <span className="num">{g.number}</span> },
    { key: 'date', header: t('common.created'), cell: (g) => <span className="num text-muted">{formatDate(g.createdAt)}</span> },
    { key: 'svc', header: t('common.service'), cell: (g) => g.serviceName },
    { key: 'sum', header: t('common.amount'), align: 'right', cell: (g) => <span className="num">{formatMoney(g.approvedAmount ?? g.estimatedCost)}</span> },
    { key: 'st', header: t('common.status'), cell: (g) => <Chip kind={GUARANTEE_STATUS_CHIP[g.status]}>{GUARANTEE_STATUS_LABEL[g.status]}</Chip> },
  ];
  const rCols: Column<RegistrySummary>[] = [
    { key: 'period', header: t('common.period'), cell: (r) => <span className="num">{r.period}</span> },
    { key: 'lines', header: t('staffOps.clinicCard.lines'), align: 'right', cell: (r) => <span className="num">{r.lineCount}</span> },
    { key: 'claimed', header: t('staffOps.registries.claimed'), align: 'right', cell: (r) => <span className="num">{formatMoney(r.totals.claimed)}</span> },
    { key: 'accepted', header: t('staffOps.registries.accepted'), align: 'right', cell: (r) => <span className="num">{formatMoney(r.totals.accepted)}</span> },
    { key: 'st', header: t('common.status'), cell: (r) => <Chip kind={REGISTRY_STATUS_CHIP[r.status]}>{REGISTRY_STATUS_LABEL[r.status]}</Chip> },
  ];

  return (
    <div>
      <div className="mb-3">
        <h1 className="flex flex-wrap items-center gap-2 text-[22px] font-bold">
          {c.name}
          <LegalFormChip code={c.legalForm} />
        </h1>
        <p className="text-muted">
          {c.address} · {c.district}
        </p>
      </div>
      <Tabs value={tab} onValueChange={(v) => setF({ tab: v === 'overview' ? null : v })}>
        <TabsList>
          <TabsTrigger value="overview">{t('staffOps.clinicCard.tab.overview')}</TabsTrigger>
          <TabsTrigger value="users">{t('staffOps.clinicCard.tab.users')}</TabsTrigger>
          <TabsTrigger value="integration">{t('staffOps.clinicCard.tab.integration')}</TabsTrigger>
          {canGuarantees && <TabsTrigger value="guarantees">{t('staffOps.guarantees.title')}</TabsTrigger>}
          {canRegistries && <TabsTrigger value="registries">{t('staffOps.clinicCard.tab.registries')}</TabsTrigger>}
        </TabsList>
        <TabsContent value="overview">
          <div className="grid gap-4 lg:grid-cols-2">
            <Card title={t('common.contract')}>
              <div className="grid gap-2 sm:grid-cols-2">
                <Kv label={t('staffOps.clinicCard.contractNumber')}>{card.contractNumber}</Kv>
                <Kv label={t('common.validUntil')}>{formatDate(c.contractUntil)}</Kv>
                <Kv label={t('staffOps.clinicCard.specialties')}>{c.specialties.map((s) => SPECIALTY_LABEL[s]).join(', ')}</Kv>
                <Kv label={t('staffOps.clinicCard.integrationMode')}>
                  {canManage ? (
                    <span className="flex items-center gap-2">
                      <Select aria-label={t('staffOps.clinicCard.integrationMode')} className="w-44" value={mode ?? c.integrationMode} onChange={(e) => setModeValue(e.target.value as IntegrationMode)}>
                        {(Object.keys(INTEGRATION_MODE_LABEL) as IntegrationMode[]).map((m) => (
                          <option key={m} value={m}>
                            {INTEGRATION_MODE_LABEL[m]}
                          </option>
                        ))}
                      </Select>
                      {mode && mode !== c.integrationMode && (
                        <Button size="sm" loading={setMode.isPending} onClick={() => void saveMode()}>
                          {t('common.save')}
                        </Button>
                      )}
                    </span>
                  ) : (
                    INTEGRATION_MODE_LABEL[c.integrationMode]
                  )}
                </Kv>
              </div>
            </Card>
            <Card title={t('staffOps.clinicCard.metrics')}>
              <div className="grid gap-2 sm:grid-cols-3" data-testid="clinic-metrics">
                <Kv label={t('staffOps.clinicCard.avgResponse')}>
                  {card.metrics.avgResponseMinutes === null ? '—' : t('staffOps.clinicCard.minutes', { n: card.metrics.avgResponseMinutes })}
                  <span className="block text-[12px] text-muted">{t('staffOps.clinicCard.norm', { n: c.responseSlaMinutes ?? responseNorm })}</span>
                </Kv>
                <Kv label={t('staffOps.clinicCard.rejectedShare')}>{card.metrics.rejectedLineShare === null ? '—' : formatPercent(card.metrics.rejectedLineShare, 1)}</Kv>
                <Kv label={t('staffOps.clinicCard.amountToPay')}>
                  <span className="num">{formatMoney(card.metrics.amountToPay)}</span>
                </Kv>
              </div>
            </Card>
          </div>
        </TabsContent>
        <TabsContent value="users">
          <Card
            title={t('staffOps.clinicCard.clinicUsers')}
            actions={
              canInvite && !hasAdmin && card.users.length > 0 ? (
                <Button size="sm" onClick={() => setInviting(true)}>
                  {t('staffOps.clinicCard.inviteAdmin')}
                </Button>
              ) : undefined
            }
          >
            {hasAdmin && canInvite && <p className="mb-2 text-[12px] text-muted">{t('staffOps.clinicCard.othersInvitedByAdmin')}</p>}
            <DataTable caption={t('staffOps.clinicCard.clinicUsers')} columns={userCols} rows={card.users} rowKey={(u) => u.id} empty={
                <EmptyState
                  testId="clinic-users-next"
                  title={t('emptyStaff.clinicUsers.title')}
                  why={t('emptyStaff.clinicUsers.why')}
                  next={canInvite ? t('emptyStaff.clinicUsers.nextCan') : t('emptyStaff.responsible', { role: roleName('admin') })}
                  actions={
                    canInvite && !hasAdmin ? (
                      <Button variant="secondary" onClick={() => setInviting(true)}>
                        {t('staffOps.clinicCard.inviteAdmin')}
                      </Button>
                    ) : null
                  }
                  help={<HelpMore article="administration" section="admin-partners" />}
                />
              }
            />
          </Card>
        </TabsContent>
        <TabsContent value="integration">
          <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
            {[
              [t('staffOps.clinicCard.webhooks'), card.webhooks.endpoints],
              [t('staffOps.clinicCard.retrying'), card.webhooks.retrying],
              [t('staffOps.clinicCard.failed24h'), card.webhooks.failed24h],
              [t('staffOps.clinicCard.apiErrors24h'), card.apiErrors24h],
            ].map(([label, value], i) => (
              <div key={label} className="rounded-card border border-border bg-surface p-3">
                <div className="text-[12px] text-muted">{label}</div>
                <div className={Number(value) > 0 && i > 0 ? 'num font-semibold text-warning-text' : 'num font-semibold'}>{value}</div>
              </div>
            ))}
          </div>
          <Card title={t('staffOps.clinicCard.keysTitle')}>
            <DataTable caption={t('staffOps.clinicCard.keys')} columns={keyCols} rows={card.keys} rowKey={(k) => k.id} empty={
                <EmptyState
                  testId="clinic-keys-next"
                  title={t('emptyStaff.clinicKeys.title')}
                  why={t('emptyStaff.clinicKeys.why')}
                  next={t('emptyStaff.responsible', { role: roleName('clinic_admin') })}
                  help={<HelpMore article="administration" section="admin-integrations" />}
                />
              }
            />
          </Card>
        </TabsContent>
        {canGuarantees && (
          <TabsContent value="guarantees">
            <Card title={t('staffOps.guarantees.title')}>
              <DataTable
                caption={t('staffOps.clinicCard.guaranteesCaption')}
                columns={gCols}
                rows={guarantees.data}
                rowKey={(g) => g.id}
                loading={guarantees.isLoading}
                error={guarantees.error}
                onRowClick={() => navigate(`/staff/guarantees?clinicId=${c.id}&status=all`)}
                empty={<EmptyState title={t('staffOps.guarantees.empty')} />}
              />
            </Card>
          </TabsContent>
        )}
        {canRegistries && (
          <TabsContent value="registries">
            <Card title={t('staffOps.clinicCard.tab.registries')}>
              <DataTable
                caption={t('staffOps.clinicCard.registriesCaption')}
                columns={rCols}
                rows={registries.data}
                rowKey={(r) => r.id}
                loading={registries.isLoading}
                error={registries.error}
                onRowClick={(r) => navigate(`/staff/registries/${r.id}`)}
                empty={
                  <EmptyState
                    testId="clinic-registries-next"
                    title={t('emptyStaff.registries.title')}
                    why={t('emptyStaff.registries.why')}
                    next={t('emptyStaff.registries.next', { role: roleName('operator') })}
                    help={<HelpMore article="clinics" section="monthly-registry" />}
                  />
                }
              />
            </Card>
          </TabsContent>
        )}
      </Tabs>
      {inviting && <InviteAdminDialog clinicId={c.id} onClose={() => setInviting(false)} />}
      <ConfirmDialog
        open={!!revoking}
        onOpenChange={(o) => !o && setRevoking(null)}
        title={t('staffOps.clinicCard.revokeTitle')}
        description={t('staffOps.clinicCard.revokeText')}
        confirmLabel={t('common.revoke')}
        danger
        loading={revoke.isPending}
        onConfirm={() => void doRevoke()}
      />
    </div>
  );
}
