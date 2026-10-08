/*
 * Actions of an empty section with a next step (docs/DECISIONS.md «Пустые состояния со следующим шагом»):
 * - the action itself when the person may do it — a link to the place with the form already open;
 * - otherwise «Попросить {роль}»: a task in that role's queue with a link back and a comment; the author is
 *   notified when it is done;
 * - «Запросить у HR»: a task in the client's HR cabinet; before the client has one (a lead before the
 *   commercial proposal) — a ready letter with the CSV template to copy and send from one's own mailbox;
 * - «Подробнее в справке»: the section of the guide.
 */
import { t, tKey } from '@/i18n';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { BookOpen, Copy, Mail, Send } from 'lucide-react';
import type { Role } from '@mig/contracts';
import type { TaskAction, TaskSubjectType } from '@mig/contracts/dto';
import { can } from '@mig/domain/auth/permissions';
import { useUser } from '@/shared/auth/session';
import { errorMessage } from '@/shared/api/client';
import { useAskTask, useRemindTask, useRequestHr, useTasksAbout } from '@/shared/api/queries/tasks';
import type { WorkTask } from '@mig/contracts/dto';
import { formatDate, formatDateTime } from '@mig/domain/lib/format';
import { cn } from '@/shared/lib/cn';
import { ACTION_RIGHT, ACTION_ROLE, staffActionPath, type TaskRefs } from '@mig/domain/nextStep';
import { censusTemplateCsv } from '@mig/domain/census';
import { isStaffRole, ROLE_LABEL } from '@mig/domain/labels';
import { downloadText } from '@/shared/lib/csv';
import { taskAskSchema, taskRequestHrSchema } from '@mig/contracts/forms';
import { Button } from '@/shared/ui/button';
import { ConfirmDialog } from '@/shared/ui/confirm-dialog';
import { Modal } from '@/shared/ui/dialog';
import { Field, Textarea } from '@/shared/ui/input';
import { toast } from '@/shared/ui/toast';
import { helpBase, helpHref } from '@/features/help/paths';

type Size = 'sm' | 'md';

/** The role in the text «Отвечает: …» (lower case after the colon in Russian is not needed: labels are titles). */
export const roleName = (role: Role): string => ROLE_LABEL[role];

/** May the current person do the action themselves? */
export function useCanDo(action: TaskAction): boolean {
  const user = useUser();
  const right = ACTION_RIGHT[action];
  if (!user || !right) return false;
  return can(user, right, { companyId: user.companyId });
}

/** Who a request went to, in the plaque and in «Мои запросы». */
export const requestTo = (task: Pick<WorkTask, 'toRole' | 'assigneeName'>): string => (task.toRole === 'hr' ? t('next.req.toHr') : (task.assigneeName ?? roleName(task.toRole)));

/**
 * The open request instead of the button: «Запрос … отправлен {дата}, {статус}». Once the deadline has
 * passed it is red and its author may «Напомнить» (a new notification to the executor, a mark in the history).
 */
export function RequestPlaque({ task }: { task: WorkTask }) {
  const remind = useRemindTask();
  const doRemind = async () => {
    try {
      await remind.mutateAsync(task.id);
      toast.success(t('next.req.reminded'));
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  return (
    <div
      role="status"
      data-testid="request-plaque"
      data-status={task.status}
      data-overdue={task.overdue || undefined}
      className={cn('flex flex-wrap items-center gap-2 rounded-card px-3 py-2 text-[13px]', task.overdue ? 'bg-danger-soft text-danger-text' : 'bg-accent-soft text-text')}
    >
      <span className="min-w-0 flex-1">
        {t('next.req.sent', { what: tKey(`next.action.${task.action}`), to: requestTo(task), date: formatDate(task.createdAt), status: tKey(`next.req.status.${task.status}`) })}
        {task.overdue ? <> · {t('next.req.overdue', { date: formatDate(task.dueDate) })}</> : <> · {t('next.req.due', { date: formatDate(task.dueDate) })}</>}
        {task.remindedAt && <span className="text-muted"> · {t('next.req.remindedAt', { date: formatDateTime(task.remindedAt) })}</span>}
      </span>
      {task.byMe && task.overdue && (
        <Button size="sm" variant="secondary" loading={remind.isPending} onClick={() => void doRemind()} data-testid="request-remind">
          {t('next.req.remind')}
        </Button>
      )}
    </div>
  );
}

/** The open request of this kind about the object, if any (one at a time). */
function useOpenRequest(subjectType: TaskSubjectType, subjectId: string, action: TaskAction, toRole: Role | 'hr', enabled: boolean): WorkTask | undefined {
  const about = useTasksAbout(subjectType, subjectId, enabled);
  return about.data?.find((x) => x.action === action && x.toRole === toRole);
}

/** «Попросить {роль}»: a comment and a request to the responsible person (or the role); then the plaque. */
export function AskButton({ role, action, subjectType, subjectId, size = 'md' }: { role: Role; action: TaskAction; subjectType: TaskSubjectType; subjectId: string; size?: Size }) {
  const user = useUser();
  const ask = useAskTask();
  const [open, setOpen] = useState(false);
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string>();
  const allowed = !!user && isStaffRole(role) && can(user, 'tasks.ask', { companyId: user.companyId });
  const pending = useOpenRequest(subjectType, subjectId, action, role, allowed);
  if (!allowed) return null;
  if (pending) return <RequestPlaque task={pending} />;
  const label = tKey(`next.ask.${role}`);
  const send = async () => {
    const parsed = taskAskSchema.safeParse({ toRole: role, action, subjectType, subjectId, comment });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message);
      return;
    }
    try {
      await ask.mutateAsync(parsed.data);
      toast.success(t('next.ask.sent'));
      setOpen(false);
      setComment('');
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  return (
    <>
      <Button size={size} variant="secondary" onClick={() => setOpen(true)} data-testid={`ask-${role}`}>
        <Send className="h-3.5 w-3.5" aria-hidden /> {label}
      </Button>
      <ConfirmDialog open={open} onOpenChange={setOpen} title={label} description={t('next.ask.what', { title: tKey(`next.action.${action}`) })} confirmLabel={t('next.ask.send')} loading={ask.isPending} onConfirm={() => void send()}>
        <Field label={t('next.ask.comment')} hint={t('next.ask.commentHint')} error={error}>
          {(a) => <Textarea {...a} rows={3} maxLength={500} value={comment} onChange={(e) => setComment(e.target.value)} />}
        </Field>
      </ConfirmDialog>
    </>
  );
}

/** «Запросить у HR»: a task in the HR cabinet, or — without one yet — the letter with the template. */
export function RequestHrButton({
  hasHr,
  clientName,
  action,
  subjectType,
  subjectId,
  size = 'md',
}: {
  hasHr: boolean;
  clientName: string;
  action: 'insured_list' | 'census_upload' | 'sign_client' | 'kp_respond' | 'invoice_pay' | 'other';
  subjectType: TaskSubjectType;
  subjectId: string;
  size?: Size;
}) {
  const user = useUser();
  const request = useRequestHr();
  const [open, setOpen] = useState(false);
  const [comment, setComment] = useState('');
  const allowed = !!user && can(user, 'tasks.request_hr');
  const pending = useOpenRequest(subjectType, subjectId, action, 'hr', allowed && hasHr);
  if (!user || !allowed) return null;
  if (pending) return <RequestPlaque task={pending} />;
  const send = async () => {
    const parsed = taskRequestHrSchema.safeParse({ action, subjectType, subjectId, comment });
    if (!parsed.success) return;
    try {
      await request.mutateAsync(parsed.data);
      toast.success(t('next.requestHr.sent'));
      setOpen(false);
      setComment('');
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  return (
    <>
      <Button size={size} variant="secondary" onClick={() => setOpen(true)} data-testid="request-hr">
        <Mail className="h-3.5 w-3.5" aria-hidden /> {t('next.requestHr')}
      </Button>
      {hasHr ? (
        <ConfirmDialog
          open={open}
          onOpenChange={setOpen}
          title={t('next.requestHr.title')}
          description={t('next.requestHr.text', { client: clientName })}
          confirmLabel={t('next.ask.send')}
          loading={request.isPending}
          onConfirm={() => void send()}
        >
          <Field label={t('next.ask.comment')} hint={t('next.ask.commentHint')}>
            {(a) => <Textarea {...a} rows={3} maxLength={500} value={comment} onChange={(e) => setComment(e.target.value)} />}
          </Field>
        </ConfirmDialog>
      ) : (
        <LetterDialog open={open} onOpenChange={setOpen} clientName={clientName} senderName={user.displayName} />
      )}
    </>
  );
}

/** The letter to a client without an HR cabinet: text to copy, the subject for the mail client, the CSV template. */
export function LetterDialog({ open, onOpenChange, clientName, senderName }: { open: boolean; onOpenChange: (o: boolean) => void; clientName: string; senderName: string }) {
  const text = t('next.letter.body', { client: clientName, name: senderName });
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(t('next.letter.copied'));
    } catch {
      toast.error(t('errors.internal'));
    }
  };
  // Only the subject goes into the mailto link: the body is copied (no names in URLs).
  const mailto = `mailto:?subject=${encodeURIComponent(t('next.letter.subject'))}`;
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={t('next.letter.title')}
      description={t('next.letter.text')}
      wide
      footer={
        <>
          <Button variant="secondary" onClick={() => downloadText(censusTemplateCsv(), 'census-template.csv')}>
            {t('next.letter.templateCsv')}
          </Button>
          <Button variant="secondary" asChild>
            <a href={mailto}>
              <Mail className="h-3.5 w-3.5" aria-hidden /> {t('next.letter.mail')}
            </a>
          </Button>
          <Button onClick={() => void copy()}>
            <Copy className="h-3.5 w-3.5" aria-hidden /> {t('next.letter.copy')}
          </Button>
        </>
      }
    >
      <pre data-testid="client-letter" className="whitespace-pre-wrap rounded-btn border border-border-soft bg-rail/50 p-3 font-sans text-[13px]">
        {text}
      </pre>
    </Modal>
  );
}

/** «Подробнее в справке»: the section of the guide in the person's portal. */
export function HelpMore({ article, section }: { article: string; section?: string }) {
  const user = useUser();
  if (!user) return null;
  return (
    <Link to={helpHref(helpBase(user.role), article, section)} className="inline-flex items-center gap-1 text-accent-text underline-offset-2 hover:underline" data-testid="help-more">
      <BookOpen className="h-3.5 w-3.5" aria-hidden /> {t('next.help')}
    </Link>
  );
}

/**
 * The action of a step for MIG staff: the button to the place (with the form open) when the person may do
 * it, otherwise «Попросить {ответственный}». `label` overrides the action's default text.
 */
export function StepAction({ action, refs, role, label, size = 'md', primary = true }: { action: TaskAction; refs: TaskRefs & { subjectType: TaskSubjectType; subjectId: string }; role?: Role; label?: string; size?: Size; primary?: boolean }) {
  const canDo = useCanDo(action);
  const responsible = role ?? ACTION_ROLE[action];
  if (canDo)
    return (
      <Button size={size} variant={primary ? 'primary' : 'secondary'} asChild>
        <Link to={staffActionPath(action, refs)} data-testid={`do-${action}`}>
          {label ?? tKey(`next.action.${action}`)}
        </Link>
      </Button>
    );
  return <AskButton role={responsible} action={action} subjectType={refs.subjectType} subjectId={refs.subjectId} size={size} />;
}
