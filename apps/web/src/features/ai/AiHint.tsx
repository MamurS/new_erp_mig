/*
 * «Подсказка ИИ» in decision screens (AI_COVERAGE_SPEC §4.3): the proposed verdict, matched codes with
 * confidence, applied clauses and a short rationale. It never fills the decision: the person decides and
 * rates the hint («Согласен» / «Не согласен» with a comment).
 */
import { useState } from 'react';
import { Sparkles } from 'lucide-react';
import { useAiFeedback, useAiHint, useAiStatus } from '@/shared/api/queries/ai';
import { errorMessage } from '@/shared/api/client';
import { useCan } from '@/shared/auth/guards';
import { useUser } from '@/shared/auth/session';
import { aiFeedbackSchema } from '@mig/contracts/forms';
import { Button } from '@/shared/ui/button';
import { Chip } from '@/shared/ui/chips';
import { Modal } from '@/shared/ui/dialog';
import { Field, Textarea } from '@/shared/ui/input';
import { Card } from '@/shared/ui/page';
import { toast } from '@/shared/ui/toast';
import { VERDICT_CHIP, VERDICT_SHORT } from './labels';
import { t, tm } from '@/i18n';

export function AiHint({ subject }: { subject: { type: 'claim' | 'guarantee' | 'registry_line'; id: string } }) {
  const user = useUser();
  const mig = useCan('ai.coverage.mig');
  const asst = useCan('ai.coverage.assist', { assistanceId: user?.assistanceId });
  const status = useAiStatus();
  const on = !!status.data && !status.data.killSwitch && status.data.scenarios.decision && (mig || asst);
  const q = useAiHint(subject, on);
  const feedback = useAiFeedback();
  const [rated, setRated] = useState<boolean | null>(null);
  const [disagree, setDisagree] = useState(false);
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string>();
  if (!on) return null;
  const item = q.data?.available ? q.data.items[0] : undefined;
  if (q.data && !q.data.available) return null;

  const send = async (agree: boolean) => {
    if (!item) return;
    const parsed = aiFeedbackSchema.safeParse({ logId: item.logId, agree, comment: agree ? undefined : comment });
    if (!parsed.success) return setError(tm(parsed.error.issues[0]?.message));
    try {
      await feedback.mutateAsync(parsed.data);
      setRated(agree);
      setDisagree(false);
      toast.success(t('ai.hint.thanks'));
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <Card
      title={
        <span className="flex items-center gap-1.5">
          <Sparkles className="h-4 w-4 text-accent" aria-hidden /> {t('ai.hint.title')}
        </span>
      }
      bodyClassName="flex flex-col gap-2 text-[13px]"
    >
      <section data-testid="ai-hint" aria-label={t('ai.hint.title')} className="flex flex-col gap-2">
        {q.isLoading ? (
          <p className="text-muted">{t('ai.hint.loading')}</p>
        ) : q.isError || !item ? (
          <p className="text-muted">{t('ai.hint.unavailable')}</p>
        ) : (
          <>
            <p className="flex flex-wrap items-center gap-2">
              {t('ai.hint.proposed')} <Chip kind={VERDICT_CHIP[item.needsSpecialist ? 'unknown' : item.verdict.decision]}>{VERDICT_SHORT[item.needsSpecialist ? 'unknown' : item.verdict.decision]}</Chip>
            </p>
            {item.matches.length > 0 && (
              <p className="text-muted">
                {t('ai.hint.codes')}{' '}
                {item.matches.map((m) => (
                  <span key={m.code} className="mr-2 whitespace-nowrap">
                    <span className="num">{m.code}</span> {m.name} · {Math.round(m.confidence * 100)}%
                  </span>
                ))}
              </p>
            )}
            {item.clauses.length > 0 && <p className="text-muted">{t('ai.hint.clauses', { list: item.clauses.map((c) => c.label).join('; ') })}</p>}
            <p>{item.explanation}</p>
            <p className="text-[12px] text-muted">{t('ai.hint.note')}</p>
            {rated === null ? (
              <div className="flex gap-2">
                <Button size="sm" variant="secondary" loading={feedback.isPending && !disagree} onClick={() => void send(true)}>
                  {t('ai.hint.agree')}
                </Button>
                <Button size="sm" variant="secondary" onClick={() => setDisagree(true)}>
                  {t('ai.hint.disagree')}
                </Button>
              </div>
            ) : (
              <p className="text-[12px] text-muted" data-testid="ai-rated">
                {rated ? t('ai.hint.ratedAgree') : t('ai.hint.ratedDisagree')}
              </p>
            )}
          </>
        )}
      </section>
      {disagree && (
        <Modal
          open
          onOpenChange={(o) => !o && setDisagree(false)}
          title={t('ai.hint.disagreeTitle')}
          description={t('ai.hint.disagreeDescription')}
          footer={
            <>
              <Button variant="secondary" onClick={() => setDisagree(false)}>
                {t('common.cancel')}
              </Button>
              <Button loading={feedback.isPending} onClick={() => void send(false)}>
                {t('common.send')}
              </Button>
            </>
          }
        >
          <Field label={t('common.comment')} error={error}>
            {(a) => <Textarea {...a} rows={3} maxLength={500} value={comment} onChange={(e) => setComment(e.target.value)} />}
          </Field>
        </Modal>
      )}
    </Card>
  );
}
