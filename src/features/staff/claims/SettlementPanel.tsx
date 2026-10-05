/*
 * Панель решения по убытку (LIFECYCLE_SPEC §13): fraud flags, the doctor's opinion, the decision with a
 * clause reference, approval above authority, the reserve with its history, appeals and the letter.
 */
import { defineLabels, msg, t, tm } from '@/i18n';
import { useMemo, useState } from 'react';
import { Flag, Mail } from 'lucide-react';
import type { ClaimDecisionKind } from '@/shared/types';
import type { ClaimDetail } from '@/shared/types/dto';
import { useClaimLetter, useSettlement } from '@/shared/api/queries/lifecycle';
import { errorMessage } from '@/shared/api/client';
import { DECISION_KIND_LABEL, decisionNeedsApproval, FLAG_LABEL } from '@/shared/domain/settlement';
import { appealResolveSchema, claimDecideSchema, decisionRejectSchema, flagDismissSchema, opinionRequestSchema, opinionSchema, reserveSchema } from '@/shared/schemas/forms';
import { formatDateTime, formatMoney } from '@/shared/lib/format';
import { maskMoney, parseMoney } from '@/shared/lib/masks';
import { letterDocument } from '@/features/documents/builders';
import { DocPreview, DocPrintButton, useStubDocument } from '@/features/documents/DocPreview';
import { clauseLabel, DECISION_CLAUSES } from '@/features/documents/templates';
import { useSession } from '@/shared/auth/session';
import { Button } from '@/shared/ui/button';
import { Chip } from '@/shared/ui/chips';
import { Modal } from '@/shared/ui/dialog';
import { Field, Select, Textarea } from '@/shared/ui/input';
import { MaskedInput } from '@/shared/ui/masked-input';
import { Card } from '@/shared/ui/page';
import { toast } from '@/shared/ui/toast';
import { ReasonDialog } from '../lifecycle/common';

const RECOMMENDATIONS = ['approve', 'partial', 'reject'] as const;
const RECOMMENDATION_LABEL = defineLabels('staffLc.settle.recommendation', RECOMMENDATIONS);

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

function DecisionForm({ claim, onDone }: { claim: ClaimDetail; onDone: () => void }) {
  const settle = useSettlement();
  const session = useSession();
  const [kind, setKind] = useState<ClaimDecisionKind>(claim.opinion?.recommendation ?? 'approve');
  const [amount, setAmount] = useState(String(Math.min(claim.amountClaimed, Math.max(0, claim.limitCheck.remaining))));
  const [clauseRef, setClauseRef] = useState('');
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const value = kind === 'approve' ? claim.amountClaimed : kind === 'reject' ? 0 : parseMoney(amount);
  const escalates = decisionNeedsApproval(kind, value, claim.amountClaimed, session?.user.authority);
  const submit = async () => {
    const parsed = claimDecideSchema.safeParse({ kind, amount: value, clauseRef: kind === 'approve' ? undefined : clauseRef || undefined, reason });
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [i.path.join('.'), i.message])));
      return;
    }
    const next: Record<string, string> = {};
    if (kind !== 'approve' && !parsed.data.clauseRef) next.clauseRef = msg('staffLc.settle.errClause');
    if (kind !== 'approve' && parsed.data.reason.length < 5) next.reason = msg('staffLc.settle.errReason');
    if (kind === 'partial' && (value <= 0 || value >= claim.amountClaimed)) next.amount = msg('staffLc.settle.errAmount');
    setErrors(next);
    if (Object.keys(next).length) return;
    if (await attempt(() => settle.mutateAsync({ claimId: claim.id, step: 'decide', body: parsed.data }), escalates ? t('staffLc.settle.escalated') : t('staffLc.settle.decided'))) onDone();
  };
  return (
    <div className="grid gap-3" data-testid="decision-form">
      <fieldset className="flex flex-wrap gap-3 text-[13px]">
        <legend className="sr-only">{t('common.decision')}</legend>
        {(['approve', 'partial', 'reject'] as const).map((k) => (
          <label key={k} className="flex items-center gap-1.5">
            <input type="radio" name="decision-kind" checked={kind === k} onChange={() => setKind(k)} />
            {DECISION_KIND_LABEL[k]}
          </label>
        ))}
      </fieldset>
      {kind === 'partial' && (
        <Field label={t('staffLc.settle.payAmount')} error={tm(errors.amount) || undefined} hint={t('staffLc.settle.claimed', { amount: formatMoney(claim.amountClaimed) })}>
          {(a) => <MaskedInput {...a} mask="money" value={maskMoney(amount)} onChange={setAmount} />}
        </Field>
      )}
      {kind !== 'approve' && (
        <Field label={t('staffLc.settle.clause')} error={tm(errors.clauseRef) || undefined}>
          {(a) => (
            <Select {...a} value={clauseRef} onChange={(e) => setClauseRef(e.target.value)}>
              <option value="">{t('staffLc.settle.chooseClause')}</option>
              {DECISION_CLAUSES.map((c) => (
                <option key={c.ref} value={c.ref}>
                  {clauseLabel(c.ref)}
                </option>
              ))}
            </Select>
          )}
        </Field>
      )}
      <Field label={kind === 'approve' ? t('staffLc.quote.commentOptional') : t('staffLc.settle.plainReason')} error={tm(errors.reason) || undefined} hint={kind === 'approve' ? undefined : t('staffLc.settle.plainReasonHint')}>
        {(a) => <Textarea {...a} rows={3} maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} />}
      </Field>
      {escalates && (
        <p className="rounded-btn bg-warning-soft px-3 py-2 text-[13px] text-warning-text" role="status">
          {t('staffLc.settle.aboveAuthority', { max: formatMoney(session?.user.authority?.claimDecisionMax ?? 0) })}
        </p>
      )}
      <div>
        <Button loading={settle.isPending} onClick={() => void submit()}>
          {escalates ? t('staffLc.quote.submitForApproval') : t('staffLc.settle.decide')}
        </Button>
      </div>
    </div>
  );
}

function OpinionForm({ claim }: { claim: ClaimDetail }) {
  const settle = useSettlement();
  const [text, setText] = useState('');
  const [rec, setRec] = useState<'approve' | 'partial' | 'reject'>('approve');
  const [error, setError] = useState<string>();
  const submit = async () => {
    const parsed = opinionSchema.safeParse({ text, recommendation: rec });
    if (!parsed.success) return setError(tm(parsed.error.issues[0]?.message) || undefined);
    setError(undefined);
    await attempt(() => settle.mutateAsync({ claimId: claim.id, step: 'opinion', body: parsed.data }), t('staffLc.settle.opinionSent'));
  };
  return (
    <div className="mt-2 grid gap-2">
      <Field label={t('staffLc.settle.medicalOpinion')} error={error}>
        {(a) => <Textarea {...a} rows={4} maxLength={2000} value={text} onChange={(e) => setText(e.target.value)} />}
      </Field>
      <Field label={t('staffLc.settle.recommendationLabel')}>
        {(a) => (
          <Select {...a} value={rec} onChange={(e) => setRec(e.target.value as typeof rec)}>
            {RECOMMENDATIONS.map((k) => (
              <option key={k} value={k}>
                {RECOMMENDATION_LABEL[k]}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <p className="text-[12px] text-muted">{t('staffLc.settle.opinionNote')}</p>
      <div>
        <Button loading={settle.isPending} onClick={() => void submit()}>
          {t('staffLc.settle.giveOpinion')}
        </Button>
      </div>
    </div>
  );
}

function LetterButton({ claim }: { claim: ClaimDetail }) {
  const [open, setOpen] = useState(false);
  const q = useClaimLetter(claim.id, open);
  const input = useMemo(() => (q.data ? letterDocument(q.data) : null), [q.data]);
  const doc = useStubDocument(input);
  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        <Mail className="h-3.5 w-3.5" aria-hidden /> {t('staffLc.settle.letterToInsured')}
      </Button>
      {open && (
        <Modal open wide onOpenChange={setOpen} title={t('staffLc.settle.letterTitle')} description={t('staffLc.settle.letterDesc')}>
          {doc ? (
            <>
              <DocPreview doc={doc} label={t('staffLc.settle.letterTitle')} height="h-[60vh]" />
              <div className="mt-2">{input && <DocPrintButton input={() => input} />}</div>
            </>
          ) : (
            <p className="text-muted">{q.isError ? errorMessage(q.error) : t('common.loading')}</p>
          )}
        </Modal>
      )}
    </>
  );
}

export function SettlementPanel({ claim }: { claim: ClaimDetail }) {
  const s = claim.settlement;
  const settle = useSettlement();
  const [dialog, setDialog] = useState<null | 'opinion' | 'pending-reject' | 'reserve' | 'appeal-keep' | { flagId: string }>(null);
  const [reserveAmount, setReserveAmount] = useState(String(claim.reserve ?? 0));
  const [reserveError, setReserveError] = useState<Record<string, string>>({});
  const [reserveReason, setReserveReason] = useState('');
  const [deciding, setDeciding] = useState(false);
  if (!s) return null;
  const flags = claim.flags ?? [];
  const reopening = claim.appeal?.status === 'open';

  return (
    <Card title={t('staffLc.settle.title')} bodyClassName="flex flex-col gap-4">
      {flags.length > 0 && (
        <section aria-label={t('staffLc.settle.flagsAria')}>
          <p className="mb-1 text-[12px] font-semibold uppercase text-muted">{t('staffLc.settle.flags')}</p>
          <ul className="flex flex-col gap-1.5">
            {flags.map((f) => (
              <li key={f.id} className={f.dismissed ? 'rounded-btn bg-rail px-3 py-2 text-[13px] text-muted' : 'rounded-btn bg-warning-soft px-3 py-2 text-[13px] text-warning-text'} data-testid="flag">
                <div className="flex items-start justify-between gap-2">
                  <span className="flex items-start gap-1.5">
                    <Flag className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                    <span>
                      <span className="font-semibold">{FLAG_LABEL[f.code]}.</span> {tm(f.message)}
                    </span>
                  </span>
                  {!f.dismissed && s.canDecide && (
                    <Button size="sm" variant="secondary" onClick={() => setDialog({ flagId: f.id })}>
                      {t('staffLc.settle.dismissFlag')}
                    </Button>
                  )}
                </div>
                {f.dismissed && (
                  <p className="mt-1 text-[12px]">
                    {t('staffLc.settle.dismissed', { name: f.dismissed.byName, at: formatDateTime(f.dismissed.at), comment: f.dismissed.comment })}
                  </p>
                )}
              </li>
            ))}
          </ul>
          <p className="mt-1 text-[12px] text-muted">{t('staffLc.settle.flagsNote')}</p>
        </section>
      )}

      {(claim.opinion || s.canRequestOpinion) && (
        <section aria-label={t('staffLc.settle.doctorOpinion')}>
          <p className="mb-1 text-[12px] font-semibold uppercase text-muted">{t('staffLc.settle.doctorOpinion')}</p>
          {claim.opinion ? (
            <div className="rounded-btn border border-border-soft px-3 py-2 text-[13px]" data-testid="opinion">
              <p className="text-muted">
                {t('staffLc.settle.requested', { at: formatDateTime(claim.opinion.requestedAt), name: claim.opinion.requestedByName })}
                {claim.opinion.question && `: ${claim.opinion.question}`}
              </p>
              {claim.opinion.text ? (
                <>
                  <p className="mt-1">{claim.opinion.text}</p>
                  <p className="mt-1 text-[12px] text-muted">
                    {t('staffLc.settle.recommendationPrefix')} <span className="font-medium text-text">{RECOMMENDATION_LABEL[claim.opinion.recommendation ?? 'approve']}</span> · {claim.opinion.byName}, {claim.opinion.at && formatDateTime(claim.opinion.at)}
                  </p>
                </>
              ) : (
                <p className="mt-1 font-medium">{t('staffLc.settle.awaitingOpinion')}</p>
              )}
              {s.canGiveOpinion && <OpinionForm claim={claim} />}
            </div>
          ) : (
            <Button size="sm" variant="secondary" onClick={() => setDialog('opinion')}>
              {t('staffLc.settle.requestOpinion')}
            </Button>
          )}
        </section>
      )}

      {claim.pendingDecision && (
        <section aria-label={t('staffLc.settle.pendingAria')} className="rounded-btn border border-warning/40 bg-warning-soft px-3 py-2 text-[13px] text-warning-text" data-testid="pending-decision">
          <p className="font-semibold">
            {t('staffLc.settle.pending', { kind: DECISION_KIND_LABEL[claim.pendingDecision.kind], amount: formatMoney(claim.pendingDecision.amount) })}
          </p>
          <p>
            {t('staffLc.settle.proposedBy', { name: claim.pendingDecision.byName, at: formatDateTime(claim.pendingDecision.at), required: formatMoney(claim.pendingDecision.required) })}
          </p>
          {claim.pendingDecision.clauseId && <p>{t('staffLc.settle.basis', { clause: clauseLabel(claim.pendingDecision.clauseId) })}</p>}
          {claim.pendingDecision.reason && <p>{t('staffLc.deal.lostReason', { reason: claim.pendingDecision.reason })}</p>}
          {s.canApprovePending && (
            <div className="mt-2 flex gap-2">
              <Button size="sm" loading={settle.isPending} onClick={() => void attempt(() => settle.mutateAsync({ claimId: claim.id, step: 'decision/approve' }), t('staffLc.settle.approvedToast'))}>
                {t('staffLc.quote.agree')}
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setDialog('pending-reject')}>
                {t('staffLc.settle.disapprove')}
              </Button>
            </div>
          )}
        </section>
      )}

      {claim.decision && (
        <section aria-label={t('common.decision')} className="rounded-btn border border-border-soft px-3 py-2 text-[13px]" data-testid="claim-decision">
          <p className="font-semibold">
            {DECISION_KIND_LABEL[claim.decision.kind]}: {formatMoney(claim.decision.amount)}
          </p>
          {claim.decision.clauseId && <p>{t('staffLc.settle.basis', { clause: clauseLabel(claim.decision.clauseId) })}</p>}
          {claim.decision.reason && <p className="text-muted">{claim.decision.reason}</p>}
          <p className="mt-1 text-[12px] text-muted">
            {claim.decision.byName}, {formatDateTime(claim.decision.at)}
            {claim.decision.approvedByName && t('staffLc.settle.approvedBy', { name: claim.decision.approvedByName })}
          </p>
          <div className="mt-2">
            <LetterButton claim={claim} />
          </div>
        </section>
      )}

      {claim.appeal && (
        <section aria-label={t('staffLc.settle.appeal')} className={reopening ? 'rounded-btn border border-danger/40 bg-danger-soft px-3 py-2 text-[13px] text-danger-text' : 'rounded-btn bg-rail px-3 py-2 text-[13px]'} data-testid="appeal">
          <p className="font-semibold">
            {claim.appeal.by === 'insured' ? t('staffLc.settle.appealInsured', { at: formatDateTime(claim.appeal.at) }) : t('staffLc.settle.appealClinic', { at: formatDateTime(claim.appeal.at) })}{' '}
            <Chip>{reopening ? t('staffLc.settle.appealOpen') : t('staffLc.settle.appealClosed')}</Chip>
          </p>
          <p className="mt-1">{claim.appeal.text}</p>
          {claim.appeal.resolution && <p className="mt-1">{t('staffLc.settle.resolution', { text: claim.appeal.resolution })}</p>}
          {reopening && s.canDecide && (
            <div className="mt-2 flex flex-wrap gap-2">
              <Button size="sm" onClick={() => setDeciding(true)}>
                {t('staffLc.settle.reconsider')}
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setDialog('appeal-keep')}>
                {t('staffLc.settle.keepDecision')}
              </Button>
            </div>
          )}
        </section>
      )}

      {s.canDecide && (!reopening || deciding) && (
        <section aria-label={t('staffLc.settle.decide')}>
          <p className="mb-1 text-[12px] font-semibold uppercase text-muted">{t('common.decision')}</p>
          {s.authorityMax !== null && <p className="mb-2 text-[12px] text-muted">{t('staffLc.settle.authority', { max: formatMoney(s.authorityMax) })}</p>}
          <DecisionForm claim={claim} onDone={() => setDeciding(false)} />
        </section>
      )}

      <section aria-label={t('staffLc.reserves.colReserve')}>
        <div className="flex items-center justify-between gap-2">
          <p className="text-[12px] font-semibold uppercase text-muted">{t('staffLc.reserves.colReserve')}</p>
          <p className="num font-semibold" data-testid="claim-reserve">
            {formatMoney(claim.reserve ?? 0)}
          </p>
        </div>
        {s.canChangeReserve && (
          <Button size="sm" variant="secondary" className="mt-1" onClick={() => setDialog('reserve')}>
            {t('staffLc.settle.changeReserve')}
          </Button>
        )}
        {(claim.reserveHistory ?? []).length > 0 && (
          <ol className="mt-2 flex flex-col gap-1 text-[12px] text-muted">
            {[...(claim.reserveHistory ?? [])].reverse().map((h, i) => (
              <li key={`${h.at}-${i}`}>
                <span className="num">{formatDateTime(h.at)}</span> · {h.byName}: <span className="num">{formatMoney(h.from)} → {formatMoney(h.to)}</span> — {h.reason}
              </li>
            ))}
          </ol>
        )}
      </section>

      <ReasonDialog
        open={dialog === 'opinion'}
        onClose={() => setDialog(null)}
        title={t('staffLc.settle.requestOpinion')}
        description={t('staffLc.settle.requestOpinionDesc')}
        label={t('staffLc.settle.questionLabel')}
        field="question"
        optional
        schema={opinionRequestSchema}
        confirmLabel={t('staffLc.settle.request')}
        onSubmit={(question) => settle.mutateAsync({ claimId: claim.id, step: 'request-opinion', body: { question: question || undefined } })}
      />
      <ReasonDialog
        open={dialog === 'pending-reject'}
        onClose={() => setDialog(null)}
        title={t('staffLc.settle.disapproveTitle')}
        description={t('staffLc.settle.disapproveDesc')}
        label={t('common.comment')}
        field="comment"
        schema={decisionRejectSchema}
        confirmLabel={t('staffLc.settle.disapprove')}
        danger
        onSubmit={(comment) => settle.mutateAsync({ claimId: claim.id, step: 'decision/reject', body: { comment } })}
      />
      <ReasonDialog
        open={dialog === 'appeal-keep'}
        onClose={() => setDialog(null)}
        title={t('staffLc.settle.keepDecision')}
        description={t('staffLc.settle.keepDesc')}
        label={t('staffLc.settle.appealAnswer')}
        field="resolution"
        schema={appealResolveSchema}
        confirmLabel={t('staffLc.settle.answer')}
        onSubmit={(resolution) => settle.mutateAsync({ claimId: claim.id, step: 'appeal/resolve', body: { resolution } })}
      />
      <ReasonDialog
        open={typeof dialog === 'object' && dialog !== null}
        onClose={() => setDialog(null)}
        title={t('staffLc.settle.dismissFlag')}
        description={t('staffLc.settle.dismissDesc')}
        label={t('common.comment')}
        field="comment"
        schema={flagDismissSchema}
        confirmLabel={t('staffLc.settle.dismissFlag')}
        onSubmit={(comment) => settle.mutateAsync({ claimId: claim.id, step: `flags/${(dialog as { flagId: string }).flagId}/dismiss`, body: { comment } })}
      />
      {dialog === 'reserve' && (
        <Modal
          open
          onOpenChange={(o) => !o && setDialog(null)}
          title={t('staffLc.settle.changeReserve')}
          description={t('staffLc.settle.reserveDesc')}
          footer={
            <>
              <Button variant="secondary" onClick={() => setDialog(null)}>
                {t('common.cancel')}
              </Button>
              <Button
                loading={settle.isPending}
                onClick={() => {
                  const parsed = reserveSchema.safeParse({ amount: parseMoney(reserveAmount), reason: reserveReason });
                  if (!parsed.success) return setReserveError(Object.fromEntries(parsed.error.issues.map((i) => [i.path.join('.'), i.message])));
                  setReserveError({});
                  void attempt(() => settle.mutateAsync({ claimId: claim.id, step: 'reserve', method: 'PATCH', body: parsed.data }), t('staffLc.settle.reserveChanged')).then((ok) => ok && setDialog(null));
                }}
              >
                {t('common.save')}
              </Button>
            </>
          }
        >
          <div className="grid gap-3">
            <Field label={t('staffLc.settle.reserveUzs')} error={tm(reserveError.amount) || undefined}>
              {(a) => <MaskedInput {...a} mask="money" value={maskMoney(reserveAmount)} onChange={setReserveAmount} />}
            </Field>
            <Field label={t('common.reason')} error={tm(reserveError.reason) || undefined}>
              {(a) => <Textarea {...a} rows={2} maxLength={300} value={reserveReason} onChange={(e) => setReserveReason(e.target.value)} />}
            </Field>
          </div>
        </Modal>
      )}
    </Card>
  );
}
