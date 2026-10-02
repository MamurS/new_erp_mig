/*
 * Панель решения по убытку (LIFECYCLE_SPEC §13): fraud flags, the doctor's opinion, the decision with a
 * clause reference, approval above authority, the reserve with its history, appeals and the letter.
 */
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

const RECOMMENDATION_LABEL = { approve: 'Одобрить', partial: 'Одобрить частично', reject: 'Отказать' } as const;

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
    if (kind !== 'approve' && !parsed.data.clauseRef) next.clauseRef = 'Для отказа и частичного одобрения укажите пункт договора';
    if (kind !== 'approve' && parsed.data.reason.length < 5) next.reason = 'Опишите причину простым языком: её увидит застрахованный';
    if (kind === 'partial' && (value <= 0 || value >= claim.amountClaimed)) next.amount = 'Сумма больше нуля и меньше заявленной';
    setErrors(next);
    if (Object.keys(next).length) return;
    if (await attempt(() => settle.mutateAsync({ claimId: claim.id, step: 'decide', body: parsed.data }), escalates ? 'Решение выше ваших полномочий — отправлено на согласование' : 'Решение принято')) onDone();
  };
  return (
    <div className="grid gap-3" data-testid="decision-form">
      <fieldset className="flex flex-wrap gap-3 text-[13px]">
        <legend className="sr-only">Решение</legend>
        {(['approve', 'partial', 'reject'] as const).map((k) => (
          <label key={k} className="flex items-center gap-1.5">
            <input type="radio" name="decision-kind" checked={kind === k} onChange={() => setKind(k)} />
            {DECISION_KIND_LABEL[k]}
          </label>
        ))}
      </fieldset>
      {kind === 'partial' && (
        <Field label="Сумма к выплате, UZS" error={errors.amount} hint={`Заявлено ${formatMoney(claim.amountClaimed)}`}>
          {(a) => <MaskedInput {...a} mask="money" value={maskMoney(amount)} onChange={setAmount} />}
        </Field>
      )}
      {kind !== 'approve' && (
        <Field label="Пункт договора" error={errors.clauseRef}>
          {(a) => (
            <Select {...a} value={clauseRef} onChange={(e) => setClauseRef(e.target.value)}>
              <option value="">Выберите пункт</option>
              {DECISION_CLAUSES.map((c) => (
                <option key={c.ref} value={c.ref}>
                  {clauseLabel(c.ref)}
                </option>
              ))}
            </Select>
          )}
        </Field>
      )}
      <Field label={kind === 'approve' ? 'Комментарий (необязательно)' : 'Причина простым языком'} error={errors.reason} hint={kind === 'approve' ? undefined : 'Её увидит застрахованный в приложении и в письме'}>
        {(a) => <Textarea {...a} rows={3} maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} />}
      </Field>
      {escalates && (
        <p className="rounded-btn bg-warning-soft px-3 py-2 text-[13px] text-warning-text" role="status">
          Сумма выше ваших полномочий ({formatMoney(session?.user.authority?.claimDecisionMax ?? 0)}): решение уйдёт на согласование сотруднику с бо́льшими полномочиями.
        </p>
      )}
      <div>
        <Button loading={settle.isPending} onClick={() => void submit()}>
          {escalates ? 'Отправить на согласование' : 'Принять решение'}
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
    if (!parsed.success) return setError(parsed.error.issues[0]?.message);
    setError(undefined);
    await attempt(() => settle.mutateAsync({ claimId: claim.id, step: 'opinion', body: parsed.data }), 'Заключение отправлено специалисту по убыткам');
  };
  return (
    <div className="mt-2 grid gap-2">
      <Field label="Медицинское заключение" error={error}>
        {(a) => <Textarea {...a} rows={4} maxLength={2000} value={text} onChange={(e) => setText(e.target.value)} />}
      </Field>
      <Field label="Рекомендация">
        {(a) => (
          <Select {...a} value={rec} onChange={(e) => setRec(e.target.value as typeof rec)}>
            {(Object.keys(RECOMMENDATION_LABEL) as (keyof typeof RECOMMENDATION_LABEL)[]).map((k) => (
              <option key={k} value={k}>
                {RECOMMENDATION_LABEL[k]}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <p className="text-[12px] text-muted">Заключение — не решение: решение принимает специалист по убыткам.</p>
      <div>
        <Button loading={settle.isPending} onClick={() => void submit()}>
          Дать заключение
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
        <Mail className="h-3.5 w-3.5" aria-hidden /> Письмо застрахованному
      </Button>
      {open && (
        <Modal open wide onOpenChange={setOpen} title="Письмо о решении" description="Формируется по шаблону-заглушке после решения.">
          {doc ? (
            <>
              <DocPreview doc={doc} label="Письмо о решении" height="h-[60vh]" />
              <div className="mt-2">{input && <DocPrintButton input={() => input} />}</div>
            </>
          ) : (
            <p className="text-muted">{q.isError ? errorMessage(q.error) : 'Загрузка…'}</p>
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
    <Card title="Урегулирование" bodyClassName="flex flex-col gap-4">
      {flags.length > 0 && (
        <section aria-label="Флаги проверки">
          <p className="mb-1 text-[12px] font-semibold uppercase text-muted">Признаки для проверки</p>
          <ul className="flex flex-col gap-1.5">
            {flags.map((f) => (
              <li key={f.id} className={f.dismissed ? 'rounded-btn bg-rail px-3 py-2 text-[13px] text-muted' : 'rounded-btn bg-warning-soft px-3 py-2 text-[13px] text-warning-text'} data-testid="flag">
                <div className="flex items-start justify-between gap-2">
                  <span className="flex items-start gap-1.5">
                    <Flag className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                    <span>
                      <span className="font-semibold">{FLAG_LABEL[f.code]}.</span> {f.message}
                    </span>
                  </span>
                  {!f.dismissed && s.canDecide && (
                    <Button size="sm" variant="secondary" onClick={() => setDialog({ flagId: f.id })}>
                      Снять флаг
                    </Button>
                  )}
                </div>
                {f.dismissed && (
                  <p className="mt-1 text-[12px]">
                    Снят: {f.dismissed.byName}, {formatDateTime(f.dismissed.at)} — {f.dismissed.comment}
                  </p>
                )}
              </li>
            ))}
          </ul>
          <p className="mt-1 text-[12px] text-muted">Флаги — повод проверить, а не автоматический отказ.</p>
        </section>
      )}

      {(claim.opinion || s.canRequestOpinion) && (
        <section aria-label="Заключение врача">
          <p className="mb-1 text-[12px] font-semibold uppercase text-muted">Заключение врача</p>
          {claim.opinion ? (
            <div className="rounded-btn border border-border-soft px-3 py-2 text-[13px]" data-testid="opinion">
              <p className="text-muted">
                Запрошено {formatDateTime(claim.opinion.requestedAt)}, {claim.opinion.requestedByName}
                {claim.opinion.question && `: ${claim.opinion.question}`}
              </p>
              {claim.opinion.text ? (
                <>
                  <p className="mt-1">{claim.opinion.text}</p>
                  <p className="mt-1 text-[12px] text-muted">
                    Рекомендация: <span className="font-medium text-text">{RECOMMENDATION_LABEL[claim.opinion.recommendation ?? 'approve']}</span> · {claim.opinion.byName}, {claim.opinion.at && formatDateTime(claim.opinion.at)}
                  </p>
                </>
              ) : (
                <p className="mt-1 font-medium">Ждём заключения</p>
              )}
              {s.canGiveOpinion && <OpinionForm claim={claim} />}
            </div>
          ) : (
            <Button size="sm" variant="secondary" onClick={() => setDialog('opinion')}>
              Запросить заключение врача
            </Button>
          )}
        </section>
      )}

      {claim.pendingDecision && (
        <section aria-label="Решение на согласовании" className="rounded-btn border border-warning/40 bg-warning-soft px-3 py-2 text-[13px] text-warning-text" data-testid="pending-decision">
          <p className="font-semibold">
            На согласовании: {DECISION_KIND_LABEL[claim.pendingDecision.kind]}, {formatMoney(claim.pendingDecision.amount)}
          </p>
          <p>
            Предложил {claim.pendingDecision.byName}, {formatDateTime(claim.pendingDecision.at)}. Нужны полномочия от {formatMoney(claim.pendingDecision.required)}.
          </p>
          {claim.pendingDecision.clauseId && <p>Основание: {clauseLabel(claim.pendingDecision.clauseId)}</p>}
          {claim.pendingDecision.reason && <p>Причина: {claim.pendingDecision.reason}</p>}
          {s.canApprovePending && (
            <div className="mt-2 flex gap-2">
              <Button size="sm" loading={settle.isPending} onClick={() => void attempt(() => settle.mutateAsync({ claimId: claim.id, step: 'decision/approve' }), 'Решение согласовано')}>
                Согласовать
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setDialog('pending-reject')}>
                Не согласовывать
              </Button>
            </div>
          )}
        </section>
      )}

      {claim.decision && (
        <section aria-label="Решение" className="rounded-btn border border-border-soft px-3 py-2 text-[13px]" data-testid="claim-decision">
          <p className="font-semibold">
            {DECISION_KIND_LABEL[claim.decision.kind]}: {formatMoney(claim.decision.amount)}
          </p>
          {claim.decision.clauseId && <p>Основание: {clauseLabel(claim.decision.clauseId)}</p>}
          {claim.decision.reason && <p className="text-muted">{claim.decision.reason}</p>}
          <p className="mt-1 text-[12px] text-muted">
            {claim.decision.byName}, {formatDateTime(claim.decision.at)}
            {claim.decision.approvedByName && ` · согласовал ${claim.decision.approvedByName}`}
          </p>
          <div className="mt-2">
            <LetterButton claim={claim} />
          </div>
        </section>
      )}

      {claim.appeal && (
        <section aria-label="Апелляция" className={reopening ? 'rounded-btn border border-danger/40 bg-danger-soft px-3 py-2 text-[13px] text-danger-text' : 'rounded-btn bg-rail px-3 py-2 text-[13px]'} data-testid="appeal">
          <p className="font-semibold">
            Апелляция {claim.appeal.by === 'insured' ? 'застрахованного' : 'клиники'} · {formatDateTime(claim.appeal.at)} <Chip>{reopening ? 'открыта' : 'рассмотрена'}</Chip>
          </p>
          <p className="mt-1">{claim.appeal.text}</p>
          {claim.appeal.resolution && <p className="mt-1">Решение: {claim.appeal.resolution}</p>}
          {reopening && s.canDecide && (
            <div className="mt-2 flex flex-wrap gap-2">
              <Button size="sm" onClick={() => setDeciding(true)}>
                Пересмотреть решение
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setDialog('appeal-keep')}>
                Оставить решение в силе
              </Button>
            </div>
          )}
        </section>
      )}

      {s.canDecide && (!reopening || deciding) && (
        <section aria-label="Принять решение">
          <p className="mb-1 text-[12px] font-semibold uppercase text-muted">Решение</p>
          {s.authorityMax !== null && <p className="mb-2 text-[12px] text-muted">Ваши полномочия: до {formatMoney(s.authorityMax)}.</p>}
          <DecisionForm claim={claim} onDone={() => setDeciding(false)} />
        </section>
      )}

      <section aria-label="Резерв">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[12px] font-semibold uppercase text-muted">Резерв</p>
          <p className="num font-semibold" data-testid="claim-reserve">
            {formatMoney(claim.reserve ?? 0)}
          </p>
        </div>
        {s.canChangeReserve && (
          <Button size="sm" variant="secondary" className="mt-1" onClick={() => setDialog('reserve')}>
            Изменить резерв
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
        title="Запросить заключение врача"
        description="Врач-эксперт даст медицинское заключение и рекомендацию. Решение останется за вами."
        label="Вопрос врачу (необязательно)"
        field="question"
        optional
        schema={opinionRequestSchema}
        confirmLabel="Запросить"
        onSubmit={(question) => settle.mutateAsync({ claimId: claim.id, step: 'request-opinion', body: { question: question || undefined } })}
      />
      <ReasonDialog
        open={dialog === 'pending-reject'}
        onClose={() => setDialog(null)}
        title="Не согласовывать решение"
        description="Решение вернётся автору, убыток останется на рассмотрении."
        label="Комментарий"
        field="comment"
        schema={decisionRejectSchema}
        confirmLabel="Не согласовывать"
        danger
        onSubmit={(comment) => settle.mutateAsync({ claimId: claim.id, step: 'decision/reject', body: { comment } })}
      />
      <ReasonDialog
        open={dialog === 'appeal-keep'}
        onClose={() => setDialog(null)}
        title="Оставить решение в силе"
        description="Застрахованный увидит ответ на апелляцию в приложении."
        label="Ответ на апелляцию"
        field="resolution"
        schema={appealResolveSchema}
        confirmLabel="Ответить"
        onSubmit={(resolution) => settle.mutateAsync({ claimId: claim.id, step: 'appeal/resolve', body: { resolution } })}
      />
      <ReasonDialog
        open={typeof dialog === 'object' && dialog !== null}
        onClose={() => setDialog(null)}
        title="Снять флаг"
        description="Флаг останется в истории с вашим комментарием."
        label="Комментарий"
        field="comment"
        schema={flagDismissSchema}
        confirmLabel="Снять флаг"
        onSubmit={(comment) => settle.mutateAsync({ claimId: claim.id, step: `flags/${(dialog as { flagId: string }).flagId}/dismiss`, body: { comment } })}
      />
      {dialog === 'reserve' && (
        <Modal
          open
          onOpenChange={(o) => !o && setDialog(null)}
          title="Изменить резерв"
          description="Изменение попадёт в историю резерва с вашим именем."
          footer={
            <>
              <Button variant="secondary" onClick={() => setDialog(null)}>
                Отмена
              </Button>
              <Button
                loading={settle.isPending}
                onClick={() => {
                  const parsed = reserveSchema.safeParse({ amount: parseMoney(reserveAmount), reason: reserveReason });
                  if (!parsed.success) return setReserveError(Object.fromEntries(parsed.error.issues.map((i) => [i.path.join('.'), i.message])));
                  setReserveError({});
                  void attempt(() => settle.mutateAsync({ claimId: claim.id, step: 'reserve', method: 'PATCH', body: parsed.data }), 'Резерв изменён').then((ok) => ok && setDialog(null));
                }}
              >
                Сохранить
              </Button>
            </>
          }
        >
          <div className="grid gap-3">
            <Field label="Резерв, UZS" error={reserveError.amount}>
              {(a) => <MaskedInput {...a} mask="money" value={maskMoney(reserveAmount)} onChange={setReserveAmount} />}
            </Field>
            <Field label="Причина" error={reserveError.reason}>
              {(a) => <Textarea {...a} rows={2} maxLength={300} value={reserveReason} onChange={(e) => setReserveReason(e.target.value)} />}
            </Field>
          </div>
        </Modal>
      )}
    </Card>
  );
}
