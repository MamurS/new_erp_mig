/*
 * /staff/admin/ai → «Справка»: questions the help could not answer and answers rated «Не полезно»
 * (texts redacted on the server like every AI input; role and language only, no author). The guide
 * docs/help/USER_GUIDE.ru.md is extended from this list.
 */
import { LOCALE_NAME, t } from '@/i18n';
import type { HelpQuestionRow } from '@mig/contracts/help';
import { useHelpQuestionsAdmin } from '@/shared/api/queries/help';
import { ROLE_LABEL } from '@mig/domain/labels';
import { formatDateTime } from '@mig/domain/lib/format';
import { DataTable, type Column } from '@/shared/ui/data-table';
import { Card } from '@/shared/ui/page';
import { QueryState } from '@/shared/ui/states';

const columns = (): Column<HelpQuestionRow>[] => [
  { key: 'at', header: t('help.admin.col.date'), cell: (r) => <span className="num whitespace-nowrap">{formatDateTime(r.at)}</span> },
  { key: 'question', header: t('help.admin.col.question'), cell: (r) => <span className="whitespace-normal">{r.question}</span> },
  { key: 'role', header: t('help.admin.col.role'), cell: (r) => ROLE_LABEL[r.role] },
  { key: 'locale', header: t('help.admin.col.locale'), cell: (r) => LOCALE_NAME[r.locale] },
  { key: 'sources', header: t('help.admin.col.sources'), cell: (r) => <span className="num text-[12px] text-muted">{r.sources.join(', ') || '—'}</span> },
];

export function HelpQuestionsTab() {
  const q = useHelpQuestionsAdmin();
  return (
    <QueryState query={q}>
      {(v) => (
        <div className="flex flex-col gap-4" data-testid="help-questions">
          <p className="text-[13px]">{t('help.admin.summary', { total: v.total, answered: v.answered, noAnswer: v.noAnswer, helpful: v.helpful, notHelpful: v.notHelpful })}</p>
          <p className="text-[12px] text-muted">{t('help.admin.hint')}</p>
          <Card title={t('help.admin.unanswered')} bodyClassName="p-0">
            <DataTable caption={t('help.admin.unanswered')} columns={columns()} rows={v.unanswered} rowKey={(r) => r.id} empty={t('help.admin.empty')} />
          </Card>
          <Card title={t('help.admin.notHelpful')} bodyClassName="p-0">
            <DataTable caption={t('help.admin.notHelpful')} columns={columns()} rows={v.notHelpfulQuestions} rowKey={(r) => r.id} empty={t('help.admin.empty')} />
          </Card>
        </div>
      )}
    </QueryState>
  );
}
