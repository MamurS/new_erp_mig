/*
 * Редактор договора (LIFECYCLE_SPEC §7.3–7.4): parameters and clauses on the left, preview of all pages on
 * the right; status, version and actions on top; signing, invoices, endorsements and versions below.
 */
import { t, tm } from '@/i18n';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Pencil, RotateCcw } from 'lucide-react';
import type { ActivationRule, PaymentFrequency, ProgramCode } from '@/shared/types';
import type { ContractView } from '@/shared/types/dto';
import { useContract, useContractAction, useDocStep, usePatchContract, useTerminate, useUploadInsuredList } from '@/shared/api/queries/lifecycle';
import { errorMessage } from '@/shared/api/client';
import { useCan } from '@/shared/auth/guards';
import { ACTIVATION_RULE_LABEL, CONTRACT_STATUS_CHIP, CONTRACT_STATUS_LABEL, ENDORSEMENT_STATUS_LABEL, INVOICE_STATUS_LABEL, PAYMENT_FREQUENCY_LABEL } from '@/shared/domain/contracts';
import { PROGRAM_LABEL } from '@/shared/domain/labels';
import { POLICY_CSV_HEADER } from '@/shared/domain/policies';
import { clauseOverrideSchema, contractParamsSchema, legalApproveSchema, legalReturnSchema, terminateSchema } from '@/shared/schemas/forms';
import { formatDate, formatDateTime, formatMoney } from '@/shared/lib/format';
import { useDocumentTitle } from '@/shared/lib/hooks';
import { cn } from '@/shared/lib/cn';
import { contractDocument } from '@/features/documents/builders';
import { DocPreview, DocPrintButton, useStubDocument } from '@/features/documents/DocPreview';
import { SigningPanel } from '@/features/documents/SigningPanel';
import { clausesOf, DOC_TEMPLATES } from '@/features/documents/templates';
import { Button } from '@/shared/ui/button';
import { Chip } from '@/shared/ui/chips';
import { Modal } from '@/shared/ui/dialog';
import { Field, Input, Select, Textarea } from '@/shared/ui/input';
import { Card, Kv, PageHeader } from '@/shared/ui/page';
import { QueryState } from '@/shared/ui/states';
import { toast } from '@/shared/ui/toast';
import { useTopbar } from '../topbar';
import { CsvFileButton, ReasonDialog } from './common';
import { TableScroll } from '@/shared/ui/table-scroll';

const PROGRAMS: ProgramCode[] = ['basic', 'standard', 'standard_plus', 'premium'];

async function attempt(fn: () => Promise<unknown>, ok: string): Promise<boolean> {
  try {
    await fn();
    toast.success(ok);
    return true;
  } catch (e) {
    toast.error(errorMessage(e));
    return false;
  }
}

function ParamsForm({ c, editable }: { c: ContractView; editable: boolean }) {
  const patch = usePatchContract();
  const init = () => ({
    startDate: c.params.startDate,
    endDate: c.params.endDate,
    program: c.params.program,
    premiumEmployee: String(c.params.premiumEmployee),
    premiumFamily: String(c.params.premiumFamily),
    paymentFrequency: c.params.paymentFrequency,
    activationRule: c.params.activationRule,
    migSignatoryId: c.params.migSignatoryId,
    signName: c.params.clientSignatory.name,
    signPosition: c.params.clientSignatory.position,
    signBasis: c.params.clientSignatory.basis,
  });
  const [v, setV] = useState(init);
  const [errors, setErrors] = useState<Record<string, string>>({});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => setV(init()), [c]);
  const set = (k: keyof ReturnType<typeof init>) => (e: { target: { value: string } }) => setV((x) => ({ ...x, [k]: e.target.value }));
  const money = (s: string) => Number(s.replace(/\s/g, ''));
  const save = async () => {
    const parsed = contractParamsSchema.safeParse({
      startDate: v.startDate,
      endDate: v.endDate,
      program: v.program,
      premiumEmployee: money(v.premiumEmployee),
      premiumFamily: money(v.premiumFamily),
      paymentFrequency: v.paymentFrequency,
      activationRule: v.activationRule,
      migSignatoryId: v.migSignatoryId,
      clientSignatory: { name: v.signName, position: v.signPosition, basis: v.signBasis },
    });
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [i.path.join('.'), i.message])));
      return;
    }
    setErrors({});
    await attempt(() => patch.mutateAsync({ id: c.id, body: { params: parsed.data } }), t('staffLc.contract.paramsSaved'));
  };
  const dis = !editable;
  return (
    <Card title={t('staffLc.contract.params')} actions={editable && <Button size="sm" loading={patch.isPending} onClick={() => void save()}>{t('common.save')}</Button>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t('common.start')} error={tm(errors.startDate) || undefined}>
          {(a) => <Input {...a} type="date" disabled={dis} value={v.startDate} onChange={set('startDate')} />}
        </Field>
        <Field label={t('common.end')} error={tm(errors.endDate) || undefined}>
          {(a) => <Input {...a} type="date" disabled={dis} value={v.endDate} onChange={set('endDate')} />}
        </Field>
        <Field label={t('common.program')} error={tm(errors.program) || undefined}>
          {(a) => (
            <Select {...a} disabled={dis} value={v.program} onChange={set('program')}>
              {PROGRAMS.map((p) => (
                <option key={p} value={p}>
                  {PROGRAM_LABEL[p]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t('staffLc.contract.activation')} error={tm(errors.activationRule) || undefined}>
          {(a) => (
            <Select {...a} disabled={dis} value={v.activationRule} onChange={set('activationRule')}>
              {(Object.keys(ACTIVATION_RULE_LABEL) as ActivationRule[]).map((r) => (
                <option key={r} value={r}>
                  {ACTIVATION_RULE_LABEL[r]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t('staffLc.contract.premiumEmployee', { n: c.params.employees })} error={tm(errors.premiumEmployee) || undefined}>
          {(a) => <Input {...a} inputMode="numeric" maxLength={13} disabled={dis} value={v.premiumEmployee} onChange={set('premiumEmployee')} />}
        </Field>
        <Field label={t('staffLc.contract.premiumFamily', { n: c.params.familyMembers })} error={tm(errors.premiumFamily) || undefined}>
          {(a) => <Input {...a} inputMode="numeric" maxLength={13} disabled={dis} value={v.premiumFamily} onChange={set('premiumFamily')} />}
        </Field>
        <Field label={t('staffLc.contract.paymentFrequency')} error={tm(errors.paymentFrequency) || undefined}>
          {(a) => (
            <Select {...a} disabled={dis} value={v.paymentFrequency} onChange={set('paymentFrequency')}>
              {(Object.keys(PAYMENT_FREQUENCY_LABEL) as PaymentFrequency[]).map((r) => (
                <option key={r} value={r}>
                  {PAYMENT_FREQUENCY_LABEL[r]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t('staffLc.contract.migSignatory')} error={tm(errors.migSignatoryId) || undefined}>
          {(a) => (
            <Select {...a} disabled={dis} value={v.migSignatoryId} onChange={set('migSignatoryId')}>
              {c.signatories.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.fullName} — {s.basis}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t('staffLc.contract.clientSignatory')} error={tm(errors['clientSignatory.name']) || undefined}>
          {(a) => <Input {...a} maxLength={120} disabled={dis} value={v.signName} onChange={set('signName')} />}
        </Field>
        <Field label={t('common.position')} error={tm(errors['clientSignatory.position']) || undefined}>
          {(a) => <Input {...a} maxLength={120} disabled={dis} value={v.signPosition} onChange={set('signPosition')} />}
        </Field>
        <Field label={t('staffLc.deals.directorBasis')} className="sm:col-span-2" error={tm(errors['clientSignatory.basis']) || undefined}>
          {(a) => <Input {...a} maxLength={120} disabled={dis} value={v.signBasis} onChange={set('signBasis')} />}
        </Field>
      </div>
      <dl className="mt-3 border-t border-border-soft pt-2 text-[13px]">
        <Kv label={t('staffLc.contract.totalPremium')}>
          <span className="num font-semibold">{formatMoney(c.params.total)}</span>
        </Kv>
        {c.quote && (
          <Kv label={t('staffLc.contract.byQuote')}>
            <span className="num">
              {formatMoney(c.quote.premiumEmployee)} / {formatMoney(c.quote.premiumFamily)}
            </span>
          </Kv>
        )}
        <Kv label={t('staffLc.contract.schedule')}>
          <span className="num">{c.params.paymentSchedule.map((p) => `${formatDate(p.dueDate)} — ${formatMoney(p.amount)}`).join('; ')}</span>
        </Kv>
      </dl>
    </Card>
  );
}

function Clauses({ c, editable }: { c: ContractView; editable: boolean }) {
  const patch = usePatchContract();
  const [edit, setEdit] = useState<{ id: string; title: string; text: string } | null>(null);
  const [error, setError] = useState<string>();
  const overrides = new Map(c.clauseOverrides.map((o) => [o.clauseId, o]));
  const sections = DOC_TEMPLATES.contract.sections.filter((s) => s.clauses.length);
  const body = (next: Map<string, string>) => ({ clauseOverrides: [...next].map(([clauseId, text]) => ({ clauseId, text })) });
  const current = () => new Map(c.clauseOverrides.map((o) => [o.clauseId, o.text]));
  const save = async () => {
    if (!edit) return;
    const parsed = clauseOverrideSchema.safeParse({ clauseId: edit.id, text: edit.text });
    if (!parsed.success) {
      setError(tm(parsed.error.issues[0]?.message) || undefined);
      return;
    }
    const next = current();
    next.set(parsed.data.clauseId, parsed.data.text);
    if (await attempt(() => patch.mutateAsync({ id: c.id, body: body(next) }), t('staffLc.contract.clauseChanged', { id: edit.id }))) setEdit(null);
  };
  const reset = async (id: string) => {
    const next = current();
    next.delete(id);
    await attempt(() => patch.mutateAsync({ id: c.id, body: body(next) }), t('staffLc.contract.clauseReset', { id }));
  };
  const all = clausesOf('contract');
  return (
    <Card title={c.clauseOverrides.length ? t('staffLc.contract.clausesChanged', { n: c.clauseOverrides.length }) : t('staffLc.contract.clauses')} bodyClassName="p-0">
      <p className="border-b border-border-soft px-4 py-2 text-[12px] text-muted">{t('staffLc.contract.clausesNote')}</p>
      <div className="max-h-[520px] overflow-y-auto">
        {sections.map((s) => (
          <div key={s.id}>
            <p className="bg-rail/60 px-4 py-1.5 text-[12px] font-semibold">{s.title}</p>
            <ul className="divide-y divide-border-soft">
              {s.clauses.map((cl) => {
                const o = overrides.get(cl.id);
                return (
                  <li key={cl.id} className={cn('px-4 py-2 text-[13px]', o && 'bg-warning-soft/60')} data-testid={`clause-${cl.id}`}>
                    <div className="flex items-start justify-between gap-2">
                      <p>
                        <span className="num mr-1.5 text-muted">{cl.id}</span>
                        {cl.title}
                        {o && <Chip kind="warning" className="ml-2">{t('staffLc.contract.changedChip')}</Chip>}
                      </p>
                      {editable && (
                        <span className="flex shrink-0 gap-1">
                          {o && (
                            <Button size="sm" variant="ghost" aria-label={t('staffLc.contract.resetClauseAria', { id: cl.id })} onClick={() => void reset(cl.id)}>
                              <RotateCcw className="h-3.5 w-3.5" aria-hidden />
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="ghost"
                            aria-label={t('staffLc.contract.editClauseAria', { id: cl.id })}
                            onClick={() => {
                              setError(undefined);
                              setEdit({ id: cl.id, title: cl.title, text: o?.text ?? all.find((x) => x.id === cl.id)?.text ?? '' });
                            }}
                          >
                            <Pencil className="h-3.5 w-3.5" aria-hidden /> {t('staffLc.contract.editClause')}
                          </Button>
                        </span>
                      )}
                    </div>
                    {o && (
                      <div className="mt-1 grid gap-1 text-[12px]">
                        <p>
                          <span className="font-medium">{t('staffLc.contract.newWording')}</span> {o.text}
                        </p>
                        <p className="text-muted">
                          <span className="font-medium">{t('staffLc.contract.originalText')}</span> {o.original}
                        </p>
                        <p className="text-muted">
                          {o.byName ?? '—'}, {formatDateTime(o.at)}
                        </p>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
      {edit && (
        <Modal
          open
          wide
          onOpenChange={(o) => !o && setEdit(null)}
          title={t('staffLc.contract.clauseTitle', { id: edit.id, title: edit.title })}
          description={t('staffLc.contract.clauseDesc')}
          footer={
            <>
              <Button variant="secondary" onClick={() => setEdit(null)}>
                {t('common.cancel')}
              </Button>
              <Button loading={patch.isPending} onClick={() => void save()}>
                {t('staffLc.contract.saveWording')}
              </Button>
            </>
          }
        >
          <Field label={t('staffLc.contract.wording')} error={error}>
            {(a) => <Textarea {...a} rows={8} maxLength={4000} value={edit.text} onChange={(e) => setEdit({ ...edit, text: e.target.value })} />}
          </Field>
        </Modal>
      )}
    </Card>
  );
}

function InsuredList({ c, editable }: { c: ContractView; editable: boolean }) {
  const upload = useUploadInsuredList();
  return (
    <Card title={c.insuredCount ? t('staffLc.contract.annex2Count', { n: c.insuredCount }) : t('staffLc.contract.annex2')}>
      <p className="text-[13px] text-muted">
        {t('staffLc.contract.annex2Help', { columns: POLICY_CSV_HEADER.join(', ') })}
      </p>
      {editable && (
        <div className="mt-2">
          <CsvFileButton
            label={c.insuredCount ? t('staffLc.contract.replaceList') : t('staffLc.contract.uploadList')}
            ariaLabel={t('staffLc.contract.annex2File')}
            busy={upload.isPending}
            maxBytes={5 * 1024 * 1024}
            onText={(csv) => void attempt(() => upload.mutateAsync({ id: c.id, csv }), t('staffLc.contract.annex2Uploaded'))}
          />
        </div>
      )}
    </Card>
  );
}

function Finance({ c }: { c: ContractView }) {
  const navigate = useNavigate();
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title={t('staffLc.contract.invoices')} bodyClassName="p-0">
        {c.invoices.length ? (
          <TableScroll>
          <table className="w-full text-[13px]" data-testid="contract-invoices">
            <caption className="sr-only">{t('staffLc.contract.invoicesCaption')}</caption>
            <thead>
              <tr className="text-left text-[12px] text-muted">
                <th className="px-4 py-2 font-medium">{t('staffLc.contract.invoice')}</th>
                <th className="px-2 py-2 font-medium">{t('staffLc.contract.due')}</th>
                <th className="px-2 py-2 text-right font-medium">{t('common.amount')}</th>
                <th className="px-4 py-2 font-medium">{t('common.status')}</th>
              </tr>
            </thead>
            <tbody>
              {c.invoices.map((i) => (
                <tr key={i.id} className="border-b border-border-soft">
                  <td className="num px-4 py-1.5">{i.number}</td>
                  <td className="num px-2 py-1.5">{formatDate(i.dueDate)}</td>
                  <td className="num px-2 py-1.5 text-right">
                    {formatMoney(i.amount)}
                    {!!i.paid && i.paid < i.amount && <span className="block text-[12px] text-muted">{t('staffLc.contract.paid', { amount: formatMoney(i.paid) })}</span>}
                  </td>
                  <td className="px-4 py-1.5">{INVOICE_STATUS_LABEL[i.status]}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </TableScroll>
        ) : (
          <p className="px-4 py-3 text-[13px] text-muted">{t('staffLc.contract.invoicesNote')}</p>
        )}
      </Card>
      <Card title={t('staffLc.contract.endorsements')} bodyClassName="p-0">
        {c.endorsements.length ? (
          <ul className="divide-y divide-border-soft text-[13px]">
            {c.endorsements.map((e) => (
              <li key={e.id} className="flex items-center justify-between gap-2 px-4 py-2">
                <button type="button" className="text-left text-accent-text hover:underline" onClick={() => navigate(`/staff/endorsements/${e.id}`)}>
                  {e.number} {e.kind === 'termination' && t('staffLc.contract.terminationSuffix')}
                </button>
                <span className="flex items-center gap-2">
                  <span className="num">{formatMoney(e.total)}</span>
                  <Chip>{ENDORSEMENT_STATUS_LABEL[e.status]}</Chip>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-4 py-3 text-[13px] text-muted">{t('staffLc.contract.none')}</p>
        )}
      </Card>
    </div>
  );
}

function TerminateDialog({ c, onClose }: { c: ContractView; onClose: () => void }) {
  const terminate = useTerminate();
  const navigate = useNavigate();
  const [date, setDate] = useState('');
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const submit = async () => {
    const parsed = terminateSchema.safeParse({ date, reason });
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [i.path.join('.'), i.message])));
      return;
    }
    try {
      const e = await terminate.mutateAsync({ id: c.id, ...parsed.data });
      toast.success(t('staffLc.contract.terminationPrepared', { number: e.number }));
      navigate(`/staff/endorsements/${e.id}`);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('staffLc.contract.terminateTitle')}
      description={t('staffLc.contract.terminateDesc')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="danger" loading={terminate.isPending} onClick={() => void submit()}>
            {t('staffLc.contract.prepareAgreement')}
          </Button>
        </>
      }
    >
      <div className="grid gap-3">
        <Field label={t('staffLc.contract.terminationDate')} error={tm(errors.date) || undefined}>
          {(a) => <Input {...a} type="date" value={date} min={c.params.startDate} max={c.params.endDate} onChange={(e) => setDate(e.target.value)} />}
        </Field>
        <Field label={t('common.reason')} error={tm(errors.reason) || undefined}>
          {(a) => <Textarea {...a} rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />}
        </Field>
      </div>
    </Modal>
  );
}

function ContractEditor({ c }: { c: ContractView }) {
  const step = useDocStep();
  const action = useContractAction();
  const canDraft = useCan('contracts.draft');
  const canLegal = useCan('contracts.legal_approve');
  const canFinance = useCan('quotes.calculate');
  const canTerminate = useCan('endorsements.manage') && canDraft;
  const [dialog, setDialog] = useState<'legal-approve' | 'legal-return' | 'terminate' | null>(null);
  const editable = canDraft && c.status === 'draft';
  const input = useMemo(() => contractDocument(c, { showChanges: true }), [c]);
  const doc = useStubDocument(input);
  const financePending = !!c.financeDiffers && !c.financeApprovedByName;
  const signingStage = ['approved', 'sent', 'signing', 'signed', 'active', 'terminated', 'expired'].includes(c.status);

  return (
    <>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            {t('common.contract')} <span className="num">{c.number}</span>
            <Chip kind={CONTRACT_STATUS_CHIP[c.status]}>{CONTRACT_STATUS_LABEL[c.status]}</Chip>
            <Chip>{t('staffLc.contract.versionChip', { n: c.version })}</Chip>
          </span>
        }
        subtitle={
          <span>
            <Link to={`/staff/clients/${c.clientId}`} className="text-accent-text hover:underline">
              {c.clientName}
            </Link>{' '}
            {t('staffLc.contract.dealSep')}{' '}
            <Link to={`/staff/deals/${c.dealId}`} className="num text-accent-text hover:underline">
              {c.dealNumber}
            </Link>
            {c.policyId && (
              <>
                {' '}
                ·{' '}
                <Link to={`/staff/policies/${c.policyId}`} className="text-accent-text hover:underline">
                  {t('staffLc.contract.policyLink')}
                </Link>
              </>
            )}
          </span>
        }
        actions={
          <>
            <DocPrintButton input={() => contractDocument(c)} />
            {canFinance && financePending && (
              <Button variant="secondary" loading={action.isPending} onClick={() => void attempt(() => action.mutateAsync({ id: c.id, action: 'finance-approve' }), t('staffLc.contract.financeApproved'))}>
                {t('staffLc.contract.approveFinance')}
              </Button>
            )}
            {canDraft && c.status === 'draft' && (
              <Button
                disabled={financePending}
                loading={step.isPending}
                onClick={() =>
                  void attempt(
                    () => step.mutateAsync({ kind: 'contracts', id: c.id, step: 'submit-legal' }),
                    c.clauseOverrides.length ? t('staffLc.contract.sentToLawyer') : t('staffLc.contract.approvedWithoutLawyer'),
                  )
                }
              >
                {t('staffLc.quote.submitForApproval')}
              </Button>
            )}
            {canLegal && c.status === 'legal_review' && (
              <>
                <Button variant="secondary" onClick={() => setDialog('legal-return')}>
                  {t('staffLc.contract.returnWithComment')}
                </Button>
                <Button onClick={() => setDialog('legal-approve')}>{t('staffLc.quote.agree')}</Button>
              </>
            )}
            {canDraft && c.status === 'approved' && (
              <Button loading={step.isPending} onClick={() => void attempt(() => step.mutateAsync({ kind: 'contracts', id: c.id, step: 'send' }), t('staffLc.contract.sentToClient'))}>
                {t('staffLc.contract.sendToClient')}
              </Button>
            )}
            {canDraft && ['approved', 'sent', 'signing'].includes(c.status) && (
              <Button variant="secondary" loading={action.isPending} onClick={() => void attempt(() => action.mutateAsync({ id: c.id, action: 'new-version' }), t('staffLc.contract.newVersionCreated'))}>
                {t('staffLc.contract.newVersion')}
              </Button>
            )}
            {canTerminate && c.status === 'active' && (
              <Button variant="secondary" onClick={() => setDialog('terminate')}>
                {t('staffLc.contract.terminate')}
              </Button>
            )}
          </>
        }
      />
      {financePending && (
        <p role="status" className="mb-3 rounded-card bg-warning-soft px-3 py-2 text-[13px] text-warning-text">
          {t('staffLc.contract.financeDiffers')}
        </p>
      )}
      {c.legalComment && c.status === 'draft' && (
        <p role="status" className="mb-3 rounded-card bg-danger-soft px-3 py-2 text-[13px] text-danger-text" data-testid="legal-comment">
          {t('staffLc.contract.lawyerReturned', { comment: c.legalComment })}
        </p>
      )}
      {c.originalOverdue && <p className="mb-3 rounded-card bg-warning-soft px-3 py-2 text-[13px] text-warning-text">{t('staffLc.contract.originalOverdue')}</p>}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-4">
          <ParamsForm c={c} editable={editable} />
          <Clauses c={c} editable={editable} />
          <InsuredList c={c} editable={editable} />
        </div>
        <div className="min-w-0">{doc && <DocPreview doc={doc} label={t('staffLc.contract.preview')} className="sticky top-16" />}</div>
      </div>
      {signingStage && (
        <div className="mt-4">
          <SigningPanel kind="contracts" doc={c} mode="staff" printInput={() => contractDocument(c)} />
        </div>
      )}
      <div className="mt-4">
        <Finance c={c} />
      </div>
      <div className="mt-4">
        <Card title={t('staffLc.contract.versions')} bodyClassName="p-0">
          <ol className="divide-y divide-border-soft text-[13px]" data-testid="contract-versions">
            {[...c.versions].reverse().map((v, i) => (
              <li key={`${v.at}-${i}`} className="flex flex-wrap justify-between gap-2 px-4 py-2">
                <span>
                  <span className="num mr-2 text-muted">{t('staffLc.contract.versionShort', { n: v.version })}</span>
                  {tm(v.changes)}
                </span>
                <span className="text-muted">
                  {v.byName} · <span className="num">{formatDateTime(v.at)}</span>
                </span>
              </li>
            ))}
          </ol>
        </Card>
      </div>
      <ReasonDialog
        open={dialog === 'legal-approve'}
        onClose={() => setDialog(null)}
        title={t('staffLc.contract.legalApproveTitle')}
        description={t('staffLc.contract.legalApproveDesc')}
        label={t('staffLc.quote.commentOptional')}
        field="comment"
        optional
        schema={legalApproveSchema}
        confirmLabel={t('staffLc.quote.agree')}
        onSubmit={(comment) => step.mutateAsync({ kind: 'contracts', id: c.id, step: 'legal-approve', body: { comment: comment || undefined } })}
      />
      <ReasonDialog
        open={dialog === 'legal-return'}
        onClose={() => setDialog(null)}
        title={t('staffLc.contract.legalReturnTitle')}
        description={t('staffLc.contract.legalReturnDesc')}
        label={t('common.comment')}
        field="comment"
        schema={legalReturnSchema}
        confirmLabel={t('staffLc.contract.return')}
        danger
        onSubmit={(comment) => step.mutateAsync({ kind: 'contracts', id: c.id, step: 'legal-return', body: { comment } })}
      />
      {dialog === 'terminate' && <TerminateDialog c={c} onClose={() => setDialog(null)} />}
    </>
  );
}

export default function ContractPage() {
  const { contractId = '' } = useParams();
  const [poll, setPoll] = useState(false);
  const q = useContract(contractId, { poll });
  useEffect(() => setPoll(!!q.data?.signing.edoPending), [q.data?.signing.edoPending]);
  useDocumentTitle(q.data ? t('staffLc.contract.titleNumber', { number: q.data.number }) : t('common.contract'));
  useTopbar([{ label: t('staffLc.contracts.title'), to: '/staff/contracts' }, { label: q.data?.number ?? t('common.contract') }]);
  return <QueryState query={q}>{(c) => <ContractEditor c={c} />}</QueryState>;
}
