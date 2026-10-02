/* Доп. соглашение (LIFECYCLE_SPEC §11–12): calculation per line with its formula, preview, approval and signing. */
import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Pencil, RotateCcw } from 'lucide-react';
import type { EndorsementView } from '@/shared/types/dto';
import { useApproveEndorsementAmounts, useDocStep, useEndorsement, usePatchEndorsement } from '@/shared/api/queries/lifecycle';
import { errorMessage } from '@/shared/api/client';
import { useCan } from '@/shared/auth/guards';
import { ENDORSEMENT_STATUS_LABEL } from '@/shared/domain/contracts';
import { clauseOverrideSchema, legalApproveSchema, legalReturnSchema } from '@/shared/schemas/forms';
import { formatDate, formatMoney } from '@/shared/lib/format';
import { useDocumentTitle } from '@/shared/lib/hooks';
import { cn } from '@/shared/lib/cn';
import { endorsementDocument } from '@/features/documents/builders';
import { DocPreview, DocPrintButton, useStubDocument } from '@/features/documents/DocPreview';
import { SigningPanel } from '@/features/documents/SigningPanel';
import { clausesOf } from '@/features/documents/templates';
import { Button } from '@/shared/ui/button';
import { Chip } from '@/shared/ui/chips';
import { Modal } from '@/shared/ui/dialog';
import { Field, Textarea } from '@/shared/ui/input';
import { Card, PageHeader } from '@/shared/ui/page';
import { QueryState } from '@/shared/ui/states';
import { toast } from '@/shared/ui/toast';
import { useTopbar } from '../topbar';
import { ReasonDialog } from './common';

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
    <Card title="Пункты соглашения" bodyClassName="p-0">
      <ul className="divide-y divide-border-soft text-[13px]">
        {clausesOf('endorsement').map((cl) => {
          const o = overrides.get(cl.id);
          return (
            <li key={cl.id} className={cn('px-4 py-2', o && 'bg-warning-soft/60')}>
              <div className="flex items-start justify-between gap-2">
                <p>
                  <span className="num mr-1.5 text-muted">{cl.id}</span>
                  {cl.title}
                  {o && <Chip kind="warning" className="ml-2">изменён</Chip>}
                </p>
                {editable && (
                  <span className="flex shrink-0 gap-1">
                    {o && (
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={`Вернуть исходный текст пункта ${cl.id}`}
                        onClick={() => {
                          const next = current();
                          next.delete(cl.id);
                          void save(next, `Пункт ${cl.id}: исходный текст`);
                        }}
                      >
                        <RotateCcw className="h-3.5 w-3.5" aria-hidden />
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" aria-label={`Изменить формулировку пункта ${cl.id}`} onClick={() => setEdit({ id: cl.id, title: cl.title, text: o?.text ?? cl.text })}>
                      <Pencil className="h-3.5 w-3.5" aria-hidden /> Изменить формулировку
                    </Button>
                  </span>
                )}
              </div>
              {o && (
                <p className="mt-1 text-[12px] text-muted">
                  Исходный текст: {o.original}
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
          title={`Пункт ${edit.id}. ${edit.title}`}
          description="Изменённый пункт требует согласования юриста."
          footer={
            <>
              <Button variant="secondary" onClick={() => setEdit(null)}>
                Отмена
              </Button>
              <Button
                loading={patch.isPending}
                onClick={() => {
                  const parsed = clauseOverrideSchema.safeParse({ clauseId: edit.id, text: edit.text });
                  if (!parsed.success) return setError(parsed.error.issues[0]?.message);
                  const next = current();
                  next.set(parsed.data.clauseId, parsed.data.text);
                  void save(next, `Пункт ${edit.id} изменён`).then((ok) => ok && setEdit(null));
                }}
              >
                Сохранить формулировку
              </Button>
            </>
          }
        >
          <Field label="Формулировка" error={error}>
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
            {e.kind === 'termination' && <Chip kind="danger">расторжение</Chip>}
            <Chip kind={e.status === 'signed' ? 'success' : e.status === 'draft' ? 'neutral' : 'warning'}>{ENDORSEMENT_STATUS_LABEL[e.status]}</Chip>
          </span>
        }
        subtitle={
          <span>
            {e.clientName} · договор{' '}
            <Link className="num text-accent-text hover:underline" to={`/staff/contracts/${e.contractId}`}>
              {e.contractNumber}
            </Link>
          </span>
        }
        actions={
          <>
            <DocPrintButton input={() => endorsementDocument(e)} />
            {canApproveAmounts && e.needsAmountApproval && (
              <Button variant="secondary" loading={approveAmounts.isPending} onClick={() => void attempt(() => approveAmounts.mutateAsync(e.id), 'Суммы утверждены')}>
                Утвердить суммы
              </Button>
            )}
            {canManage && e.status === 'draft' && (
              <Button
                disabled={e.needsAmountApproval}
                loading={step.isPending}
                onClick={() => void attempt(() => step.mutateAsync({ kind: 'endorsements', id: e.id, step: 'submit-legal' }), e.clauseOverrides.length ? 'Отправлено юристу' : 'Согласовано без юриста')}
              >
                Отправить на согласование
              </Button>
            )}
            {canLegal && e.status === 'legal_review' && (
              <>
                <Button variant="secondary" onClick={() => setDialog('return')}>
                  Вернуть с комментарием
                </Button>
                <Button onClick={() => setDialog('approve')}>Согласовать</Button>
              </>
            )}
            {canManage && e.status === 'approved' && (
              <Button loading={step.isPending} onClick={() => void attempt(() => step.mutateAsync({ kind: 'endorsements', id: e.id, step: 'send' }), 'Отправлено клиенту')}>
                Отправить клиенту
              </Button>
            )}
          </>
        }
      />
      {e.needsAmountApproval && (
        <p role="status" className="mb-3 rounded-card bg-warning-soft px-3 py-2 text-[13px] text-warning-text">
          В соглашении есть суммы по прочим условиям: их утверждает андеррайтер.
        </p>
      )}
      {e.status === 'signed' && (
        <p className="mb-3 rounded-card bg-success-soft px-3 py-2 text-[13px] text-success-text" data-testid="endorsement-result">
          {e.total > 0 ? `Подписано. Сформирован счёт на доплату ${formatMoney(e.total)}.` : e.total < 0 ? `Подписано. Документ на возврат ${e.refundDocument ?? ''}: ${formatMoney(-e.total)}.` : 'Подписано.'}
        </p>
      )}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-4">
          <Card title="Расчёт" bodyClassName="p-0">
            <table className="w-full text-[13px]" data-testid="endorsement-lines">
              <caption className="sr-only">Строки доп. соглашения</caption>
              <thead>
                <tr className="border-b border-border text-left text-[12px] text-muted">
                  <th className="px-4 py-2 font-medium">Изменение</th>
                  <th className="px-2 py-2 text-right font-medium">Дней</th>
                  <th className="px-2 py-2 font-medium">Формула</th>
                  <th className="px-4 py-2 text-right font-medium">Сумма</th>
                </tr>
              </thead>
              <tbody>
                {e.lines.map((l) => (
                  <tr key={l.changeRequestId} className="border-b border-border-soft align-top">
                    <td className="px-4 py-1.5">{l.description}</td>
                    <td className="num px-2 py-1.5 text-right">{l.days}</td>
                    <td className="num px-2 py-1.5 text-[12px] text-muted">{l.formula}</td>
                    <td className="num px-4 py-1.5 text-right">{formatMoney(l.amount)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={3} className="px-4 py-2 font-semibold">
                    {e.total >= 0 ? 'Итого к доплате' : 'Итого к возврату'}
                  </td>
                  <td className="num px-4 py-2 text-right font-semibold">{formatMoney(Math.abs(e.total))}</td>
                </tr>
              </tfoot>
            </table>
            {e.kind === 'termination' && e.terminationDate && <p className="px-4 pb-3 text-[13px] text-muted">Дата расторжения: {formatDate(e.terminationDate)}</p>}
          </Card>
          <EndorsementClauses e={e} editable={canManage && e.status === 'draft'} />
        </div>
        <div className="min-w-0">{doc && <DocPreview doc={doc} label="Предпросмотр доп. соглашения" className="sticky top-16" />}</div>
      </div>
      {signingStage && (
        <div className="mt-4">
          <SigningPanel kind="endorsements" doc={e} mode="staff" printInput={() => endorsementDocument(e)} />
        </div>
      )}
      <ReasonDialog
        open={dialog === 'approve'}
        onClose={() => setDialog(null)}
        title="Согласовать доп. соглашение"
        description="Изменённые пункты проверены."
        label="Комментарий (необязательно)"
        field="comment"
        optional
        schema={legalApproveSchema}
        confirmLabel="Согласовать"
        onSubmit={(comment) => step.mutateAsync({ kind: 'endorsements', id: e.id, step: 'legal-approve', body: { comment: comment || undefined } })}
      />
      <ReasonDialog
        open={dialog === 'return'}
        onClose={() => setDialog(null)}
        title="Вернуть доп. соглашение"
        description="Соглашение вернётся в черновик."
        label="Комментарий"
        field="comment"
        schema={legalReturnSchema}
        confirmLabel="Вернуть"
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
  useDocumentTitle(q.data ? q.data.number : 'Доп. соглашение');
  useTopbar([{ label: 'Доп. соглашения', to: '/staff/endorsements' }, { label: q.data?.number ?? 'Доп. соглашение' }]);
  return <QueryState query={q}>{(e) => <EndorsementCard e={e} />}</QueryState>;
}
