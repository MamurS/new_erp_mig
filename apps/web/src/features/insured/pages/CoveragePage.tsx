/* «Покрывается ли?» (AI_COVERAGE_SPEC §4.1): a preliminary answer about the person's own policy. */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { MessageCircle, Search, ShieldQuestion } from 'lucide-react';
import { useI18n } from '@/i18n';
import { useAiCheck, useAiStatus } from '@/shared/api/queries/ai';
import type { AiCheckItem } from '@mig/contracts/dto';
import { formatMoney } from '@mig/domain/lib/format';
import { useDocumentTitle } from '@/shared/lib/hooks';
import { cn } from '@/shared/lib/cn';
import { Button } from '@/shared/ui/button';
import { Field, Input } from '@/shared/ui/input';
import { BIG, LoadError, ScreenHeader } from '../components';
import { NoMedical, PersonNote, usePerson } from '../person';
import { aiLang } from '../lib';

const EXAMPLES = ['mri', 'nurofen', 'vitaminD', 'teethCleaning'] as const;
const TONE = { covered: 'bg-accent-soft text-accent-text', needs_guarantee: 'bg-sun text-sun-text', excluded: 'bg-danger-soft text-danger-text', limit_exhausted: 'bg-danger-soft text-danger-text', policy_inactive: 'bg-danger-soft text-danger-text', unknown: 'bg-sky text-sky-text' } as const;

export default function CoveragePage() {
  const { medical } = usePerson();
  return medical ? <Coverage /> : <NoMedical />;
}

function Coverage() {
  const { t, lang } = useI18n();
  useDocumentTitle(t('app.coverage.title'));
  const navigate = useNavigate();
  const status = useAiStatus();
  const check = useAiCheck();
  const { personId } = usePerson();
  const [query, setQuery] = useState('');
  const [asked, setAsked] = useState('');
  const [error, setError] = useState<string>();
  const [result, setResult] = useState<{ item?: AiCheckItem; off: boolean } | null>(null);
  const off = !!status.data && !status.data.scenarios.insured;

  const run = async (q: string) => {
    const text = q.trim();
    if (text.length < 2) return setError(t('app.coverage.err'));
    setError(undefined);
    setAsked(text);
    try {
      const r = await check.mutateAsync({ scenario: 'insured', query: text, lang: aiLang(lang), personId });
      setResult({ item: r.items[0], off: !r.available });
    } catch {
      setResult(null);
    }
  };

  const item = result?.item;
  const decision = item ? (item.needsSpecialist ? 'unknown' : item.verdict.decision) : null;
  return (
    <div>
      <ScreenHeader title={t('app.coverage.title')} back="/app" />
      <PersonNote />
      {off || result?.off ? (
        <section className="flex flex-col items-center gap-3 rounded-card bg-sky p-5 text-center text-sky-text" data-testid="coverage-off" role="status">
          <ShieldQuestion className="h-8 w-8" aria-hidden />
          <p className="font-semibold">{t('app.coverage.off')}</p>
          <Button className={BIG} onClick={() => navigate('/app/chat')}>
            <MessageCircle className="h-5 w-5" aria-hidden /> {t('app.coverage.ask')}
          </Button>
        </section>
      ) : (
        <>
          <form
            noValidate
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              void run(query);
            }}
          >
            <Field label={t('app.coverage.field')} error={error}>
              {(a) => <Input {...a} value={query} maxLength={300} placeholder={t('app.coverage.placeholder')} onChange={(e) => setQuery(e.target.value)} className="h-12 text-[15px]" />}
            </Field>
            <div className="flex flex-wrap items-center gap-2 text-[13px]">
              <span className="text-muted">{t('app.coverage.examples')}:</span>
              {EXAMPLES.map((k) => t(`app.coverage.example.${k}`)).map((x) => (
                <button
                  key={x}
                  type="button"
                  className="min-h-[36px] rounded-full border border-border bg-surface px-3 font-semibold hover:border-accent"
                  onClick={() => {
                    setQuery(x);
                    void run(x);
                  }}
                >
                  {x}
                </button>
              ))}
            </div>
            <Button type="submit" loading={check.isPending} className={BIG}>
              <Search className="h-5 w-5" aria-hidden /> {t('app.coverage.check')}
            </Button>
          </form>
          {check.isError && (
            <div className="mt-4">
              <LoadError error={check.error} onRetry={() => void run(asked)} />
            </div>
          )}
          {item && decision && (
            <section className="mt-5 flex flex-col gap-3" aria-live="polite" data-testid="coverage-result">
              <div className={cn('rounded-hero p-5', TONE[decision])}>
                <p className="font-heading text-[22px] font-semibold" data-testid="coverage-verdict">
                  {t(`app.coverage.v.${decision}`)}
                </p>
                {item.matches[0] && !item.needsSpecialist && <p className="mt-1 text-[14px] font-semibold">{item.matches[0].name}</p>}
                {item.clauses[0] && (
                  <p className="mt-2 text-[14px]" data-testid="coverage-clause">
                    {t('app.coverage.clause', { clause: item.clauses.map((c) => c.label).join('; ') })}
                  </p>
                )}
                {item.verdict.limit && (
                  <p className="mt-1 text-[14px] font-semibold" data-testid="coverage-limit">
                    {t('app.coverage.limit', { category: t(`app.limitAcc.${item.verdict.limit.category}`), amount: formatMoney(item.verdict.limit.remaining) })}
                  </p>
                )}
              </div>
              <p className="text-[13px] text-muted">{t('app.coverage.disclaimer')}</p>
              <Button variant="secondary" className={BIG} onClick={() => navigate('/app/chat', { state: { draft: t('app.coverage.question', { query: asked }) } })}>
                <MessageCircle className="h-5 w-5" aria-hidden /> {t('app.coverage.ask')}
              </Button>
            </section>
          )}
        </>
      )}
    </div>
  );
}
