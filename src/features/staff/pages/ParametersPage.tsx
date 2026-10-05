/*
 * «Параметры ДМС»: business parameters in one place. Every MIG role can read them; an admin proposes a
 * change, a second admin or an underwriter confirms it (four-eyes), and only then it applies.
 */
import { defineLabels, t, tm } from '@/i18n';
import { useState } from 'react';
import type { DmsParamChange, DmsParameter, DmsParamKey } from '@/shared/types';
import { useApproveDmsParam, useDmsParams, useProposeDmsParam, useRejectDmsParam } from '@/shared/api/queries/params';
import { errorMessage } from '@/shared/api/client';
import { can } from '@/shared/auth/permissions';
import { useCan } from '@/shared/auth/guards';
import { useUser } from '@/shared/auth/session';
import { DMS_PARAM_GROUPS, DMS_PARAMETERS, dmsUnitLabel, formatDmsParam, fromDisplayValue, toDisplayValue } from '@/shared/config/dmsParameters';
import { dmsParamChangeSchema, dmsParamRejectSchema } from '@/shared/schemas/forms';
import { formatDateTime } from '@/shared/lib/format';
import { useDocumentTitle } from '@/shared/lib/hooks';
import { Button } from '@/shared/ui/button';
import { Chip } from '@/shared/ui/chips';
import { Modal } from '@/shared/ui/dialog';
import { Field, Input, Select, Textarea } from '@/shared/ui/input';
import { Card } from '@/shared/ui/page';
import { QueryState } from '@/shared/ui/states';
import { toast } from '@/shared/ui/toast';
import { Rich } from '../components/rich';
import { useTopbar } from '../topbar';

const STATUS_TONE: Record<DmsParamChange['status'], string> = { pending: 'warning', applied: 'success', rejected: 'neutral' };
const STATUS_LABEL = defineLabels('staff.params.status', ['pending', 'applied', 'rejected']);

function ProposeDialog({ p, onClose }: { p: DmsParameter; onClose: () => void }) {
  const def = DMS_PARAMETERS[p.key];
  const propose = useProposeDmsParam();
  const [value, setValue] = useState(String(toDisplayValue(p.key, p.value)).replace('.', ','));
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const unit = def.unit === 'uzs' ? t('staff.params.unitUzs') : dmsUnitLabel(def.unit);
  const submit = async () => {
    const parsed = dmsParamChangeSchema.safeParse({ key: p.key, value: fromDisplayValue(p.key, Number(value.replace(/\s/g, '').replace(',', '.'))), reason });
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])));
      return;
    }
    setErrors({});
    try {
      await propose.mutateAsync({ key: p.key, value: parsed.data.value, reason: parsed.data.reason });
      toast.success(t('staff.params.sent'));
      onClose();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('staff.params.editTitle')}
      description={def.label}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button loading={propose.isPending} onClick={() => void submit()}>
            {t('staff.params.sendForApproval')}
          </Button>
        </>
      }
    >
      <p className="mb-3 text-[13px] text-muted">{def.description}</p>
      <div className="grid gap-3">
        <p className="text-[13px]">
          <Rich
            k="staff.params.current"
            values={{
              value: <span className="num font-semibold">{formatDmsParam(p.key, p.value)}</span>,
              min: formatDmsParam(p.key, def.min),
              max: formatDmsParam(p.key, def.max),
            }}
          />
        </p>
        {def.options ? (
          <Field label={t('staff.params.newValue')} error={tm(errors.value)}>
            {(a) => (
              <Select {...a} value={value} onChange={(e) => setValue(e.target.value)}>
                {def.options?.map((o, i) => (
                  <option key={o} value={String(i)}>
                    {o}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        ) : (
          <Field label={unit ? t('staff.params.newValueUnit', { unit }) : t('staff.params.newValue')} error={tm(errors.value)}>
            {(a) => <Input {...a} inputMode="decimal" maxLength={16} value={value} onChange={(e) => setValue(e.target.value)} />}
          </Field>
        )}
        <Field label={t('staff.params.basis')} error={tm(errors.reason)} hint={t('staff.params.basisHint')}>
          {(a) => <Textarea {...a} rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />}
        </Field>
        <p className="rounded-btn bg-rail px-3 py-2 text-[12px] text-muted">
          {t('staff.params.applyNote')}
        </p>
      </div>
    </Modal>
  );
}

function RejectDialog({ c, own, onClose }: { c: DmsParamChange; own: boolean; onClose: () => void }) {
  const reject = useRejectDmsParam();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string>();
  const label = own ? t('staff.params.withdrawProposal') : t('staff.params.rejectChange');
  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title={label}
      description={`${DMS_PARAMETERS[c.key].label}: ${formatDmsParam(c.key, c.from)} → ${formatDmsParam(c.key, c.to)}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            loading={reject.isPending}
            onClick={async () => {
              const parsed = dmsParamRejectSchema.safeParse({ reason });
              if (!parsed.success) {
                setError(parsed.error.issues[0]?.message);
                return;
              }
              try {
                await reject.mutateAsync({ id: c.id, reason: parsed.data.reason });
                toast.success(own ? t('staff.params.withdrawn') : t('staff.params.rejected'));
                onClose();
              } catch (e) {
                toast.error(errorMessage(e));
              }
            }}
          >
            {label}
          </Button>
        </>
      }
    >
      <Field label={t('common.reason')} error={tm(error)}>
        {(a) => <Textarea {...a} rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />}
      </Field>
    </Modal>
  );
}

function PendingCard({ changes }: { changes: DmsParamChange[] }) {
  const user = useUser()!;
  const approve = useApproveDmsParam();
  const [rejecting, setRejecting] = useState<DmsParamChange | null>(null);
  if (changes.length === 0) return null;
  return (
    <Card title={t('staff.params.pendingTitle')} className="mb-4">
      <ul className="flex flex-col divide-y divide-border-soft" data-testid="pending-params">
        {changes.map((c) => {
          const own = c.proposedById === user.id;
          const canApprove = can(user, 'dms_params.approve', { createdById: c.proposedById });
          const canReject = can(user, 'dms_params.approve');
          return (
            <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
              <div className="min-w-0">
                <p className="font-medium">
                  {DMS_PARAMETERS[c.key].label}: <span className="num">{formatDmsParam(c.key, c.from)}</span> → <span className="num font-semibold">{formatDmsParam(c.key, c.to)}</span>
                </p>
                <p className="text-[12px] text-muted">
                  {t('staff.params.proposedBy', { name: c.proposedByName, at: formatDateTime(c.proposedAt) })} · {c.reason}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {own && <Chip kind="warning">{t('staff.params.needSecond')}</Chip>}
                {canApprove && (
                  <Button
                    size="sm"
                    aria-label={t('staff.params.confirmAria', { label: DMS_PARAMETERS[c.key].label })}
                    loading={approve.isPending && approve.variables === c.id}
                    onClick={async () => {
                      try {
                        await approve.mutateAsync(c.id);
                        toast.success(t('staff.params.applied'));
                      } catch (e) {
                        toast.error(errorMessage(e));
                      }
                    }}
                  >
                    {t('common.confirm')}
                  </Button>
                )}
                {canReject && (
                  <Button size="sm" variant="secondary" onClick={() => setRejecting(c)}>
                    {own ? t('common.revoke') : t('common.reject')}
                  </Button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {rejecting && <RejectDialog c={rejecting} own={rejecting.proposedById === user.id} onClose={() => setRejecting(null)} />}
    </Card>
  );
}

export default function ParametersPage() {
  useDocumentTitle(t('staff.params.title'));
  useTopbar([{ label: t('staff.params.title') }]);
  const q = useDmsParams();
  const canPropose = useCan('dms_params.propose');
  const [editing, setEditing] = useState<DmsParameter | null>(null);

  return (
    <div>
      <div className="mb-3">
        <h1 className="text-[22px] font-bold">{t('staff.params.title')}</h1>
        <p className="text-muted">{t('staff.params.intro')}</p>
      </div>
      <QueryState query={q}>
        {({ parameters, changes }) => {
          const pending = changes.filter((c) => c.status === 'pending');
          const pendingKeys = new Set<DmsParamKey>(pending.map((c) => c.key));
          const history = changes.filter((c) => c.status !== 'pending');
          return (
            <>
              <PendingCard changes={pending} />
              {DMS_PARAM_GROUPS.map((group) => (
                <Card key={group} title={group} className="mb-4" bodyClassName="p-0">
                  <table className="w-full text-[13px]">
                    <caption className="sr-only">{group}</caption>
                    <thead className="border-b border-border-soft text-left text-[12px] text-muted">
                      <tr>
                        <th className="px-4 py-2 font-medium">{t('staff.params.colParam')}</th>
                        <th className="px-4 py-2 text-right font-medium">{t('staff.params.colValue')}</th>
                        <th className="hidden px-4 py-2 font-medium md:table-cell">{t('staff.params.colAllowed')}</th>
                        {canPropose && <th className="px-4 py-2" aria-label={t('common.actions')} />}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border-soft">
                      {parameters
                        .filter((p) => DMS_PARAMETERS[p.key].group === group)
                        .map((p) => {
                          const def = DMS_PARAMETERS[p.key];
                          return (
                            <tr key={p.key} data-testid={`param-${p.key}`}>
                              <td className="px-4 py-2.5 align-top">
                                <span className="block font-medium">{def.label}</span>
                                <span className="block text-[12px] text-muted">{def.description}</span>
                              </td>
                              <td className="px-4 py-2.5 text-right align-top">
                                <span className="num block whitespace-nowrap font-semibold" data-testid="param-value">
                                  {formatDmsParam(p.key, p.value)}
                                </span>
                                {p.isDemo ? (
                                  <Chip kind="peach" className="mt-1">
                                    {t('staff.params.demo')}
                                  </Chip>
                                ) : (
                                  <span className="mt-1 block text-[11px] text-muted">
                                    {p.changedAt && formatDateTime(p.changedAt)}
                                    {p.changedByName && ` · ${p.changedByName}`}
                                  </span>
                                )}
                              </td>
                              <td className="hidden whitespace-nowrap px-4 py-2.5 align-top text-muted md:table-cell">
                                {formatDmsParam(p.key, def.min)} — {formatDmsParam(p.key, def.max)}
                              </td>
                              {canPropose && (
                                <td className="px-4 py-2.5 text-right align-top">
                                  {pendingKeys.has(p.key) ? (
                                    <Chip kind="warning">{t('staff.params.pendingChip')}</Chip>
                                  ) : (
                                    <Button size="sm" variant="secondary" aria-label={t('staff.params.editAria', { label: def.label })} onClick={() => setEditing(p)}>
                                      {t('common.edit')}
                                    </Button>
                                  )}
                                </td>
                              )}
                            </tr>
                          );
                        })}
                    </tbody>
                  </table>
                </Card>
              ))}
              {history.length > 0 && (
                <Card title={t('staff.params.history')} bodyClassName="p-0">
                  <ul className="divide-y divide-border-soft text-[13px]" data-testid="params-history">
                    {history.map((c) => (
                      <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2">
                        <span>
                          {DMS_PARAMETERS[c.key].label}: <span className="num">{formatDmsParam(c.key, c.from)}</span> → <span className="num">{formatDmsParam(c.key, c.to)}</span>
                          <span className="block text-[12px] text-muted">
                            {t('staff.params.proposedBy', { name: c.proposedByName, at: formatDateTime(c.proposedAt) })}
                            {c.decidedByName &&
                              `${t(c.status === 'applied' ? 'staff.params.decidedApplied' : 'staff.params.decidedRejected', { name: c.decidedByName })}${c.decidedAt ? `, ${formatDateTime(c.decidedAt)}` : ''}`}
                            {c.rejectReason && ` · ${c.rejectReason}`}
                          </span>
                        </span>
                        <Chip kind={STATUS_TONE[c.status]}>{STATUS_LABEL[c.status]}</Chip>
                      </li>
                    ))}
                  </ul>
                </Card>
              )}
            </>
          );
        }}
      </QueryState>
      {editing && <ProposeDialog p={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}
