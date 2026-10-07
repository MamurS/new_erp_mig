/*
 * Help text with glossary terms: a term is underlined with dots and its definition is shown in a tooltip
 * on hover and on keyboard focus (Radix tooltip: the definition becomes the trigger's description).
 * Each term is marked once per article, so the text does not turn into a row of underlines.
 */
import { Fragment, type ReactNode } from 'react';
import type { HelpTerm } from '@/shared/types/help';
import { splitTerms } from '@/shared/help/glossary';
import { Tooltip } from '@/shared/ui/tooltip';

export function GlossaryTerm({ term, children }: { term: HelpTerm; children: ReactNode }) {
  return (
    <Tooltip
      content={
        <span className="block text-left">
          <span className="font-semibold">{term.term}</span> — {term.definition}
        </span>
      }
    >
      <span tabIndex={0} data-help-term={term.id} className="help-term cursor-help underline decoration-dotted decoration-from-font underline-offset-[3px] focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-accent">
        {children}
      </span>
    </Tooltip>
  );
}

/**
 * A `renderText` hook for HelpMarkdown: glossary terms become GlossaryTerm. `seen` is shared by the
 * parts of one article (created anew on every render, so the first mention is the marked one).
 */
export function termRenderer(terms: readonly HelpTerm[], seen: Set<string>) {
  return function renderText(text: string, key: string): ReactNode {
    if (!terms.length) return text;
    return splitTerms(text, terms, seen).map((s, i) =>
      s.term ? (
        <GlossaryTerm key={`${key}.g${i}`} term={s.term}>
          {s.text}
        </GlossaryTerm>
      ) : (
        <Fragment key={`${key}.g${i}`}>{s.text}</Fragment>
      ),
    );
  };
}
