/*
 * The answer of «Спросить» (HelpFinder.tsx): the AI scenario `help` answers only from the guide the role may
 * read (short answer, numbered steps, warnings, «Подробнее» links to the source subsections, «Открыть
 * раздел», «Полезно / Не полезно»). No answer → an honest «В справке нет ответа» and the portal's support
 * channel.
 */
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, ThumbsDown, ThumbsUp } from 'lucide-react';
import { t } from '@/i18n';
import type { Role } from '@/shared/types';
import type { HelpAnswer } from '@/shared/types/help';
import { useHelpFeedback } from '@/shared/api/queries/help';
import { errorMessage } from '@/shared/api/client';
import { Button } from '@/shared/ui/button';
import { toast } from '@/shared/ui/toast';
import { helpHref } from './paths';
import { OpenSectionLinks, SupportLink } from './HelpLinks';

export function AnswerView({ answer, role, base, support }: { answer: HelpAnswer; role: Role; base: string; support?: ReactNode }) {
  const feedback = useHelpFeedback();
  const [rated, setRated] = useState(false);
  if (answer.status === 'no_answer') {
    return (
      <div className="mt-4 rounded-btn border border-border-soft bg-bg p-3" data-testid="help-no-answer">
        <p className="font-semibold">{t('help.ask.noAnswer')}</p>
        <p className="mt-1 text-[13px] text-muted">{t('help.ask.noAnswerHint')}</p>
        <div className="mt-3">
          <SupportLink role={role} override={support} />
        </div>
      </div>
    );
  }
  const rate = async (helpful: boolean) => {
    if (!answer.id) return;
    try {
      await feedback.mutateAsync({ id: answer.id, helpful });
      setRated(true);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };
  return (
    <div className="mt-4 flex flex-col gap-3 border-t border-border-soft pt-4 text-[14px]" data-testid="help-answer">
      <h2 className="sr-only">{t('help.ask.answer')}</h2>
      {answer.short && <p className="font-semibold">{answer.short}</p>}
      {answer.steps.length > 0 && (
        <div>
          <h3 className="mb-1 text-[13px] font-semibold text-muted">{t('help.ask.steps')}</h3>
          <ol className="list-decimal space-y-1 pl-6" data-testid="help-answer-steps">
            {answer.steps.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
        </div>
      )}
      {answer.warnings.length > 0 && (
        <div className="rounded-btn bg-warning-soft p-3 text-warning-text">
          <h3 className="mb-1 flex items-center gap-1.5 text-[13px] font-semibold">
            <AlertTriangle className="h-4 w-4" aria-hidden /> {t('help.ask.warnings')}
          </h3>
          <ul className="list-disc space-y-1 pl-6">
            {answer.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      )}
      {answer.sources.length > 0 && (
        <div>
          <h3 className="mb-1 text-[13px] font-semibold text-muted">{t('help.ask.sources')}</h3>
          <ul className="flex flex-col gap-1" data-testid="help-answer-sources">
            {answer.sources.map((s) => (
              <li key={s.anchor}>
                <Link to={helpHref(base, s.articleAnchor, s.anchor)} className="text-accent-text underline underline-offset-2" data-anchor={s.anchor}>
                  {s.title === s.articleTitle ? s.title : `${s.articleTitle} → ${s.title}`}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
      <OpenSectionLinks role={role} links={answer.openRoutes} />
      {answer.id && (
        <div className="flex flex-wrap items-center gap-2 text-[13px]" role="group" aria-label={t('help.ask.feedback')}>
          {rated ? (
            <span className="text-muted" role="status">
              {t('help.ask.thanks')}
            </span>
          ) : (
            <>
              <span className="text-muted">{t('help.ask.feedback')}</span>
              <Button size="sm" variant="secondary" loading={feedback.isPending && feedback.variables?.helpful === true} disabled={feedback.isPending} onClick={() => void rate(true)}>
                <ThumbsUp className="h-3.5 w-3.5" aria-hidden /> {t('help.ask.helpful')}
              </Button>
              <Button size="sm" variant="secondary" loading={feedback.isPending && feedback.variables?.helpful === false} disabled={feedback.isPending} onClick={() => void rate(false)}>
                <ThumbsDown className="h-3.5 w-3.5" aria-hidden /> {t('help.ask.notHelpful')}
              </Button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
