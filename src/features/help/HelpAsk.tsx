/*
 * «Задайте вопрос своими словами»: the AI scenario `help` answers only from the guide the role may read
 * (short answer, numbered steps, warnings, «Подробнее» links to the source subsections, «Открыть раздел»).
 * No answer → an honest «В справке нет ответа» and the portal's support channel. Switched off in the AI
 * settings (or «Отключить ИИ везде») → the box is disabled; the search keeps working.
 */
import { useId, useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, MessageCircleQuestion, ThumbsDown, ThumbsUp } from 'lucide-react';
import { t, tm, useLocale } from '@/i18n';
import type { Role } from '@/shared/types';
import type { HelpAnswer } from '@/shared/types/help';
import { useAiStatus } from '@/shared/api/queries/ai';
import { useHelpAnswer, useHelpFeedback } from '@/shared/api/queries/help';
import { errorMessage } from '@/shared/api/client';
import { helpAnswerRequestSchema } from '@/shared/schemas/forms';
import { Button } from '@/shared/ui/button';
import { toast } from '@/shared/ui/toast';
import { helpHref } from './paths';
import { OpenSectionLinks, SupportLink } from './HelpLinks';

export function HelpAsk({ role, base, support }: { role: Role; base: string; support?: ReactNode }) {
  const locale = useLocale();
  const id = useId();
  const status = useAiStatus();
  const ask = useHelpAnswer();
  const [question, setQuestion] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [answer, setAnswer] = useState<HelpAnswer | null>(null);
  const off = status.data ? !status.data.scenarios.help : false;
  const disabled = off || answer?.status === 'disabled';

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const parsed = helpAnswerRequestSchema.safeParse({ question, locale });
    if (!parsed.success) return setError(tm(parsed.error.issues[0]?.message) || t('help.ask.length'));
    setError(null);
    try {
      setAnswer(await ask.mutateAsync(parsed.data));
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <section aria-labelledby={`${id}-title`} className="rounded-card border border-border bg-surface p-4" data-testid="help-ask">
      <form onSubmit={(e) => void submit(e)} noValidate>
        <label id={`${id}-title`} htmlFor={`${id}-q`} className="flex items-center gap-2 font-semibold">
          <MessageCircleQuestion className="h-4 w-4 text-accent" aria-hidden />
          {t('help.ask.label')}
        </label>
        <div className="mt-2 flex flex-col gap-2 sm:flex-row">
          <input
            id={`${id}-q`}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            maxLength={300}
            disabled={disabled}
            placeholder={t('help.ask.placeholder')}
            aria-invalid={!!error || undefined}
            aria-describedby={`${id}-hint`}
            className="h-10 min-w-0 flex-1 rounded-btn border border-border bg-bg px-3 text-[14px] text-text placeholder:text-muted focus:outline-2 focus:outline-accent disabled:cursor-not-allowed disabled:opacity-60"
          />
          <Button type="submit" size="md" className="h-10" loading={ask.isPending} disabled={disabled}>
            {t('help.ask.submit')}
          </Button>
        </div>
        <p id={`${id}-hint`} className={error ? 'mt-1.5 text-[12px] text-danger-text' : 'mt-1.5 text-[12px] text-muted'} role={error ? 'alert' : undefined}>
          {error ?? (disabled ? t('help.ask.disabled') : t('help.ask.hint'))}
        </p>
      </form>
      {answer && answer.status !== 'disabled' && (
        <div aria-live="polite">
          <AnswerView key={answer.id ?? 'x'} answer={answer} role={role} base={base} support={support} />
        </div>
      )}
    </section>
  );
}

function AnswerView({ answer, role, base, support }: { answer: HelpAnswer; role: Role; base: string; support?: ReactNode }) {
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
