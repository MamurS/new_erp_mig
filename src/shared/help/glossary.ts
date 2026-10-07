/*
 * The glossary (article {#glossary}): a table «Термин | Что означает». The term cell is
 * `**ГП — гарантийное письмо** (uz, en)`: names in bold separated by « — », «, » or « / », equivalents
 * in the other languages in parentheses. Every name of a row is a synonym of the others for the search.
 */
import type { HelpTerm } from '@/shared/types/help';
import { inlineText, parseMarkdown, type Inline } from './markdown';
import { normalizeSearch } from '@/shared/lib/searchNormalize';
import { EXTRA_SYNONYMS } from './lang';

export const GLOSSARY_ANCHOR = 'glossary';

function splitNames(s: string): string[] {
  return s
    .split(/\s+—\s+|,\s+|\s+\/\s+/u)
    .map((x) => x.trim())
    .filter(Boolean);
}

function slug(s: string): string {
  return (
    normalizeSearch(s)
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'term'
  );
}

/** Terms of the glossary article's markdown (already filtered for the role). */
export function parseGlossary(markdown: string): HelpTerm[] {
  const terms: HelpTerm[] = [];
  const ids = new Set<string>();
  for (const b of parseMarkdown(markdown)) {
    if (b.type !== 'table') continue;
    for (const row of b.rows) {
      const cell: Inline[] = row[0] ?? [];
      const strong = cell.filter((n) => n.type === 'strong');
      const bold = strong.map((n) => inlineText([n])).join(' ').trim();
      const rest = inlineText(cell.filter((n) => n.type !== 'strong'));
      const term = bold || inlineText(cell).trim();
      if (!term) continue;
      const paren = /\(([^)]*)\)/u.exec(rest)?.[1] ?? '';
      const synonyms = [...new Set([...splitNames(term), ...splitNames(paren)])];
      let id = slug(synonyms[0] ?? term);
      while (ids.has(id)) id += '-x';
      ids.add(id);
      terms.push({ id, term, definition: inlineText(row[1] ?? []).trim(), synonyms });
    }
  }
  return terms;
}

/** Synonym groups for the search: glossary rows with two or more names, plus EXTRA_SYNONYMS. */
export function synonymGroups(terms: readonly HelpTerm[]): string[][] {
  const groups = terms.filter((t) => t.synonyms.length > 1).map((t) => [...t.synonyms]);
  return [...groups, ...EXTRA_SYNONYMS.map((g) => [...g])];
}

export type TermSegment = { text: string; term?: HelpTerm };

interface TermPattern {
  re: RegExp;
  term: HelpTerm;
}

const patternCache = new WeakMap<readonly HelpTerm[], TermPattern[]>();

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function patterns(terms: readonly HelpTerm[]): TermPattern[] {
  let p = patternCache.get(terms);
  if (!p) {
    p = terms
      .flatMap((term) =>
        term.synonyms
          .filter((s) => s.length >= 2)
          .map((s) => {
            // Abbreviations match exactly; words also with an inflection ending («лимит» → «лимита»).
            const abbr = s === s.toUpperCase();
            const body = escapeRe(s);
            const re = abbr ? new RegExp(`(?<![\\p{L}\\p{N}])${body}(?![\\p{L}\\p{N}])`, 'u') : new RegExp(`(?<![\\p{L}\\p{N}])${body}\\p{L}{0,3}(?![\\p{L}\\p{N}])`, 'iu');
            return { re, term, len: s.length };
          }),
      )
      .sort((a, b) => b.len - a.len)
      .map(({ re, term }) => ({ re, term }));
    patternCache.set(terms, p);
  }
  return p;
}

/**
 * Splits a text into plain runs and glossary term mentions (longest names first). `seen` (optional) keeps
 * the ids of terms already marked, to mark each term once per article.
 */
export function splitTerms(text: string, terms: readonly HelpTerm[], seen?: Set<string>): TermSegment[] {
  const pats = patterns(terms);
  const out: TermSegment[] = [];
  let rest = text;
  while (rest) {
    let best: { index: number; length: number; term: HelpTerm } | null = null;
    for (const p of pats) {
      if (seen?.has(p.term.id)) continue;
      const m = p.re.exec(rest);
      if (m && (!best || m.index < best.index)) best = { index: m.index, length: m[0].length, term: p.term };
    }
    if (!best) break;
    if (best.index > 0) out.push({ text: rest.slice(0, best.index) });
    out.push({ text: rest.slice(best.index, best.index + best.length), term: best.term });
    seen?.add(best.term.id);
    rest = rest.slice(best.index + best.length);
  }
  if (rest) out.push({ text: rest });
  return out;
}
