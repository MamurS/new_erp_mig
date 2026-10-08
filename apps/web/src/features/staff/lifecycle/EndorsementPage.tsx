/* Доп. соглашение (LIFECYCLE_SPEC §11–12): calculation per line with its formula, preview, approval and signing. */
import { SideColumn } from '@/shared/ui/side-column';
import { StickySectionsCtx } from '@/shared/ui/sticky-sections';
import { t, tm } from '@/i18n';
import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Pencil, RotateCcw } from 'lucide-react';
import type { EndorsementView } from '@mig/contracts/dto';
import { useApproveEndorsementAmounts, useDocStep, useEndorsement, usePatchEndorsement } from '@/shared/api/queries/lifecycle';
import { errorMessage } from '@/shared/api/client';
import { useCan } from '@/shared/auth/guards';
import { ENDORSEMENT_STATUS_LABEL } from '@mig/domain/contracts';
import { clauseOverrideSchema, legalApproveSchema, legalReturnSchema } from '@mig/contracts/forms';
import { formatDate, formatMoney } from '@mig/domain/lib/format';
import { useDocumentTitle } from '@/shared/lib/hooks';
import { cn } from '@/shared/lib/cn';
import { endorsementDocument } from '@/features/documents/builders';
import { DocPreview, DocPrintButton, useStubDocument } from '@/features/documents/DocPreview';
import { SigningPanel } from '@/features/documents/SigningPanel';
import { clausesOf } from '@mig/domain/documents/templates/index';
import { Button } from '@/shared/ui/button';
import { Chip } from '@/shared/ui/chips';
import { Modal } from '@/shared/ui/dialog';
import { Field, Textarea } from '@/shared/ui/input';
import { Card, PageHeader } from '@/shared/ui/page';
import { QueryState } from '@/shared/ui/states';
import { toast } from '@/shared/ui/toast';
import { useTopbar } from '../topbar';
import { ReasonDialog } from './common';
import { TableScroll } from '@/shared/ui/table-scroll';

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

function EndorsementClauses({ e, editable }: { e: EndorsementView; editable: boolean }) {
  const patch = usePatchEndorsement();
  const [edit, setEdit] = useState<{ id: string; title: string; text: string } | null>(null);
  const [error, setError] = useState<string>();
  const overrides = new Map(e.clauseOverrides.map((o) => [o.clauseId, o]));
  const save = async (next: Map<string, string>, ok: string) =>
    attempt(() => patch.mutateAsync({ id: e.id, clauseOverrides: [...next].map(([clauseId, text]) => ({ clauseId, text })) }), ok);
  const current = () => new Map(e.clauseOverrides.map((o) => [o.clauseId, o.text]));
  return (
    <Card title={t('staffLc.endorsement.clauses')} bodyClassName="p-0">
      <ul className="divide-y divide-border-soft text-[13px]">
        {clausesOf('endorsement').map((cl) => {
          const o = overrides.get(cl.id);
          return (
            <li key={cl.id} className={cn('px-4 py-2', o && 'bg-warning-soft/60')}>
              <div className="flex items-start justify-between gap-2">
                <p>
                  <span className="num mr-1.5 text-muted">{cl.id}</span>
                  {cl.title}
                  {o && <Chip kind="warning" className="ml-2">{t('staffLc.contract.changedChip')}</Chip>}
                </p>
                {editable && (
                  <span className="flex shrink-0 gap-1">
                    {o && (
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={t('staffLc.contract.resetClauseAria', { id: cl.id })}
                        onClick={() => {
                          const next = current();
                          next.delete(cl.id);
                          void save(next, t('staffLc.contract.clauseReset', { id: cl.id }));
                        }}
                      >
                        <RotateCcw className="h-3.5 w-3.5" aria-hidden />
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" aria-label={t('staffLc.contract.editClauseAria', { id: cl.id })} onClick={() => setEdit({ id: cl.id, title: cl.title, text: o?.text ?? cl.text })}>
                      <Pencil className="h-3.5 w-3.5" aria-hidden /> {t('staffLc.contract.editClause')}
                    </Button>
                  </span>
                )}
              </div>
              {o && (
                <p className="mt-1 text-[12px] text-muted">
                  {t('staffLc.contract.originalText')} {o.original}
                </p>
              )}
            </li>
          );
        })}
      </ul>
      {edit && (
        <Modal
          open
          wide
          onOpenChange={(o) => !o && setEdit(null)}
          title={t('staffLc.contract.clauseTitle', { id: edit.id, title: edit.title })}
          description={t('staffLc.endorsement.clauseDesc')}
          footer={
            <>
              <Button variant="secondary" onClick={() => setEdit(null)}>
                {t('common.cancel')}
              </Button>
              <Button
                loading={patch.isPending}
                onClick={() => {
                  const parsed = clauseOverrideSchema.safeParse({ clauseId: edit.id, text: edit.text });
                  if (!parsed.success) return setError(tm(parsed.error.issues[0]?.message) || undefined);
                  const next = current();
                  next.set(parsed.data.clauseId, parsed.data.text);
                  void save(next, t('staffLc.contract.clauseChanged', { id: edit.id })).then((ok) => ok && setEdit(null));
                }}
              >
                {t('staffLc.contract.saveWording')}
              </Button>
            </>
          }
        >
          <Field label={t('staffLc.contract.wording')} error={error}>
            {(a) => <Textarea {...a} rows={6} maxLength={4000} value={edit.text} onChange={(ev) => setEdit({ ...edit, text: ev.target.value })} />}
          </Field>
        </Modal>
      )}
    </Card>
  );
}

function EndorsementCard({ e }: { e: EndorsementView }) {
  const step = useDocStep();
  const approveAmounts = useApproveEndorsementAmounts();
  const canManage = useCan('endorsements.manage');
  const canApproveAmounts = useCan('endorsements.manage', { sub: 'approve_amounts' });
  const canLegal = useCan('contracts.legal_approve');
  const [dialog, setDialog] = useState<'approve' | 'return' | null>(null);
  const input = useMemo(() => endorsementDocument(e, { showChanges: true }), [e]);
  const doc = useStubDocument(input);
  const signingStage = ['approved', 'sent', 'signing', 'signed'].includes(e.status);

  return (
    <>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            <span className="num">{e.number}</span>
            {e.kind === 'termination' && <Chip kind="danger">{t('staffLc.endorsement.terminationChip')}</Chip>}
            <Chip kind={e.status === 'signed' ? 'success' : e.status === 'draft' ? 'neutral' : 'warning'}>{ENDORSEMENT_STATUS_LABEL[e.status]}</Chip>
          </span>
        }
        subtitle={
          <span>
            {t('staffLc.endorsement.clientContract', { client: e.clientName })}{' '}
            <Link className="num text-accent-text hover:underline" to={`/staff/contracts/${e.contractId}`}>
              {e.contractNumber}
            </Link>
          </span>
        }
        actions={
          <>
            <DocPrintButton input={() => endorsementDocument(e)} />
            {canApproveAmounts && e.needsAmountApproval && (
              <Button variant="secondary" loading={approveAmounts.isPending} onClick={() => void attempt(() => approveAmounts.mutateAsync(e.id), t('staffLc.endorsement.amountsApproved'))}>
                {t('staffLc.endorsement.approveAmounts')}
              </Button>
            )}
            {canManage && e.status === 'draft' && (
              <Button
                disabled={e.needsAmountApproval}
                loading={step.isPending}
                onClick={() => void attempt(() => step.mutateAsync({ kind: 'endorsements', id: e.id, step: 'submit-legal' }), e.clauseOverrides.length ? t('staffLc.endorsement.sentToLawyer') : t('staffLc.endorsement.approvedWithoutLawyer'))}
              >
                {t('staffLc.quote.submitForApproval')}
              </Button>
            )}
            {canLegal && e.status === 'legal_review' && (
              <>
                <Button variant="secondary" onClick={() => setDialog('return')}>
                  {t('staffLc.contract.returnWithComment')}
                </Button>
                <Button onClick={() => setDialog('approve')}>{t('staffLc.quote.agree')}</Button>
              </>
            )}
            {canManage && e.status === 'approved' && (
              <Button loading={step.isPending} onClick={() => void attempt(() => step.mutateAsync({ kind: 'endorsements', id: e.id, step: 'send' }), t('staffLc.endorsement.sentToClient'))}>
                {t('staffLc.contract.sendToClient')}
              </Button>
            )}
          </>
        }
      />
      {e.needsAmountApproval && (
        <p role="status" className="mb-3 rounded-card bg-warning-soft px-3 py-2 text-[13px] text-warning-text">
          {t('staffLc.endorsement.needsAmountApproval')}
        </p>
      )}
      {e.status === 'signed' && (
        <p className="mb-3 rounded-card bg-success-soft px-3 py-2 text-[13px] text-success-text" data-testid="endorsement-result">
          {e.total > 0
            ? t('staffLc.endorsement.signedInvoice', { amount: formatMoney(e.total) })
            : e.total < 0
              ? t('staffLc.endorsement.signedRefund', { doc: e.refundDocument ?? '', amount: formatMoney(-e.total) })
              : t('staffLc.endorsement.signed')}
        </p>
      )}
      <StickySectionsCtx.Provider value>
        <div className="flex min-w-0 flex-col gap-4">
          <Card title={t('staffLc.endorsement.calculation')} bodyClassName="p-0">
            <TableScroll>
            <table className="w-full text-[13px]" data-testid="endorsement-lines">
              <caption className="sr-only">{t('staffLc.endorsement.linesCaption')}</caption>
              <thead>
                <tr className="text-left text-[12px] text-muted">
                  <th className="px-4 py-2 font-medium">{t('staffLc.endorsements.change')}</th>
                  <th className="px-2 py-2 text-right font-medium">{t('staffLc.endorsement.days')}</th>
                  <th className="px-2 py-2 font-medium">{t('staffLc.endorsement.formula')}</th>
                  <th className="px-4 py-2 text-right font-medium">{t('common.amount')}</th>
                </tr>
              </thead>
              <tbody>
                {e.lines.map((l) => (
                  <tr key={l.changeRequestId} className="border-b border-border-soft align-top">
                    <td className="px-4 py-1.5">{tm(l.description)}</td>
                    <td className="num px-2 py-1.5 text-right">{l.days}</td>
                    <td className="num px-2 py-1.5 text-[12px] text-muted">{tm(l.formula)}</td>
                    <td className="num px-4 py-1.5 text-right">{formatMoney(l.amount)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={3} className="px-4 py-2 font-semibold">
                    {e.total >= 0 ? t('staffLc.endorsement.totalDue') : t('staffLc.endorsement.totalRefund')}
                  </td>
                  <td className="num px-4 py-2 text-right font-semibold">{formatMoney(Math.abs(e.total))}</td>
                </tr>
              </tfoot>
            </table>
            </TableScroll>
            {e.kind === 'termination' && e.terminationDate && <p className="px-4 pb-3 text-[13px] text-muted">{t('staffLc.endorsement.terminationDate', { date: formatDate(e.terminationDate) })}</p>}
          </Card>
          <EndorsementClauses e={e} editable={canManage && e.status === 'draft'} />
        </div>
      </StickySectionsCtx.Provider>
      {doc && (
        <SideColumn label={t('staffLc.endorsement.preview')} width="45%" testId="endorsement-preview-column">
          <DocPreview doc={doc} label={t('staffLc.endorsement.preview')} />
        </SideColumn>
      )}
      {signingStage && (
        <div className="mt-4">
          <SigningPanel kind="endorsements" doc={e} mode="staff" printInput={() => endorsementDocument(e)} />
        </div>
      )}
      <ReasonDialog
        open={dialog === 'approve'}
        onClose={() => setDialog(null)}
        title={t('staffLc.endorsement.approveTitle')}
        description={t('staffLc.endorsement.approveDesc')}
        label={t('staffLc.quote.commentOptional')}
        field="comment"
        optional
        schema={legalApproveSchema}
        confirmLabel={t('staffLc.quote.agree')}
        onSubmit={(comment) => step.mutateAsync({ kind: 'endorsements', id: e.id, step: 'legal-approve', body: { comment: comment || undefined } })}
      />
      <ReasonDialog
        open={dialog === 'return'}
        onClose={() => setDialog(null)}
        title={t('staffLc.endorsement.returnTitle')}
        description={t('staffLc.endorsement.returnDesc')}
        label={t('common.comment')}
        field="comment"
        schema={legalReturnSchema}
        confirmLabel={t('staffLc.contract.return')}
        danger
        onSubmit={(comment) => step.mutateAsync({ kind: 'endorsements', id: e.id, step: 'legal-return', body: { comment } })}
      />
    </>
  );
}

export default function EndorsementPage() {
  const { endorsementId = '' } = useParams();
  const [poll, setPoll] = useState(false);
  const q = useEndorsement(endorsementId, { poll });
  useEffect(() => setPoll(!!q.data?.signing.edoPending), [q.data?.signing.edoPending]);
  useDocumentTitle(q.data ? q.data.number : t('staffLc.endorsements.endorsement'));
  useTopbar([{ label: t('staffLc.contract.endorsements'), to: '/staff/endorsements' }, { label: q.data?.number ?? t('staffLc.endorsements.endorsement') }]);
  return <QueryState query={q}>{(e) => <EndorsementCard e={e} />}</QueryState>;
}
