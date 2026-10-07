/*
 * «Задачи от МИГ» on the home page of the HR cabinet: what MIG asked the client for («Запросить у HR»).
 * The button does the action in place (appendix 2 is uploaded right here); when it is done the task closes
 * and the MIG manager who asked is notified. Hidden while there are no tasks.
 */
import { t, tm } from '@/i18n';
import { Link } from 'react-router-dom';
import { ClipboardList } from 'lucide-react';
import type { WorkTask } from '@/shared/types/dto';
import { errorMessage } from '@/shared/api/client';
import { useUploadInsuredList } from '@/shared/api/queries/lifecycle';
import { useTaskDone, useTasks } from '@/shared/api/queries/tasks';
import { annex2TemplateCsv } from '@/shared/domain/policies';
import { downloadText } from '@/shared/lib/csv';
import { formatDate } from '@/shared/lib/format';
import { Button } from '@/shared/ui/button';
import { toast } from '@/shared/ui/toast';
import { CsvFileButton } from '@/features/staff/lifecycle/common';
import { HrCard, HrSectionTitle } from '@/features/hr/ui';

function TaskRow({ task }: { task: WorkTask }) {
  const upload = useUploadInsuredList();
  const done = useTaskDone();
  const run = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      toast.success(ok);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  return (
    <li className="flex flex-wrap items-start gap-3 py-3" data-testid="hr-task">
      <div className="min-w-0 flex-1">
        <p className="font-semibold">
          {tm(task.title)}
          {task.dueDate && <span className="num font-normal text-muted"> · {t('next.hr.due', { date: formatDate(task.dueDate) })}</span>}
        </p>
        {task.comment && <p className="mt-0.5 text-[14px]">{task.comment}</p>}
        <p className="mt-0.5 text-[13px] text-muted">{t('next.hr.from', { name: task.createdByName })}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {task.action === 'insured_list' && task.contractId ? (
          <>
            <CsvFileButton
              label={t('next.hr.upload')}
              ariaLabel={t('next.annex2.focus')}
              busy={upload.isPending}
              maxBytes={5 * 1024 * 1024}
              testId="hr-task-upload"
              onText={(csv) => void run(() => upload.mutateAsync({ id: task.contractId!, csv }), t('next.hr.uploaded'))}
            />
            <Button variant="link" size="sm" onClick={() => downloadText(annex2TemplateCsv(), 'annex2-template.csv')}>
              {t('next.template')}
            </Button>
          </>
        ) : (
          <>
            {task.link !== '/hr' && (
              <Button variant="secondary" size="sm" asChild>
                <Link to={task.link}>{t('next.hr.open')}</Link>
              </Button>
            )}
            <Button size="sm" loading={done.isPending} onClick={() => void run(() => done.mutateAsync(task.id), t('next.hr.doneToast'))}>
              {t('next.hr.markDone')}
            </Button>
          </>
        )}
      </div>
    </li>
  );
}

export function HrTasks() {
  const q = useTasks('open');
  const tasks = q.data ?? [];
  if (!tasks.length) return null;
  return (
    <HrCard className="mb-6">
      <section aria-labelledby="hr-tasks-title" data-testid="hr-tasks">
        <HrSectionTitle className="mb-1 flex items-center gap-2">
          <ClipboardList className="h-5 w-5 text-accent" aria-hidden />
          <span id="hr-tasks-title">{t('next.hr.title')}</span>
        </HrSectionTitle>
        <ul className="divide-y divide-border-soft">
          {tasks.map((task) => (
            <TaskRow key={task.id} task={task} />
          ))}
        </ul>
      </section>
    </HrCard>
  );
}
