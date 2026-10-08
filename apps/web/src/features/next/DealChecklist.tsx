/*
 * «Что нужно для следующего этапа» of a deal: each item of the current stage with its state, who is
 * responsible and the action (or «Попросить …» / «Запросить у HR»). The move to the next stage is blocked
 * while a required item is not done: <MissingNote> under the transition button names what is missing
 * (the mock server refuses the move with the same list).
 */
import { t, tm } from '@/i18n';
import { CheckCircle2, Circle, MinusCircle } from 'lucide-react';
import type { DealCard, DealChecklistItem } from '@mig/contracts/dto';
import { DEAL_STAGE_LABEL } from '@mig/domain/contracts';
import { missingItems } from '@mig/domain/nextStep';
import { Card } from '@/shared/ui/page';
import { HelpMore, RequestHrButton, roleName, StepAction, useCanDo } from './NextActions';

function ItemAction({ deal, item }: { deal: DealCard; item: DealChecklistItem }) {
  const canDo = useCanDo(item.action ?? 'other');
  if (item.done || !item.action) return null;
  const refs = { subjectType: deal.contract ? ('contract' as const) : ('deal' as const), subjectId: deal.contract?.id ?? deal.id, clientId: deal.clientId, dealId: deal.id, contractId: deal.contract?.id };
  // The client's part: HR in its cabinet (a task), or a letter before the client has one.
  if (item.role === 'hr') {
    const hrAction = item.action === 'sign_client' || item.action === 'kp_respond' || item.action === 'invoice_pay' || item.action === 'insured_list' ? item.action : 'other';
    return <RequestHrButton size="sm" hasHr={deal.hasHr} clientName={deal.clientName} action={hrAction} subjectType={refs.subjectType} subjectId={refs.subjectId} />;
  }
  return (
    <span className="flex flex-wrap gap-1.5">
      <StepAction size="sm" action={item.action} role={item.role} refs={refs} />
      {/* Appendix 2 can also come from the client's HR. */}
      {item.action === 'insured_list' && canDo && deal.contract && <RequestHrButton size="sm" hasHr={deal.hasHr} clientName={deal.clientName} action="insured_list" subjectType="contract" subjectId={deal.contract.id} />}
    </span>
  );
}

export function DealChecklist({ deal }: { deal: DealCard }) {
  const items = deal.checklist;
  if (deal.stage === 'lost' || deal.stage === 'active') return null;
  return (
    <Card title={t('next.checklist.title')} testId="deal-checklist" actions={<HelpMore article="new-client" />}>
      {items.length === 0 ? (
        <p className="text-[13px] text-muted">{t('next.checklist.nothing')}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border-soft text-[13px]" aria-label={t('next.checklist.caption', { stage: DEAL_STAGE_LABEL[deal.stage] })}>
          {items.map((i) => {
            const state = i.done ? 'done' : i.required ? 'todo' : 'optional';
            return (
              <li key={i.key} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 py-2" data-testid={`check-${i.key}`} data-state={state}>
                {state === 'done' ? (
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-success" aria-hidden />
                ) : state === 'todo' ? (
                  <Circle className="h-4 w-4 shrink-0 text-warning" aria-hidden />
                ) : (
                  <MinusCircle className="h-4 w-4 shrink-0 text-muted" aria-hidden />
                )}
                <span className="min-w-0 flex-1">
                  <span className="font-medium">{tm(i.label)}</span>
                  <span className="block text-[12px] text-muted">
                    {state === 'done' ? t('next.checklist.done') : state === 'todo' ? t('next.checklist.notDone') : t('next.checklist.optional')} · {t('next.responsible', { role: roleName(i.role) })}
                    {i.hint ? ` · ${tm(i.hint)}` : ''}
                  </span>
                </span>
                <ItemAction deal={deal} item={i} />
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

/** «Не хватает: …» under a transition button that the checklist blocks. */
export function MissingNote({ items, id }: { items: readonly DealChecklistItem[]; id?: string }) {
  const missing = missingItems(items);
  if (!missing.length) return null;
  return (
    <p id={id} role="note" data-testid="missing-note" className="basis-full text-[12px] text-warning-text">
      {t('next.checklist.missing', { items: missing.map((m) => tm(m.label)).join(', ') })}
    </p>
  );
}
