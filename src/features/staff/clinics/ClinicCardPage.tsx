/* Clinic card for MIG staff (CLINIC_SPEC §5): overview, users, integration health, guarantee letters, registries. */
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { z } from 'zod';
import type { IntegrationClient, IntegrationMode } from '@/shared/types';
import type { ClinicUserView, GuaranteeView, RegistrySummary } from '@/shared/types/dto';
import { useClinicCard, useInviteClinicAdmin, useSetClinicMode, useStaffGuarantees, useStaffRegistries, useStaffRevokeKey } from '@/shared/api/queries/clinic';
import { errorMessage } from '@/shared/api/client';
import { useCan } from '@/shared/auth/guards';
import { ROLE_LABEL, SPECIALTY_LABEL } from '@/shared/domain/labels';
import { GUARANTEE_STATUS_CHIP, GUARANTEE_STATUS_LABEL, INTEGRATION_MODE_LABEL, REGISTRY_STATUS_CHIP, REGISTRY_STATUS_LABEL } from '@/shared/domain/clinics';
import { clinicAdminInviteSchema } from '@/shared/schemas/forms';
import { formatDate, formatDateTime, formatMoney, formatPercent } from '@/shared/lib/format';
import { useDocumentTitle, useUrlFilters } from '@/shared/lib/hooks';
import { Button } from '@/shared/ui/button';
import { Chip } from '@/shared/ui/chips';
import { ConfirmDialog } from '@/shared/ui/confirm-dialog';
import { DataTable, type Column } from '@/shared/ui/data-table';
import { Modal } from '@/shared/ui/dialog';
import { Field, Input, Select } from '@/shared/ui/input';
import { Card, Kv } from '@/shared/ui/page';
import { EmptyState, ErrorState, SkeletonRows } from '@/shared/ui/states';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/ui/tabs';
import { toast } from '@/shared/ui/toast';
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
      toast.success('Приглашение отправлено');
      onClose();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  });
  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title="Пригласить администратора клиники"
      description="Первый администратор затем сам приглашает регистраторов и управляет интеграцией"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Отмена
          </Button>
          <Button loading={invite.isPending} onClick={() => void submit()}>
            Пригласить
          </Button>
        </>
      }
    >
      <form className="flex flex-col gap-3" onSubmit={(ev) => void submit(ev)} noValidate>
        <Field label="ФИО" error={e.fullName?.message}>
          {(a) => <Input {...a} autoComplete="off" maxLength={120} {...form.register('fullName')} />}
        </Field>
        <Field label="Email" error={e.email?.message}>
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
  useDocumentTitle('Клиника');
  useTopbar([{ label: 'Клиники', to: '/staff/clinics' }, { label: q.data?.clinic.name ?? 'Клиника' }]);
  const [f, setF] = useUrlFilters(['tab'] as const);
  const tab = ['overview', 'users', 'integration', 'guarantees', 'registries'].includes(f.tab) ? f.tab : 'overview';
  const canManage = useCan('clinics.manage');
  const canInvite = useCan('clinic.users.manage', { sub: 'first_admin' });
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
      toast.success('Режим интеграции изменён');
      setModeValue(null);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  const doRevoke = async () => {
    if (!revoking) return;
    try {
      await revoke.mutateAsync({ clinicId: c.id, keyId: revoking.id });
      toast.success('Ключ отозван');
      setRevoking(null);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const userCols: Column<ClinicUserView>[] = [
    { key: 'name', header: 'ФИО', cell: (u) => <span className="font-medium">{u.fullName}</span> },
    { key: 'email', header: 'Email', cell: (u) => <span className="text-muted">{u.email}</span> },
    { key: 'role', header: 'Роль', cell: (u) => ROLE_LABEL[u.role] },
    { key: 'active', header: 'Статус', cell: (u) => <Chip kind={u.active ? 'success' : 'neutral'}>{u.active ? 'Активен' : 'Заблокирован'}</Chip> },
    { key: 'login', header: 'Последний вход', cell: (u) => <span className="num text-muted">{u.lastLoginAt ? formatDateTime(u.lastLoginAt) : '—'}</span> },
  ];
  const keyCols: Column<IntegrationClient>[] = [
    { key: 'name', header: 'Название', cell: (k) => <span className="font-medium">{k.name}</span> },
    { key: 'id', header: 'client_id', cell: (k) => <code className="text-[12px]">{k.clientId}</code> },
    { key: 'scopes', header: 'Области', cell: (k) => <span className="text-[12px] text-muted">{k.scopes.join(', ')}</span> },
    { key: 'used', header: 'Последнее использование', cell: (k) => <span className="num text-muted">{k.lastUsedAt ? formatDateTime(k.lastUsedAt) : '—'}</span> },
    {
      key: 'actions',
      header: '',
      align: 'right',
      cell: (k) =>
        k.revokedAt ? (
          <Chip kind="neutral">Отозван {formatDateTime(k.revokedAt)}</Chip>
        ) : canRevoke ? (
          <Button size="sm" variant="secondary" onClick={() => setRevoking(k)} aria-label={`Отозвать ключ ${k.name}`}>
            Отозвать
          </Button>
        ) : (
          <Chip kind="success">Активен</Chip>
        ),
    },
  ];
  const gCols: Column<GuaranteeView>[] = [
    { key: 'num', header: 'Номер', cell: (g) => <span className="num">{g.number}</span> },
    { key: 'date', header: 'Создано', cell: (g) => <span className="num text-muted">{formatDate(g.createdAt)}</span> },
    { key: 'svc', header: 'Услуга', cell: (g) => g.serviceName },
    { key: 'sum', header: 'Сумма', align: 'right', cell: (g) => <span className="num">{formatMoney(g.approvedAmount ?? g.estimatedCost)}</span> },
    { key: 'st', header: 'Статус', cell: (g) => <Chip kind={GUARANTEE_STATUS_CHIP[g.status]}>{GUARANTEE_STATUS_LABEL[g.status]}</Chip> },
  ];
  const rCols: Column<RegistrySummary>[] = [
    { key: 'period', header: 'Период', cell: (r) => <span className="num">{r.period}</span> },
    { key: 'lines', header: 'Строк', align: 'right', cell: (r) => <span className="num">{r.lineCount}</span> },
    { key: 'claimed', header: 'Заявлено', align: 'right', cell: (r) => <span className="num">{formatMoney(r.totals.claimed)}</span> },
    { key: 'accepted', header: 'Принято', align: 'right', cell: (r) => <span className="num">{formatMoney(r.totals.accepted)}</span> },
    { key: 'st', header: 'Статус', cell: (r) => <Chip kind={REGISTRY_STATUS_CHIP[r.status]}>{REGISTRY_STATUS_LABEL[r.status]}</Chip> },
  ];

  return (
    <div>
      <div className="mb-3">
        <h1 className="text-[22px] font-bold">{c.name}</h1>
        <p className="text-muted">
          {c.address} · {c.district}
        </p>
      </div>
      <Tabs value={tab} onValueChange={(v) => setF({ tab: v === 'overview' ? null : v })}>
        <TabsList>
          <TabsTrigger value="overview">Обзор</TabsTrigger>
          <TabsTrigger value="users">Пользователи</TabsTrigger>
          <TabsTrigger value="integration">Интеграция</TabsTrigger>
          {canGuarantees && <TabsTrigger value="guarantees">Гарантийные письма</TabsTrigger>}
          {canRegistries && <TabsTrigger value="registries">Реестры</TabsTrigger>}
        </TabsList>
        <TabsContent value="overview">
          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="Договор">
              <div className="grid gap-2 sm:grid-cols-2">
                <Kv label="Номер договора">{card.contractNumber}</Kv>
                <Kv label="Действует до">{formatDate(c.contractUntil)}</Kv>
                <Kv label="Специальности">{c.specialties.map((s) => SPECIALTY_LABEL[s]).join(', ')}</Kv>
                <Kv label="Режим интеграции">
                  {canManage ? (
                    <span className="flex items-center gap-2">
                      <Select aria-label="Режим интеграции" className="w-44" value={mode ?? c.integrationMode} onChange={(e) => setModeValue(e.target.value as IntegrationMode)}>
                        {(Object.keys(INTEGRATION_MODE_LABEL) as IntegrationMode[]).map((m) => (
                          <option key={m} value={m}>
                            {INTEGRATION_MODE_LABEL[m]}
                          </option>
                        ))}
                      </Select>
                      {mode && mode !== c.integrationMode && (
                        <Button size="sm" loading={setMode.isPending} onClick={() => void saveMode()}>
                          Сохранить
                        </Button>
                      )}
                    </span>
                  ) : (
                    INTEGRATION_MODE_LABEL[c.integrationMode]
                  )}
                </Kv>
              </div>
            </Card>
            <Card title="Показатели">
              <div className="grid gap-2 sm:grid-cols-3" data-testid="clinic-metrics">
                <Kv label="Среднее время ответа на запись">
                  {card.metrics.avgResponseMinutes === null ? '—' : `${card.metrics.avgResponseMinutes} мин`}
                  <span className="block text-[12px] text-muted">норматив {c.responseSlaMinutes ?? responseNorm} мин</span>
                </Kv>
                <Kv label="Доля отклонённых строк">{card.metrics.rejectedLineShare === null ? '—' : formatPercent(card.metrics.rejectedLineShare, 1)}</Kv>
                <Kv label="Сумма к оплате">
                  <span className="num">{formatMoney(card.metrics.amountToPay)}</span>
                </Kv>
              </div>
            </Card>
          </div>
        </TabsContent>
        <TabsContent value="users">
          <Card
            title="Пользователи клиники"
            actions={
              canInvite && !hasAdmin ? (
                <Button size="sm" onClick={() => setInviting(true)}>
                  Пригласить администратора
                </Button>
              ) : undefined
            }
          >
            {hasAdmin && canInvite && <p className="mb-2 text-[12px] text-muted">Остальных пользователей приглашает администратор клиники в своём кабинете.</p>}
            <DataTable caption="Пользователи клиники" columns={userCols} rows={card.users} rowKey={(u) => u.id} empty={<EmptyState title="Пользователей нет" />} />
          </Card>
        </TabsContent>
        <TabsContent value="integration">
          <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
            {[
              ['Вебхуков', card.webhooks.endpoints],
              ['Доставок в повторе', card.webhooks.retrying],
              ['Не доставлено за 24 ч', card.webhooks.failed24h],
              ['Ошибок API за 24 ч', card.apiErrors24h],
            ].map(([label, value]) => (
              <div key={label} className="rounded-card border border-border bg-surface p-3">
                <div className="text-[12px] text-muted">{label}</div>
                <div className={Number(value) > 0 && label !== 'Вебхуков' ? 'num font-semibold text-warning-text' : 'num font-semibold'}>{value}</div>
              </div>
            ))}
          </div>
          <Card title="Ключи API (секреты не показываются)">
            <DataTable caption="Ключи API" columns={keyCols} rows={card.keys} rowKey={(k) => k.id} empty={<EmptyState title="Ключей нет" />} />
          </Card>
        </TabsContent>
        {canGuarantees && (
          <TabsContent value="guarantees">
            <Card title="Гарантийные письма">
              <DataTable
                caption="Гарантийные письма клиники"
                columns={gCols}
                rows={guarantees.data}
                rowKey={(g) => g.id}
                loading={guarantees.isLoading}
                error={guarantees.error}
                onRowClick={() => navigate(`/staff/guarantees?clinicId=${c.id}&status=all`)}
                empty={<EmptyState title="Писем нет" />}
              />
            </Card>
          </TabsContent>
        )}
        {canRegistries && (
          <TabsContent value="registries">
            <Card title="Реестры">
              <DataTable
                caption="Реестры клиники"
                columns={rCols}
                rows={registries.data}
                rowKey={(r) => r.id}
                loading={registries.isLoading}
                error={registries.error}
                onRowClick={(r) => navigate(`/staff/registries/${r.id}`)}
                empty={<EmptyState title="Реестров нет" />}
              />
            </Card>
          </TabsContent>
        )}
      </Tabs>
      {inviting && <InviteAdminDialog clinicId={c.id} onClose={() => setInviting(false)} />}
      <ConfirmDialog
        open={!!revoking}
        onOpenChange={(o) => !o && setRevoking(null)}
        title="Отозвать ключ клиники?"
        description="Ключ и все выданные по нему токены сразу перестанут работать. Клиника увидит отзыв в журнале событий."
        confirmLabel="Отозвать"
        danger
        loading={revoke.isPending}
        onConfirm={() => void doRevoke()}
      />
    </div>
  );
}
