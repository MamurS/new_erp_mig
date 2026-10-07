/*
 * Search in the help (server-side, only what the role may read): results grouped «Термины» / «Статьи»,
 * the match highlighted in the snippet. Keyboard: ↓/↑ move through the results, Enter opens, Esc closes
 * (ARIA combobox with a listbox; the active option is announced through aria-activedescendant).
 */
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { BookOpen, Search, Tag } from 'lucide-react';
import { tp, t, useLocale } from '@/i18n';
import type { HelpSearchHit, HelpTermHit } from '@/shared/types/help';
import { useHelpSearch } from '@/shared/api/queries/help';
import { GLOSSARY_ANCHOR } from '@/shared/help/glossary';
import { useDebounced } from '@/shared/lib/hooks';
import { cn } from '@/shared/lib/cn';
import { helpHref } from './paths';
import { Snippet } from './Snippet';

type Option = { kind: 'term'; hit: HelpTermHit; to: string } | { kind: 'article'; hit: HelpSearchHit; to: string };

const MAX_TERMS = 4;
const MAX_ARTICLES = 8;

export function HelpSearch({ base, onOpen }: { base: string; onOpen: (to: string) => void }) {
  const locale = useLocale();
  const id = useId();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const term = useDebounced(q.trim(), 200);
  const search = useHelpSearch(term, locale);
  const rootRef = useRef<HTMLDivElement>(null);
  const shown = open && term.length >= 2;

  const options = useMemo<Option[]>(() => {
    const d = search.data;
    if (!d || term.length < 2) return [];
    return [
      ...d.terms.slice(0, MAX_TERMS).map((hit): Option => ({ kind: 'term', hit, to: helpHref(base, GLOSSARY_ANCHOR) })),
      ...d.articles.slice(0, MAX_ARTICLES).map((hit): Option => ({ kind: 'article', hit, to: helpHref(base, hit.articleAnchor, hit.anchor) })),
    ];
  }, [search.data, term, base]);
  useEffect(() => setActive(0), [options]);

  // A click outside closes the results.
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
    setOpen(false);
    onOpen(o.to);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!options.length) return;
      e.preventDefault();
      setOpen(true);
      setActive((i) => (e.key === 'ArrowDown' ? (i + 1) % options.length : (i - 1 + options.length) % options.length));
    } else if (e.key === 'Enter') {
      if (shown && options[active]) {
        e.preventDefault();
        choose(options[active]);
      }
    } else if (e.key === 'Escape' && shown) {
      e.preventDefault();
      setOpen(false);
    }
  };

  const listId = `${id}-list`;
  const optId = (i: number) => `${id}-o${i}`;
  const terms = options.filter((o) => o.kind === 'term');
  const articles = options.filter((o) => o.kind === 'article');
  const loading = search.isFetching && !search.data;

  return (
    <div ref={rootRef} className="relative" data-testid="help-search">
      <label htmlFor={`${id}-input`} className="sr-only">
        {t('help.search.label')}
      </label>
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
      <input
        id={`${id}-input`}
        type="search"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={shown}
        aria-controls={listId}
        aria-activedescendant={shown && options[active] ? optId(active) : undefined}
        value={q}
        maxLength={200}
        autoComplete="off"
        placeholder={t('help.search.placeholder')}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        className="h-10 w-full rounded-btn border border-border bg-surface pl-9 pr-3 text-[14px] text-text placeholder:text-muted focus:outline-2 focus:outline-accent"
      />
      <p className="sr-only" aria-live="polite">
        {shown && search.data ? (options.length ? tp('help.search.found', options.length, { n: options.length }) : t('help.search.empty')) : ''}
      </p>
      {shown && (
        <div
          id={listId}
          role="listbox"
          aria-label={t('help.search.results')}
          className="absolute left-0 right-0 top-full z-40 mt-1 max-h-[60vh] overflow-y-auto rounded-card border border-border bg-surface p-1 text-text shadow-lg"
        >
          {loading ? (
            <p className="px-3 py-4 text-center text-[13px] text-muted">…</p>
          ) : options.length === 0 ? (
            <p className="px-3 py-4 text-center text-[13px] text-muted">{t('help.search.empty')}</p>
          ) : (
            <>
              {terms.length > 0 && (
                <Group label={t('help.search.terms')} id={`${id}-gt`}>
                  {terms.map((o) => {
                    const i = options.indexOf(o);
                    const hit = (o as Extract<Option, { kind: 'term' }>).hit;
                    return (
                      <OptionRow key={`t-${hit.term.id}`} id={optId(i)} active={i === active} onHover={() => setActive(i)} onChoose={() => choose(o)}>
                        <Tag className="mt-0.5 h-4 w-4 shrink-0 text-muted" aria-hidden />
                        <span className="min-w-0">
                          <span className="block font-semibold">{hit.term.term}</span>
                          <Snippet parts={hit.snippet} className="block text-[12px] text-muted" />
                        </span>
                      </OptionRow>
                    );
                  })}
                </Group>
              )}
              {articles.length > 0 && (
                <Group label={t('help.search.articles')} id={`${id}-ga`}>
                  {articles.map((o) => {
                    const i = options.indexOf(o);
                    const hit = (o as Extract<Option, { kind: 'article' }>).hit;
                    return (
                      <OptionRow key={`a-${hit.anchor}-${hit.title}`} id={optId(i)} active={i === active} onHover={() => setActive(i)} onChoose={() => choose(o)}>
                        <BookOpen className="mt-0.5 h-4 w-4 shrink-0 text-muted" aria-hidden />
                        <span className="min-w-0">
                          <span className="block font-semibold">{hit.title}</span>
                          {hit.title !== hit.articleTitle && <span className="block text-[12px] text-muted">{hit.articleTitle}</span>}
                          <Snippet parts={hit.snippet} className="block text-[12px] text-muted" />
                        </span>
                      </OptionRow>
                    );
                  })}
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

function OptionRow({ id, active, onHover, onChoose, children }: { id: string; active: boolean; onHover: () => void; onChoose: () => void; children: ReactNode }) {
  return (
    <div
      id={id}
      role="option"
      aria-selected={active}
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
