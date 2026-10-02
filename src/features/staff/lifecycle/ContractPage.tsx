/*
 * Редактор договора (LIFECYCLE_SPEC §7.3–7.4): parameters and clauses on the left, preview of all pages on
 * the right; status, version and actions on top; signing, invoices, endorsements and versions below.
 */
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
    await attempt(() => patch.mutateAsync({ id: c.id, body: { params: parsed.data } }), 'Параметры сохранены');
  };
  const dis = !editable;
  return (
    <Card title="Параметры договора" actions={editable && <Button size="sm" loading={patch.isPending} onClick={() => void save()}>Сохранить</Button>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Начало" error={errors.startDate}>
          {(a) => <Input {...a} type="date" disabled={dis} value={v.startDate} onChange={set('startDate')} />}
        </Field>
        <Field label="Окончание" error={errors.endDate}>
          {(a) => <Input {...a} type="date" disabled={dis} value={v.endDate} onChange={set('endDate')} />}
        </Field>
        <Field label="Программа" error={errors.program}>
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
        <Field label="Вступление в силу" error={errors.activationRule}>
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
        <Field label={`Премия за сотрудника (${c.params.employees} чел.)`} error={errors.premiumEmployee}>
          {(a) => <Input {...a} inputMode="numeric" maxLength={13} disabled={dis} value={v.premiumEmployee} onChange={set('premiumEmployee')} />}
        </Field>
        <Field label={`Премия за члена семьи (${c.params.familyMembers} чел.)`} error={errors.premiumFamily}>
          {(a) => <Input {...a} inputMode="numeric" maxLength={13} disabled={dis} value={v.premiumFamily} onChange={set('premiumFamily')} />}
        </Field>
        <Field label="Порядок оплаты" error={errors.paymentFrequency}>
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
        <Field label="Подписант МИГ" error={errors.migSignatoryId}>
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
        <Field label="Подписант клиента" error={errors['clientSignatory.name']}>
          {(a) => <Input {...a} maxLength={120} disabled={dis} value={v.signName} onChange={set('signName')} />}
        </Field>
        <Field label="Должность" error={errors['clientSignatory.position']}>
          {(a) => <Input {...a} maxLength={120} disabled={dis} value={v.signPosition} onChange={set('signPosition')} />}
        </Field>
        <Field label="Основание полномочий" className="sm:col-span-2" error={errors['clientSignatory.basis']}>
          {(a) => <Input {...a} maxLength={120} disabled={dis} value={v.signBasis} onChange={set('signBasis')} />}
        </Field>
      </div>
      <dl className="mt-3 border-t border-border-soft pt-2 text-[13px]">
        <Kv label="Общая премия">
          <span className="num font-semibold">{formatMoney(c.params.total)}</span>
        </Kv>
        {c.quote && (
          <Kv label="По котировке">
            <span className="num">
              {formatMoney(c.quote.premiumEmployee)} / {formatMoney(c.quote.premiumFamily)}
            </span>
          </Kv>
        )}
        <Kv label="График (приложение 3)">
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
      setError(parsed.error.issues[0]?.message);
      return;
    }
    const next = current();
    next.set(parsed.data.clauseId, parsed.data.text);
    if (await attempt(() => patch.mutateAsync({ id: c.id, body: body(next) }), `Пункт ${edit.id} изменён`)) setEdit(null);
  };
  const reset = async (id: string) => {
    const next = current();
    next.delete(id);
    await attempt(() => patch.mutateAsync({ id: c.id, body: body(next) }), `Пункт ${id}: исходный текст`);
  };
  const all = clausesOf('contract');
  return (
    <Card title={`Пункты договора${c.clauseOverrides.length ? ` · изменено: ${c.clauseOverrides.length}` : ''}`} bodyClassName="p-0">
      <p className="border-b border-border-soft px-4 py-2 text-[12px] text-muted">Если изменён хотя бы один пункт, договор проходит согласование юриста. Без изменений этап юриста пропускается.</p>
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
                        {o && <Chip kind="warning" className="ml-2">изменён</Chip>}
                      </p>
                      {editable && (
                        <span className="flex shrink-0 gap-1">
                          {o && (
                            <Button size="sm" variant="ghost" aria-label={`Вернуть исходный текст пункта ${cl.id}`} onClick={() => void reset(cl.id)}>
                              <RotateCcw className="h-3.5 w-3.5" aria-hidden />
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="ghost"
                            aria-label={`Изменить формулировку пункта ${cl.id}`}
                            onClick={() => {
                              setError(undefined);
                              setEdit({ id: cl.id, title: cl.title, text: o?.text ?? all.find((x) => x.id === cl.id)?.text ?? '' });
                            }}
                          >
                            <Pencil className="h-3.5 w-3.5" aria-hidden /> Изменить формулировку
                          </Button>
                        </span>
                      )}
                    </div>
                    {o && (
                      <div className="mt-1 grid gap-1 text-[12px]">
                        <p>
                          <span className="font-medium">Новая редакция:</span> {o.text}
                        </p>
                        <p className="text-muted">
                          <span className="font-medium">Исходный текст:</span> {o.original}
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
          title={`Пункт ${edit.id}. ${edit.title}`}
          description="Изменённый пункт подсвечивается в документе, исходный текст показывается рядом."
          footer={
            <>
              <Button variant="secondary" onClick={() => setEdit(null)}>
                Отмена
              </Button>
              <Button loading={patch.isPending} onClick={() => void save()}>
                Сохранить формулировку
              </Button>
            </>
          }
        >
          <Field label="Формулировка" error={error}>
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
    <Card title={`Приложение 2 — застрахованные${c.insuredCount ? `: ${c.insuredCount}` : ''}`}>
      <p className="text-[13px] text-muted">
        Список в формате HR-импорта: <code>{POLICY_CSV_HEADER.join(', ')}</code>. В документ попадают ФИО, должность и число членов семьи; ПИНФЛ и телефоны в договор не печатаются.
      </p>
      {editable && (
        <div className="mt-2">
          <CsvFileButton
            label={c.insuredCount ? 'Заменить список' : 'Загрузить список'}
            ariaLabel="Файл приложения 2"
            busy={upload.isPending}
            maxBytes={5 * 1024 * 1024}
            onText={(csv) => void attempt(() => upload.mutateAsync({ id: c.id, csv }), 'Приложение 2 загружено')}
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
      <Card title="Счета" bodyClassName="p-0">
        {c.invoices.length ? (
          <table className="w-full text-[13px]" data-testid="contract-invoices">
            <caption className="sr-only">Счета по договору</caption>
            <thead>
              <tr className="border-b border-border text-left text-[12px] text-muted">
                <th className="px-4 py-2 font-medium">Счёт</th>
                <th className="px-2 py-2 font-medium">Срок</th>
                <th className="px-2 py-2 text-right font-medium">Сумма</th>
                <th className="px-4 py-2 font-medium">Статус</th>
              </tr>
            </thead>
            <tbody>
              {c.invoices.map((i) => (
                <tr key={i.id} className="border-b border-border-soft">
                  <td className="num px-4 py-1.5">{i.number}</td>
                  <td className="num px-2 py-1.5">{formatDate(i.dueDate)}</td>
                  <td className="num px-2 py-1.5 text-right">
                    {formatMoney(i.amount)}
                    {!!i.paid && i.paid < i.amount && <span className="block text-[12px] text-muted">оплачено {formatMoney(i.paid)}</span>}
                  </td>
                  <td className="px-4 py-1.5">{INVOICE_STATUS_LABEL[i.status]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="px-4 py-3 text-[13px] text-muted">Счета формируются после подписания по графику платежей.</p>
        )}
      </Card>
      <Card title="Доп. соглашения" bodyClassName="p-0">
        {c.endorsements.length ? (
          <ul className="divide-y divide-border-soft text-[13px]">
            {c.endorsements.map((e) => (
              <li key={e.id} className="flex items-center justify-between gap-2 px-4 py-2">
                <button type="button" className="text-left text-accent-text hover:underline" onClick={() => navigate(`/staff/endorsements/${e.id}`)}>
                  {e.number} {e.kind === 'termination' && '· расторжение'}
                </button>
                <span className="flex items-center gap-2">
                  <span className="num">{formatMoney(e.total)}</span>
                  <Chip>{ENDORSEMENT_STATUS_LABEL[e.status]}</Chip>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-4 py-3 text-[13px] text-muted">Нет</p>
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
      toast.success(`Подготовлено соглашение о расторжении ${e.number}`);
      navigate(`/staff/endorsements/${e.id}`);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title="Расторжение договора"
      description="Готовится соглашение о расторжении: возврат премии за оставшийся срок по правилу из «Параметров ДМС». Подписывается теми же способами, что и договор."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Отмена
          </Button>
          <Button variant="danger" loading={terminate.isPending} onClick={() => void submit()}>
            Подготовить соглашение
          </Button>
        </>
      }
    >
      <div className="grid gap-3">
        <Field label="Дата расторжения" error={errors.date}>
          {(a) => <Input {...a} type="date" value={date} min={c.params.startDate} max={c.params.endDate} onChange={(e) => setDate(e.target.value)} />}
        </Field>
        <Field label="Причина" error={errors.reason}>
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
            Договор <span className="num">{c.number}</span>
            <Chip kind={CONTRACT_STATUS_CHIP[c.status]}>{CONTRACT_STATUS_LABEL[c.status]}</Chip>
            <Chip>версия {c.version}</Chip>
          </span>
        }
        subtitle={
          <span>
            <Link to={`/staff/clients/${c.clientId}`} className="text-accent-text hover:underline">
              {c.clientName}
            </Link>{' '}
            · сделка{' '}
            <Link to={`/staff/deals/${c.dealId}`} className="num text-accent-text hover:underline">
              {c.dealNumber}
            </Link>
            {c.policyId && (
              <>
                {' '}
                ·{' '}
                <Link to={`/staff/policies/${c.policyId}`} className="text-accent-text hover:underline">
                  полис
                </Link>
              </>
            )}
          </span>
        }
        actions={
          <>
            <DocPrintButton input={() => contractDocument(c)} />
            {canFinance && financePending && (
              <Button variant="secondary" loading={action.isPending} onClick={() => void attempt(() => action.mutateAsync({ id: c.id, action: 'finance-approve' }), 'Финансовые условия утверждены')}>
                Утвердить финансовые условия
              </Button>
            )}
            {canDraft && c.status === 'draft' && (
              <Button
                disabled={financePending}
                loading={step.isPending}
                onClick={() =>
                  void attempt(
                    () => step.mutateAsync({ kind: 'contracts', id: c.id, step: 'submit-legal' }),
                    c.clauseOverrides.length ? 'Договор отправлен юристу' : 'Пункты не менялись — договор согласован без юриста',
                  )
                }
              >
                Отправить на согласование
              </Button>
            )}
            {canLegal && c.status === 'legal_review' && (
              <>
                <Button variant="secondary" onClick={() => setDialog('legal-return')}>
                  Вернуть с комментарием
                </Button>
                <Button onClick={() => setDialog('legal-approve')}>Согласовать</Button>
              </>
            )}
            {canDraft && c.status === 'approved' && (
              <Button loading={step.isPending} onClick={() => void attempt(() => step.mutateAsync({ kind: 'contracts', id: c.id, step: 'send' }), 'Договор отправлен клиенту')}>
                Отправить клиенту
              </Button>
            )}
            {canDraft && ['approved', 'sent', 'signing'].includes(c.status) && (
              <Button variant="secondary" loading={action.isPending} onClick={() => void attempt(() => action.mutateAsync({ id: c.id, action: 'new-version' }), 'Создана новая версия')}>
                Новая версия
              </Button>
            )}
            {canTerminate && c.status === 'active' && (
              <Button variant="secondary" onClick={() => setDialog('terminate')}>
                Расторгнуть
              </Button>
            )}
          </>
        }
      />
      {financePending && (
        <p role="status" className="mb-3 rounded-card bg-warning-soft px-3 py-2 text-[13px] text-warning-text">
          Премии отличаются от утверждённой котировки: финансовые условия утверждает андеррайтер.
        </p>
      )}
      {c.legalComment && c.status === 'draft' && (
        <p role="status" className="mb-3 rounded-card bg-danger-soft px-3 py-2 text-[13px] text-danger-text" data-testid="legal-comment">
          Юрист вернул договор: {c.legalComment}
        </p>
      )}
      {c.originalOverdue && <p className="mb-3 rounded-card bg-warning-soft px-3 py-2 text-[13px] text-warning-text">Оригинал договора от клиента не получен в срок.</p>}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-4">
          <ParamsForm c={c} editable={editable} />
          <Clauses c={c} editable={editable} />
          <InsuredList c={c} editable={editable} />
        </div>
        <div className="min-w-0">{doc && <DocPreview doc={doc} label="Предпросмотр договора" className="sticky top-16" />}</div>
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
        <Card title="История версий" bodyClassName="p-0">
          <ol className="divide-y divide-border-soft text-[13px]" data-testid="contract-versions">
            {[...c.versions].reverse().map((v, i) => (
              <li key={`${v.at}-${i}`} className="flex flex-wrap justify-between gap-2 px-4 py-2">
                <span>
                  <span className="num mr-2 text-muted">в{v.version}</span>
                  {v.changes}
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
        title="Согласовать договор"
        description="Изменённые пункты проверены. После согласования менеджер отправит договор клиенту."
        label="Комментарий (необязательно)"
        field="comment"
        optional
        schema={legalApproveSchema}
        confirmLabel="Согласовать"
        onSubmit={(comment) => step.mutateAsync({ kind: 'contracts', id: c.id, step: 'legal-approve', body: { comment: comment || undefined } })}
      />
      <ReasonDialog
        open={dialog === 'legal-return'}
        onClose={() => setDialog(null)}
        title="Вернуть договор"
        description="Договор вернётся менеджеру в черновик с вашим комментарием."
        label="Комментарий"
        field="comment"
        schema={legalReturnSchema}
        confirmLabel="Вернуть"
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
  useDocumentTitle(q.data ? `Договор ${q.data.number}` : 'Договор');
  useTopbar([{ label: 'Договоры', to: '/staff/contracts' }, { label: q.data?.number ?? 'Договор' }]);
  return <QueryState query={q}>{(c) => <ContractEditor c={c} />}</QueryState>;
}
