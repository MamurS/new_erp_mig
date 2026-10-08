/*
 * «Параметры ДМС»: business parameters in one place. Every MIG role can read them; an admin proposes a
 * change, a second admin or an underwriter confirms it (four-eyes), and only then it applies.
 */
import { LEGAL_FORMS, legalFormFull, legalFormShort } from '@mig/domain/config/legalForms';
import { formBit } from '@mig/domain/config/dmsParameters';
import { defineLabels, t, tm } from '@/i18n';
import { useState } from 'react';
import type { DmsParamChange, DmsParameter, NumberingParameter, ParamKey } from '@mig/contracts';
import { useApproveDmsParam, useDmsParams, useProposeDmsParam, useRejectDmsParam } from '@/shared/api/queries/params';
import { errorMessage } from '@/shared/api/client';
import { can } from '@mig/domain/auth/permissions';
import { useCan } from '@/shared/auth/guards';
import { useUser } from '@/shared/auth/session';
import {
  DMS_PARAM_GROUP_LABEL,
  DMS_PARAM_GROUPS,
  DMS_PARAMETERS,
  DOC_NUMBER_KIND_LABEL,
  dmsUnitLabel,
  formatDmsParam,
  formatParamValue,
  fromDisplayValue,
  numberingExample,
  numberingParamKey,
  paramLabel,
  requiredPlaceholders,
  toDisplayValue,
} from '@mig/domain/config/dmsParameters';
import type { NumberingTemplates } from '@mig/domain/numbering';
import { dmsParamChangeSchema, dmsParamRejectSchema } from '@mig/contracts/forms';
import { formatDateTime } from '@mig/domain/lib/format';
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
import { TableScroll } from '@/shared/ui/table-scroll';

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
        {def.unit !== 'forms' && (
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
        )}
        {def.unit === 'forms' ? (
          <fieldset className="grid gap-1.5 sm:grid-cols-2" data-testid="param-forms">
            <legend className="mb-1 text-[13px] font-medium">{t('staff.params.forms')}</legend>
            {LEGAL_FORMS.map((f) => {
              const mask = Number(value) || 0;
              const on = (mask & formBit(f)) !== 0;
              return (
                <label key={f} className="flex items-center gap-2 text-[13px]">
                  <input type="checkbox" checked={on} onChange={() => setValue(String(on ? mask & ~formBit(f) : mask | formBit(f)))} />
                  <span>
                    <span className="font-medium">{legalFormShort(f)}</span> <span className="text-muted">{legalFormFull(f)}</span>
                  </span>
                </label>
              );
            })}
            {errors.value && <p className="text-[12px] text-danger-text sm:col-span-2">{tm(errors.value)}</p>}
          </fieldset>
        ) : def.options ? (
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
      description={`${paramLabel(c.key)}: ${formatParamValue(c.key, c.from)} → ${formatParamValue(c.key, c.to)}`}
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
                  {paramLabel(c.key)}: <span className="num">{formatParamValue(c.key, c.from)}</span> → <span className="num font-semibold">{formatParamValue(c.key, c.to)}</span>
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
                    aria-label={t('staff.params.confirmAria', { label: paramLabel(c.key) })}
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

/** Templates of the document numbers in force, with a sample number for each. */
function NumberingCard({
  numbering,
  pendingKeys,
  canPropose,
  onEdit,
}: {
  numbering: NumberingParameter[];
  pendingKeys: Set<ParamKey>;
  canPropose: boolean;
  onEdit: (v: { p: NumberingParameter; templates: NumberingTemplates }) => void;
}) {
  const templates = Object.fromEntries(numbering.map((n) => [n.kind, n.value])) as NumberingTemplates;
  return (
    <Card title={t('params.numbering.title')} className="mb-4" bodyClassName="p-0">
      <p className="px-4 pt-3 text-[12px] text-muted">{t('params.numbering.intro')}</p>
      <p className="px-4 pb-2 pt-1 text-[12px] text-muted">{t('params.numbering.placeholders')}</p>
      <table className="w-full text-[13px]" data-testid="numbering-templates">
        <caption className="sr-only">{t('params.numbering.title')}</caption>
        <thead className="border-b border-border-soft text-left text-[12px] text-muted">
          <tr>
            <th className="px-4 py-2 font-medium">{t('params.numbering.colKind')}</th>
            <th className="px-4 py-2 font-medium">{t('params.numbering.colTemplate')}</th>
            <th className="hidden px-4 py-2 font-medium md:table-cell">{t('params.numbering.colExample')}</th>
            {canPropose && <th className="px-4 py-2" aria-label={t('common.actions')} />}
          </tr>
        </thead>
        <tbody className="divide-y divide-border-soft">
          {numbering.map((p) => {
            const label = DOC_NUMBER_KIND_LABEL[p.kind];
            return (
              <tr key={p.kind} data-testid={`numbering-${p.kind}`}>
                <td className="px-4 py-2.5 align-top font-medium">{label}</td>
                <td className="px-4 py-2.5 align-top">
                  <span className="num block whitespace-nowrap font-semibold" data-testid="numbering-template">
                    {p.value}
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
                  <span className="mt-1 block text-[12px] text-muted md:hidden">{t('params.numbering.example', { number: numberingExample(p.kind, p.value, templates) })}</span>
                </td>
                <td className="num hidden whitespace-nowrap px-4 py-2.5 align-top text-muted md:table-cell" data-testid="numbering-example">
                  {numberingExample(p.kind, p.value, templates)}
                </td>
                {canPropose && (
                  <td className="px-4 py-2.5 text-right align-top">
                    {pendingKeys.has(numberingParamKey(p.kind)) ? (
                      <Chip kind="warning">{t('staff.params.pendingChip')}</Chip>
                    ) : (
                      <Button size="sm" variant="secondary" aria-label={t('staff.params.editAria', { label })} onClick={() => onEdit({ p, templates })}>
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
  );
}

function NumberingDialog({ p, templates, onClose }: { p: NumberingParameter; templates: NumberingTemplates; onClose: () => void }) {
  const propose = useProposeDmsParam();
  const [value, setValue] = useState(p.value);
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const key = numberingParamKey(p.kind);
  const example = numberingExample(p.kind, value.trim(), templates);
  const submit = async () => {
    const parsed = dmsParamChangeSchema.safeParse({ key, value, reason });
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])));
      return;
    }
    setErrors({});
    try {
      await propose.mutateAsync({ key, value: parsed.data.value, reason: parsed.data.reason });
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
      title={t('params.numbering.editTitle')}
      description={DOC_NUMBER_KIND_LABEL[p.kind]}
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
      <p className="mb-3 text-[13px] text-muted">{t('params.numbering.placeholders')}</p>
      <div className="grid gap-3">
        <Field label={t('params.numbering.newTemplate')} error={tm(errors.value)} hint={t('params.numbering.required', { required: requiredPlaceholders(p.kind) })}>
          {(a) => <Input {...a} className="num" autoComplete="off" spellCheck={false} maxLength={60} value={value} onChange={(e) => setValue(e.target.value)} />}
        </Field>
        {example && (
          <p className="text-[13px]" data-testid="numbering-preview">
            {t('params.numbering.example', { number: example })}
          </p>
        )}
        <Field label={t('staff.params.basis')} error={tm(errors.reason)} hint={t('staff.params.basisHint')}>
          {(a) => <Textarea {...a} rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />}
        </Field>
        <p className="rounded-btn bg-rail px-3 py-2 text-[12px] text-muted">{t('staff.params.applyNote')}</p>
      </div>
    </Modal>
  );
}

export default function ParametersPage() {
  useDocumentTitle(t('staff.params.title'));
  useTopbar([{ label: t('staff.params.title') }]);
  const q = useDmsParams();
  const canPropose = useCan('dms_params.propose');
  const [editing, setEditing] = useState<DmsParameter | null>(null);
  const [editingNumbering, setEditingNumbering] = useState<{ p: NumberingParameter; templates: NumberingTemplates } | null>(null);

  return (
    <div>
      <div className="mb-3">
        <h1 className="text-[22px] font-bold">{t('staff.params.title')}</h1>
        <p className="text-muted">{t('staff.params.intro')}</p>
      </div>
      <QueryState query={q}>
        {({ parameters, numbering, changes }) => {
          const pending = changes.filter((c) => c.status === 'pending');
          const pendingKeys = new Set<ParamKey>(pending.map((c) => c.key));
          const history = changes.filter((c) => c.status !== 'pending');
          return (
            <>
              <PendingCard changes={pending} />
              {DMS_PARAM_GROUPS.map((group) => (
                <Card key={group} title={DMS_PARAM_GROUP_LABEL[group]} className="mb-4" bodyClassName="p-0">
                  <TableScroll>
                  <table className="w-full text-[13px]">
                    <caption className="sr-only">{DMS_PARAM_GROUP_LABEL[group]}</caption>
                    <thead className="text-left text-[12px] text-muted">
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
                                  <>
                                    <Chip kind="peach" className="mt-1">
                                      {t('staff.params.demo')}
                                    </Chip>
                                    {def.needsMigDecision && (
                                      <Chip kind="warning" className="ml-1 mt-1">
                                        {t('staff.params.needsDecision')}
                                      </Chip>
                                    )}
                                  </>
                                ) : (
                                  <span className="mt-1 block text-[11px] text-muted">
                                    {p.changedAt && formatDateTime(p.changedAt)}
                                    {p.changedByName && ` · ${p.changedByName}`}
                                  </span>
                                )}
                              </td>
                              <td className="hidden whitespace-nowrap px-4 py-2.5 align-top text-muted md:table-cell">
                                {def.unit === 'forms' ? '—' : `${formatDmsParam(p.key, def.min)} — ${formatDmsParam(p.key, def.max)}`}
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
                  </TableScroll>
                </Card>
              ))}
              <NumberingCard numbering={numbering} pendingKeys={pendingKeys} canPropose={canPropose} onEdit={setEditingNumbering} />
              {history.length > 0 && (
                <Card title={t('staff.params.history')} bodyClassName="p-0">
                  <ul className="divide-y divide-border-soft text-[13px]" data-testid="params-history">
                    {history.map((c) => (
                      <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2">
                        <span>
                          {paramLabel(c.key)}: <span className="num">{formatParamValue(c.key, c.from)}</span> → <span className="num">{formatParamValue(c.key, c.to)}</span>
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
      {editingNumbering && <NumberingDialog p={editingNumbering.p} templates={editingNumbering.templates} onClose={() => setEditingNumbering(null)} />}
    </div>
  );
}
