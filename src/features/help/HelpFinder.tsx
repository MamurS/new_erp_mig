/*
 * One field at the top of the help: «Найдите термин или задайте вопрос» (DECISIONS «Справка: одно поле»).
 * - While the person types, the search results show right under the field: «Термины», «Статьи», the match
 *   highlighted (server search over what the role may read).
 * - The first row is always «Спросить: «…»» — it gets the step-by-step answer (AI scenario `help`). It is
 *   hidden while the scenario is off; the search keeps working.
 * - A question (isQuestion: «?» at the end, a question word, more than five words) is answered by itself after
 *   a 600 ms pause in typing; the answer card stands above the results, which stay visible and clickable while
 *   it is being prepared. «гп», «STIR» only search.
 * - Keyboard (ARIA combobox): ↓/↑ move through the rows, Enter on a row opens it, Enter with no row chosen
 *   asks, Esc closes the list.
 * - `initialQuestion` (from «Спросить в справке» of Ctrl+K, passed in the router state — never in the URL):
 *   asked at once.
 */
import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { BookOpen, Loader2, MessageCircleQuestion, Search, Tag } from 'lucide-react';
import { tp, t, tm, useLocale } from '@/i18n';
import type { Role } from '@/shared/types';
import type { HelpAnswer, HelpSearchHit, HelpTermHit } from '@/shared/types/help';
import { useAiStatus } from '@/shared/api/queries/ai';
import { useHelpAnswer, useHelpSearch } from '@/shared/api/queries/help';
import { errorMessage } from '@/shared/api/client';
import { GLOSSARY_ANCHOR } from '@/shared/help/glossary';
import { isQuestion } from '@/shared/help/question';
import { helpAnswerRequestSchema } from '@/shared/schemas/forms';
import { useDebounced } from '@/shared/lib/hooks';
import { cn } from '@/shared/lib/cn';
import { helpHref } from './paths';
import { Snippet } from './Snippet';
import { AnswerView } from './HelpAnswer';

type Option =
  | { kind: 'ask'; text: string }
  | { kind: 'term'; hit: HelpTermHit; to: string }
  | { kind: 'article'; hit: HelpSearchHit; to: string };

const MAX_TERMS = 4;
const MAX_ARTICLES = 8;
/** The pause in typing after which a question is answered by itself. */
export const AUTO_ASK_MS = 600;

interface AnswerState {
  question: string;
  answer: HelpAnswer | null;
  error: string | null;
}

export function HelpFinder({ role, base, support, onOpen, initialQuestion }: { role: Role; base: string; support?: ReactNode; onOpen: (to: string) => void; initialQuestion?: string | null }) {
  const locale = useLocale();
  const id = useId();
  const [q, setQ] = useState(initialQuestion ?? '');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [state, setState] = useState<AnswerState | null>(null);
  const term = useDebounced(q.trim(), 200);
  const pause = useDebounced(q.trim(), AUTO_ASK_MS);
  const search = useHelpSearch(term, locale);
  const status = useAiStatus();
  const ask = useHelpAnswer();
  const rootRef = useRef<HTMLDivElement>(null);
  const seq = useRef(0);
  const lastAsked = useRef<string | null>(null);
  const aiOff = (status.data ? !status.data.scenarios.help : false) || state?.answer?.status === 'disabled';
  const text = q.trim();
  const shown = open && text.length >= 2;

  const run = useCallback(
    async (question: string) => {
      const parsed = helpAnswerRequestSchema.safeParse({ question, locale });
      if (!parsed.success) {
        setState({ question, answer: null, error: tm(parsed.error.issues[0]?.message) || t('help.ask.length') });
        return;
      }
      lastAsked.current = parsed.data.question;
      const mine = ++seq.current;
      setState({ question: parsed.data.question, answer: null, error: null });
      try {
        const answer = await ask.mutateAsync(parsed.data);
        // Only the answer to the latest question is shown.
        if (mine === seq.current) setState({ question: parsed.data.question, answer, error: null });
      } catch (e) {
        if (mine === seq.current) setState({ question: parsed.data.question, answer: null, error: errorMessage(e) });
      }
    },
    [ask, locale],
  );

  // A question is answered by itself after a pause in typing.
  useEffect(() => {
    if (aiOff || !pause || pause !== text || pause === lastAsked.current || !isQuestion(pause)) return;
    void run(pause);
  }, [pause, text, aiOff, run]);

  // From «Спросить в справке» of the command palette: asked at once.
  useEffect(() => {
    if (!initialQuestion) return;
    setQ(initialQuestion);
    if (!aiOff) void run(initialQuestion);
    // Only on arrival of a new question.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialQuestion]);

  const options = useMemo<Option[]>(() => {
    const d = search.data;
    const out: Option[] = [];
    if (!aiOff && text) out.push({ kind: 'ask', text });
    if (d && term.length >= 2) {
      out.push(...d.terms.slice(0, MAX_TERMS).map((hit): Option => ({ kind: 'term', hit, to: helpHref(base, GLOSSARY_ANCHOR) })));
      out.push(...d.articles.slice(0, MAX_ARTICLES).map((hit): Option => ({ kind: 'article', hit, to: helpHref(base, hit.articleAnchor, hit.anchor) })));
    }
    return out;
  }, [search.data, term, base, aiOff, text]);
  // A new list: no row is chosen (Enter asks).
  useEffect(() => setActive(-1), [term, aiOff]);

  // A click outside closes the results (the answer stays).
  useEffect(() => {
    if (!shown) return;
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [shown]);

  const choose = (o: Option | undefined) => {
    if (!o) return;
    if (o.kind === 'ask') {
      void run(o.text);
      return;
    }
    setOpen(false);
    onOpen(o.to);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!options.length) return;
      e.preventDefault();
      setOpen(true);
      const n = options.length;
      setActive((i) => (e.key === 'ArrowDown' ? (i + 1) % n : i <= 0 ? n - 1 : i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (shown && active >= 0 && options[active]) choose(options[active]);
      else if (text && !aiOff) void run(text);
    } else if (e.key === 'Escape' && shown) {
      e.preventDefault();
      setOpen(false);
      setActive(-1);
    }
  };

  const listId = `${id}-list`;
  const optId = (i: number) => `${id}-o${i}`;
  const loading = search.isFetching && !search.data;
  const indexOf = (o: Option) => options.indexOf(o);
  const askRow = options.find((o) => o.kind === 'ask');
  const terms = options.filter((o): o is Extract<Option, { kind: 'term' }> => o.kind === 'term');
  const articles = options.filter((o): o is Extract<Option, { kind: 'article' }> => o.kind === 'article');
  const found = terms.length + articles.length;

  return (
    <div ref={rootRef} className="flex flex-col gap-3" data-testid="help-finder">
      <div className="relative">
        <label htmlFor={`${id}-input`} className="sr-only">
          {t('help.finder.label')}
        </label>
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
        <input
          id={`${id}-input`}
          type="search"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={shown}
          aria-controls={listId}
          aria-activedescendant={shown && active >= 0 && options[active] ? optId(active) : undefined}
          aria-describedby={`${id}-hint`}
          value={q}
          maxLength={300}
          autoComplete="off"
          placeholder={t('help.finder.placeholder')}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          className="h-11 w-full rounded-btn border border-border bg-surface pl-9 pr-3 text-[14px] text-text placeholder:text-muted focus:outline-2 focus:outline-accent"
        />
      </div>
      <p id={`${id}-hint`} className="-mt-1.5 text-[12px] text-muted">
        {aiOff ? t('help.ask.disabled') : t('help.finder.hint')}
      </p>

      {state && (
        <section aria-label={t('help.ask.answer')} aria-busy={!state.answer && !state.error} aria-live="polite" className="rounded-card border border-border bg-surface p-4" data-testid="help-answer-card">
          <p className="flex items-center gap-2 text-[13px] font-semibold text-muted">
            <MessageCircleQuestion className="h-4 w-4 text-accent" aria-hidden />
            <span className="min-w-0 truncate">{t('help.finder.question', { text: state.question })}</span>
          </p>
          {state.error ? (
            <p role="alert" className="mt-2 text-[13px] text-danger-text">
              {state.error}
            </p>
          ) : !state.answer ? (
            <p className="mt-3 flex items-center gap-2 text-[13px] text-muted" data-testid="help-answer-loading">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> {t('help.finder.preparing')}
            </p>
          ) : state.answer.status !== 'disabled' ? (
            <AnswerView key={state.answer.id ?? state.question} answer={state.answer} role={role} base={base} support={support} />
          ) : null}
        </section>
      )}

      <p className="sr-only" aria-live="polite">
        {shown && search.data ? (found ? tp('help.search.found', found, { n: found }) : t('help.search.empty')) : ''}
      </p>
      {shown && (
        <div id={listId} role="listbox" aria-label={t('help.search.results')} className="max-h-[60vh] overflow-y-auto rounded-card border border-border bg-surface p-1 text-text shadow-sm">
          {askRow && (
            <OptionRow id={optId(indexOf(askRow))} active={indexOf(askRow) === active} onHover={() => setActive(indexOf(askRow))} onChoose={() => choose(askRow)} testId="help-ask-row">
              <MessageCircleQuestion className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden />
              <span className="min-w-0 font-semibold">{t('help.finder.ask', { text })}</span>
            </OptionRow>
          )}
          {loading ? (
            <p className="px-3 py-3 text-center text-[13px] text-muted">…</p>
          ) : found === 0 ? (
            <p className="px-3 py-3 text-center text-[13px] text-muted">{t('help.search.empty')}</p>
          ) : (
            <>
              {terms.length > 0 && (
                <Group label={t('help.search.terms')} id={`${id}-gt`}>
                  {terms.map((o) => (
                    <OptionRow key={`t-${o.hit.term.id}`} id={optId(indexOf(o))} active={indexOf(o) === active} onHover={() => setActive(indexOf(o))} onChoose={() => choose(o)}>
                      <Tag className="mt-0.5 h-4 w-4 shrink-0 text-muted" aria-hidden />
                      <span className="min-w-0">
                        <span className="block font-semibold">{o.hit.term.term}</span>
                        <Snippet parts={o.hit.snippet} className="block text-[12px] text-muted" />
                      </span>
                    </OptionRow>
                  ))}
                </Group>
              )}
              {articles.length > 0 && (
                <Group label={t('help.search.articles')} id={`${id}-ga`}>
                  {articles.map((o) => (
                    <OptionRow key={`a-${o.hit.anchor}-${o.hit.title}`} id={optId(indexOf(o))} active={indexOf(o) === active} onHover={() => setActive(indexOf(o))} onChoose={() => choose(o)}>
                      <BookOpen className="mt-0.5 h-4 w-4 shrink-0 text-muted" aria-hidden />
                      <span className="min-w-0">
                        <span className="block font-semibold">{o.hit.title}</span>
                        {o.hit.title !== o.hit.articleTitle && <span className="block text-[12px] text-muted">{o.hit.articleTitle}</span>}
                        <Snippet parts={o.hit.snippet} className="block text-[12px] text-muted" />
                      </span>
                    </OptionRow>
                  ))}
                </Group>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function Group({ label, id, children }: { label: string; id: string; children: ReactNode }) {
  return (
    <div role="group" aria-labelledby={id} className="py-1">
      <p id={id} role="presentation" className="px-3 pb-1 pt-1.5 text-[12px] font-semibold uppercase tracking-wide text-muted">
        {label}
      </p>
      {children}
    </div>
  );
}

function OptionRow({ id, active, onHover, onChoose, children, testId }: { id: string; active: boolean; onHover: () => void; onChoose: () => void; children: ReactNode; testId?: string }) {
  return (
    <div
      id={id}
      role="option"
      aria-selected={active}
      data-testid={testId}
      onMouseMove={onHover}
      // Keep the focus in the input: the choice is made on mouse down.
      onMouseDown={(e) => {
        e.preventDefault();
        onChoose();
      }}
      className={cn('flex cursor-pointer items-start gap-2 rounded-btn px-3 py-2 text-[13px]', active && 'bg-accent-soft')}
    >
      {children}
    </div>
  );
}
