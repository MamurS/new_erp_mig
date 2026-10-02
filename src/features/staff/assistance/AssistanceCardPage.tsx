/* Card of an assistance company for MIG (ASSISTANCE_SPEC §7): KPI, contract, clients, users, integration, rebills, QA, audit. */
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { AssistanceCardView } from '@/shared/types/dto';
import type { AssistanceCase, FeeModel } from '@/shared/types';
import { useAssistanceCard, useAssistanceCases, useResolveComplaint, useRevokeAssistKey, useUpdateContract } from '@/shared/api/queries/assist';
import { errorMessage } from '@/shared/api/client';
import { useCan } from '@/shared/auth/guards';
import { CASE_TYPE_LABEL, FEE_MODEL_LABEL } from '@/shared/domain/assistance';
import { AUDIT_ACTION_LABEL, ROLE_LABEL } from '@/shared/domain/labels';
import { INTEGRATION_MODE_LABEL, SCOPE_LABEL } from '@/shared/domain/clinics';
import { assistanceContractSchema, complaintResolutionSchema } from '@/shared/schemas/forms';
import { formatDate, formatDateTime, formatMoney, formatNumber } from '@/shared/lib/format';
import { useDocumentTitle, useUrlFilters } from '@/shared/lib/hooks';
import { Button } from '@/shared/ui/button';
import { Chip } from '@/shared/ui/chips';
import { ConfirmDialog } from '@/shared/ui/confirm-dialog';
import { DataTable } from '@/shared/ui/data-table';
import { Field, Input, Select, Textarea } from '@/shared/ui/input';
import { Modal } from '@/shared/ui/dialog';
import { Card, Kv } from '@/shared/ui/page';
import { EmptyState, QueryState } from '@/shared/ui/states';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/ui/tabs';
import { toast } from '@/shared/ui/toast';
import { CaseStatus, KpiGrid, RebillStatus, SlaBadge, Stat } from '@/features/assist/components';
import { QaVerdict } from './QaPage';
import { useTopbar } from '../topbar';
import { useDmsParam } from '@/shared/api/queries/params';

const TABS = [
  ['overview', 'Обзор и KPI'],
  ['contract', 'Договор'],
  ['clients', 'Клиенты'],
  ['cases', 'Обращения'],
  ['users', 'Пользователи'],
  ['integration', 'Интеграция'],
  ['rebills', 'Счета'],
  ['qa', 'Контроль качества'],
  ['audit', 'Аудит'],
] as const;

function feeText(model: FeeModel, value: number): string {
  if (model === 'percent_of_claims') return `${String(Math.round(value * 1000) / 10).replace('.', ',')}% от выплат`;
  return `${formatMoney(value)} ${model === 'pepm' ? 'за застрахованного в месяц' : 'за обращение'}`;
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
      toast.success('Договор обновлён');
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title={`Договор ${a.contract.number}`}>
        <dl className="divide-y divide-border-soft">
          <Kv label="Срок">
            <span className="num">
              {formatDate(a.contract.validFrom)} — {formatDate(a.contract.validTo)}
            </span>
          </Kv>
          <Kv label="Вознаграждение">
            <span data-testid="contract-fee">{feeText(a.contract.feeModel, a.contract.feeValue)}</span>
          </Kv>
          <Kv label="Полномочия по ГП">
            {a.contract.guaranteeAuthorityLimit === undefined ? (
              <span data-testid="contract-authority">до {formatMoney(defaultLimit)} · по параметру ДМС</span>
            ) : (
              <span data-testid="contract-authority">до {formatMoney(a.contract.guaranteeAuthorityLimit)} · по договору</span>
            )}
          </Kv>
          <Kv label="Срок оплаты счёта МИГ">{a.contract.rebillPaymentDays} дней</Kv>
          <Kv label="Стоимость обслуживания">{c.feePerInsured === null ? '—' : `${formatMoney(c.feePerInsured)} на застрахованного в месяц`}</Kv>
          <Kv label="Линия 24/7">
            <span className="num">{a.phone24x7}</span>
          </Kv>
        </dl>
      </Card>
      {canEdit && (
        <Card title="Изменить условия">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Модель вознаграждения" error={errors.feeModel}>
              {(p) => (
                <Select {...p} value={feeModel} onChange={(e) => setFeeModel(e.target.value as FeeModel)}>
                  {Object.entries(FEE_MODEL_LABEL).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label={feeModel === 'percent_of_claims' ? 'Доля (0,07 = 7%)' : 'Сумма, UZS'} error={errors.feeValue}>
              {(p) => <Input {...p} inputMode="decimal" maxLength={14} value={feeValue} onChange={(e) => setFeeValue(e.target.value)} />}
            </Field>
            <Field label="Полномочия по ГП, UZS" error={errors.guaranteeAuthorityLimit} hint={`Пусто — по параметру ДМС (${formatMoney(defaultLimit)})`}>
              {(p) => <Input {...p} inputMode="numeric" maxLength={14} value={limit} onChange={(e) => setLimit(e.target.value)} />}
            </Field>
            <Field label="Срок оплаты счёта, дней" error={errors.rebillPaymentDays}>
              {(p) => <Input {...p} inputMode="numeric" maxLength={3} value={days} onChange={(e) => setDays(e.target.value)} />}
            </Field>
          </div>
          <Button className="mt-3" loading={update.isPending} onClick={() => void save()}>
            Сохранить
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
        <Stat label="Режим" value={INTEGRATION_MODE_LABEL[c.assistance.integrationMode]} />
        <Stat label="Вебхуков" value={c.webhooks.endpoints} />
        <Stat label="Не доставлено за сутки" value={c.webhooks.failed24h} tone={c.webhooks.failed24h ? 'danger' : undefined} />
        <Stat label="Ошибок API за сутки" value={c.apiErrors24h} tone={c.apiErrors24h ? 'warning' : undefined} />
      </div>
      <Card title="Ключи API" bodyClassName="p-0">
        {c.keys.length === 0 ? (
          <EmptyState title="Ключей нет" />
        ) : (
          <ul className="divide-y divide-border-soft">
            {c.keys.map((k) => (
              <li key={k.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                <span className="font-medium">{k.name}</span>
                <code className="text-[12px] text-muted">{k.clientId}</code>
                <span className="min-w-0 flex-1 truncate text-[12px] text-muted">{k.scopes.map((s) => SCOPE_LABEL[s]).join(', ')}</span>
                {k.revokedAt ? (
                  <Chip kind="neutral">Отозван {formatDate(k.revokedAt)}</Chip>
                ) : canRevoke ? (
                  <Button size="sm" variant="ghost" onClick={() => setConfirm(k.id)}>
                    Отозвать
                  </Button>
                ) : (
                  <Chip kind="success">Активен</Chip>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
      <ConfirmDialog
        open={!!confirm}
        onOpenChange={(o) => !o && setConfirm(null)}
        title="Отозвать ключ партнёра?"
        description="Выданные по ключу токены перестанут работать сразу."
        confirmLabel="Отозвать"
        danger
        loading={revoke.isPending}
        onConfirm={async () => {
          try {
            await revoke.mutateAsync({ assistanceId: c.assistance.id, keyId: confirm! });
            toast.success('Ключ отозван');
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
  if (!canRead) return <EmptyState title="Обращения ассистанса видит куратор ДМС" />;
  return (
    <>
      <div className="rounded-card border border-border bg-surface">
        <DataTable
          caption="Обращения ассистанса"
          columns={[
            { key: 'num', header: 'Номер', cell: (x) => <span className="num font-medium">{x.number}</span> },
            { key: 'type', header: 'Тип', cell: (x) => (x.type === 'complaint' ? <Chip kind="danger">{CASE_TYPE_LABEL[x.type]}</Chip> : CASE_TYPE_LABEL[x.type]) },
            { key: 'who', header: 'Застрахованный', cell: (x) => x.insuredName },
            { key: 'text', header: 'Суть', cell: (x) => <span className="line-clamp-1 text-muted">{x.resolution ?? x.description}</span> },
            { key: 'status', header: 'Статус', cell: (x) => <CaseStatus status={x.status} /> },
            { key: 'sla', header: 'SLA', cell: (x) => <SlaBadge dueAt={x.slaDueAt} done={x.status === 'resolved'} /> },
            {
              key: 'actions',
              header: '',
              align: 'right',
              cell: (x) =>
                canComplaint && x.type === 'complaint' && x.status !== 'resolved' ? (
                  <Button size="sm" variant="secondary" onClick={() => setClosing(x)} aria-label={`Закрыть жалобу ${x.number}`}>
                    Закрыть жалобу
                  </Button>
                ) : null,
            },
          ]}
          rows={q.data}
          loading={q.isLoading}
          error={q.error}
          onRetry={() => void q.refetch()}
          rowKey={(x) => x.id}
          empty="Обращений нет"
        />
      </div>
      {closing && (
        <Modal
          open
          onOpenChange={(o) => !o && setClosing(null)}
          title="Закрыть жалобу"
          description={`${closing.number} · ${closing.insuredName}`}
          footer={
            <>
              <Button variant="secondary" onClick={() => setClosing(null)}>
                Отмена
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
                    toast.success('Жалоба закрыта');
                    setClosing(null);
                    setResolution('');
                  } catch (e) {
                    toast.error(errorMessage(e));
                  }
                }}
              >
                Закрыть жалобу
              </Button>
            </>
          }
        >
          <p className="mb-3 rounded-btn bg-rail px-3 py-2 text-[13px]">{closing.description}</p>
          <Field label="Решение МИГ" error={error}>
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
  useDocumentTitle('Ассистанс');
  useTopbar([{ label: 'Ассистансы', to: '/staff/assistance' }, { label: q.data?.assistance.name ?? 'Карточка' }]);
  const [f, setF] = useUrlFilters(['tab'] as const);
  const tab = TABS.some(([k]) => k === f.tab) ? f.tab! : 'overview';
  const canAudit = useCan('audit.read');

  return (
    <QueryState query={q}>
      {(c) => (
        <div>
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <h1 className="text-[22px] font-bold">{c.assistance.name}</h1>
            <Chip kind="accent">{INTEGRATION_MODE_LABEL[c.assistance.integrationMode]}</Chip>
            <span className="text-muted">
              договор {c.assistance.contract.number} · {formatNumber(c.insuredCount)} застрахованных · {c.clients.length} клиентов
            </span>
          </div>
          <Tabs value={tab} onValueChange={(v) => setF({ tab: v === 'overview' ? null : v })}>
            <TabsList>
              {TABS.filter(([k]) => k !== 'audit' || canAudit).map(([k, label]) => (
                <TabsTrigger key={k} value={k}>
                  {label}
                </TabsTrigger>
              ))}
            </TabsList>
            <TabsContent value="overview">
              <div className="flex flex-col gap-4">
                <KpiGrid kpi={c.kpi} />
                <Card title="Требуют внимания куратора: жалобы и нарушения SLA" bodyClassName="p-0">
                  {c.attention.length === 0 ? (
                    <EmptyState title="Всё в порядке" />
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
                  caption="Клиенты ассистанса"
                  columns={[
                    { key: 'name', header: 'Клиент', cell: (x) => <span className="font-medium">{x.name}</span> },
                    { key: 'policy', header: 'Полис', cell: (x) => <span className="num">{x.policyNumber}</span> },
                    { key: 'from', header: 'Закреплён с', cell: (x) => <span className="num">{formatDate(x.from)}</span> },
                    { key: 'count', header: 'Застрахованных', align: 'right', cell: (x) => <span className="num">{x.insuredCount}</span> },
                  ]}
                  rows={c.clients}
                  rowKey={(x) => x.id}
                  onRowClick={(x) => navigate(`/staff/clients/${x.id}`)}
                />
              </div>
            </TabsContent>
            <TabsContent value="cases">
              <CasesTab assistanceId={c.assistance.id} />
            </TabsContent>
            <TabsContent value="users">
              <div className="rounded-card border border-border bg-surface">
                <DataTable
                  caption="Пользователи ассистанса"
                  columns={[
                    { key: 'name', header: 'ФИО', cell: (u) => u.fullName },
                    { key: 'email', header: 'Email', cell: (u) => u.email },
                    { key: 'role', header: 'Роль', cell: (u) => ROLE_LABEL[u.role] },
                    { key: 'login', header: 'Последний вход', cell: (u) => (u.lastLoginAt ? <span className="num">{formatDateTime(u.lastLoginAt)}</span> : '—') },
                    { key: 'active', header: 'Статус', cell: (u) => <Chip kind={u.active ? 'success' : 'neutral'}>{u.active ? 'Активен' : 'Отключён'}</Chip> },
                  ]}
                  rows={c.users}
                  rowKey={(u) => u.id}
                />
              </div>
            </TabsContent>
            <TabsContent value="integration">
              <IntegrationTab c={c} />
            </TabsContent>
            <TabsContent value="rebills">
              <div className="rounded-card border border-border bg-surface">
                <DataTable
                  caption="Счета ассистанса"
                  columns={[
                    { key: 'num', header: 'Номер', cell: (b) => <span className="num font-medium">{b.number}</span> },
                    { key: 'period', header: 'Период', cell: (b) => <span className="num">{b.period}</span> },
                    { key: 'fee', header: 'Вознаграждение', align: 'right', cell: (b) => <span className="num">{formatMoney(b.totals.fee)}</span> },
                    { key: 'total', header: 'Итого', align: 'right', cell: (b) => <span className="num">{formatMoney(b.totals.total)}</span> },
                    { key: 'flags', header: 'С флагами', align: 'right', cell: (b) => <span className="num">{b.flaggedCount}</span> },
                    { key: 'status', header: 'Статус', cell: (b) => <RebillStatus status={b.status} /> },
                  ]}
                  rows={c.rebills}
                  rowKey={(b) => b.id}
                  onRowClick={(b) => navigate(`/staff/rebills/${b.id}`)}
                  empty="Счетов нет"
                />
              </div>
            </TabsContent>
            <TabsContent value="qa">
              <p className="mb-2 text-[13px] text-muted">
                Выборка 5% решений. Расхождения не меняют оплаченные дела, но учитываются в KPI. Оценки ставят врачи-эксперты в разделе{' '}
                <Link className="text-accent-text hover:underline" to="/staff/qa">
                  «Контроль качества»
                </Link>
                .
              </p>
              <div className="rounded-card border border-border bg-surface">
                <DataTable
                  caption="Контроль качества"
                  columns={[
                    { key: 'date', header: 'В выборке с', cell: (s) => <span className="num">{formatDate(s.createdAt)}</span> },
                    { key: 'label', header: 'Решение', cell: (s) => s.subject.label },
                    { key: 'verdict', header: 'Оценка МИГ', cell: (s) => <QaVerdict s={s} /> },
                    { key: 'who', header: 'Врач-эксперт', cell: (s) => s.reviewedByName ?? '—' },
                  ]}
                  rows={c.qa}
                  rowKey={(s) => s.id}
                  empty="Выборка пуста"
                />
              </div>
            </TabsContent>
            {canAudit && (
              <TabsContent value="audit">
                <div className="rounded-card border border-border bg-surface">
                  <DataTable
                    caption="Действия пользователей ассистанса"
                    columns={[
                      { key: 'at', header: 'Время', cell: (e) => <span className="num whitespace-nowrap">{formatDateTime(e.at)}</span> },
                      { key: 'who', header: 'Кто', cell: (e) => `${e.actorName} · ${ROLE_LABEL[e.actorRole]}` },
                      { key: 'what', header: 'Действие', cell: (e) => AUDIT_ACTION_LABEL[e.action] },
                      { key: 'target', header: 'Объект', cell: (e) => e.targetLabel ?? '—' },
                      { key: 'reason', header: 'Причина', cell: (e) => <span className="text-muted">{e.reason ?? ''}</span> },
                    ]}
                    rows={c.audit}
                    rowKey={(e) => e.id}
                    empty="Событий нет"
                  />
                </div>
                <Link className="mt-2 inline-block text-accent-text hover:underline" to={`/staff/audit?assistanceId=${c.assistance.id}`}>
                  Весь журнал по ассистансу
                </Link>
              </TabsContent>
            )}
          </Tabs>
        </div>
      )}
    </QueryState>
  );
}
