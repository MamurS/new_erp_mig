/*
 * Full-text search over the help content visible to one role (the index is built from already filtered
 * articles, so hidden fragments cannot be found). Ranking: BM25 over light stems of the normalised text
 * (src/shared/lib/searchNormalize: Cyrillic ↔ Latin, ʻ ʼ), with prefix and typo-tolerant matching and
 * synonym groups from the glossary (ГП ↔ гарантийное письмо, ИНН ↔ STIR …).
 *
 * Units: every subsection and article lead; the rows of row-based articles (troubleshooting, statuses,
 * glossary) separately, titled by their first cell.
 */
import type { HelpArticle, HelpSearchHit, HelpSearchResult, HelpSnippetPart, HelpTerm, HelpTermHit } from '@mig/contracts/help';
import { normalizeSearch } from '@/shared/lib/searchNormalize';
import { blocksText, inlineText, parseMarkdown, type Block } from './markdown';
import { GLOSSARY_ANCHOR } from './glossary';
import { foldYo, STOP_WORDS } from './lang';

/** Articles whose table rows are searched (and answered from) one by one. */
export const ROW_ARTICLES: ReadonlySet<string> = new Set(['troubleshooting', 'statuses', GLOSSARY_ANCHOR]);

export type UnitKind = 'section' | 'lead' | 'row' | 'term';

export interface SearchUnit {
  id: string;
  kind: UnitKind;
  anchor: string;
  title: string;
  articleAnchor: string;
  articleTitle: string;
  blocks: Block[];
  text: string;
  term?: HelpTerm;
  /** stem → weighted frequency (title words count TITLE_WEIGHT times). */
  tf: Map<string, number>;
  titleStems: Set<string>;
  length: number;
}

const TITLE_WEIGHT = 3;

// ---------- tokens ----------

const ENDINGS = [
  // ru (transliterated by normalizeSearch)
  'iyami', 'yami', 'ami', 'iyah', 'yah', 'ah', 'ogo', 'ego', 'omu', 'emu', 'ymi', 'imi', 'iyu', 'uyu', 'yuyu', 'aya', 'yaya', 'oye', 'oe', 'ee', 'ie', 'ye', 'yy', 'iy', 'oy', 'ey', 'om', 'em', 'im', 'ym', 'ov', 'ev', 'iya', 'ii', 'yu', 'ya', 'tsya', 'sya', 'ite', 'te', 'ti', 'at', 'yat', 'it', 'et', 'ut', 'yut', 'la', 'lo', 'li', 'a', 'u', 'y', 'i', 'e', 'o',
  // uz-Latn
  'lari', 'larni', 'larga', 'lar', 'ning', 'dan',
  // en
  'ing', 'ed', 'es', 's',
].sort((a, b) => b.length - a.length);

/** Light stemming: one ending off, the stem keeps at least four letters. */
export function stem(token: string): string {
  if (token.length <= 4 || /^\d/.test(token)) return token;
  for (const e of ENDINGS) if (token.endsWith(e) && token.length - e.length >= 4) return token.slice(0, -e.length);
  return token;
}

/** Normalised words of a text: lower case, ё → е, Cyrillic → Latin, apostrophes dropped. */
export function words(text: string): string[] {
  return normalizeSearch(foldYo(text))
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

const STOP = new Set(STOP_WORDS.flatMap((w) => words(w)));

export function stems(text: string, keepStopWords = false): string[] {
  return words(text)
    .filter((w) => keepStopWords || !STOP.has(w))
    .map(stem);
}

/** Damerau–Levenshtein distance with an early exit above `max`. */
export function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= a.length; i++) {
    let best = Infinity;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, d[i - 2]![j - 2]! + 1);
      d[i]![j] = v;
      best = Math.min(best, v);
    }
    if (best > max) return max + 1;
  }
  return d[a.length]![b.length]!;
}

/** How well a word of the index matches a word of the query: 1 exact, less for prefixes and typos. */
export function matchWeight(q: string, w: string): number {
  if (q === w) return 1;
  const short = q.length <= w.length ? q : w;
  const long = q.length <= w.length ? w : q;
  if (short.length >= 4 && long.startsWith(short)) return 0.8;
  // «лид» ~ «лида», «код» ~ «кода»: a short stem with a short ending.
  if (short.length === 3 && long.startsWith(short) && long.length - short.length <= 2) return 0.7;
  if (q.length >= 3 && q.length < 4 && w.startsWith(q)) return 0.5;
  if (q.length >= 5) {
    const max = q.length >= 9 ? 2 : 1;
    if (editDistance(q, w, max) <= max) return 0.6;
    if (q.length >= 6 && w.length > q.length && editDistance(q, w.slice(0, q.length), 1) <= 1) return 0.45;
  }
  return 0;
}

// ---------- index ----------

export interface HelpIndex {
  units: SearchUnit[];
  df: Map<string, number>;
  avgLength: number;
  vocabulary: string[];
  /** Synonym groups as stem phrases. */
  synonyms: string[][][];
  terms: HelpTerm[];
}

function makeUnit(id: string, kind: UnitKind, anchor: string, title: string, article: HelpArticle, blocks: Block[], extra?: { term?: HelpTerm; indexTitle?: string }): SearchUnit {
  const text = blocksText(blocks);
  const tf = new Map<string, number>();
  const titleStems = new Set(stems(extra?.indexTitle ?? title));
  for (const s of titleStems) tf.set(s, (tf.get(s) ?? 0) + TITLE_WEIGHT);
  const body = stems(text);
  for (const s of body) tf.set(s, (tf.get(s) ?? 0) + 1);
  return { id, kind, anchor, title, articleAnchor: article.anchor, articleTitle: article.title, blocks, text, ...(extra?.term ? { term: extra.term } : {}), tf, titleStems, length: body.length + titleStems.size * TITLE_WEIGHT };
}

function rowUnits(article: HelpArticle, blocks: Block[], terms: readonly HelpTerm[]): SearchUnit[] {
  const units: SearchUnit[] = [];
  const glossary = article.anchor === GLOSSARY_ANCHOR;
  let k = 0;
  for (const b of blocks) {
    if (b.type !== 'table') continue;
    for (const row of b.rows) {
      const title = inlineText(row[0] ?? []).trim();
      const rowBlock: Block = { type: 'table', header: b.header, rows: [row] };
      // Glossary rows are the terms parsed from the same table, in the same order.
      const term = glossary ? terms[k] : undefined;
      if (term && title.startsWith(term.term)) units.push(makeUnit(`${article.anchor}#${k}`, 'term', article.anchor, term.term, article, [rowBlock], { term, indexTitle: [term.term, ...term.synonyms].join(' ') }));
      else units.push(makeUnit(`${article.anchor}#${k}`, 'row', article.anchor, title, article, [rowBlock]));
      k++;
    }
  }
  return units;
}

export function buildIndex(articles: readonly HelpArticle[], terms: readonly HelpTerm[], synonymGroups: readonly (readonly string[])[]): HelpIndex {
  const units: SearchUnit[] = [];
  for (const a of articles) {
    const lead = parseMarkdown(a.markdown);
    if (ROW_ARTICLES.has(a.anchor)) {
      units.push(...rowUnits(a, lead, terms));
      const prose = lead.filter((b) => b.type !== 'table');
      if (prose.length) units.push(makeUnit(`${a.anchor}#lead`, 'lead', a.anchor, a.title, a, prose));
    } else if (lead.length) units.push(makeUnit(`${a.anchor}#lead`, 'lead', a.anchor, a.title, a, lead));
    for (const s of a.sections) units.push(makeUnit(s.anchor, 'section', s.anchor, s.title, a, parseMarkdown(s.markdown)));
  }
  const df = new Map<string, number>();
  for (const u of units) for (const s of u.tf.keys()) df.set(s, (df.get(s) ?? 0) + 1);
  const avgLength = units.reduce((n, u) => n + u.length, 0) / Math.max(1, units.length);
  const synonyms = synonymGroups.map((g) => g.map((m) => stems(m, true)).filter((x) => x.length > 0)).filter((g) => g.length > 1);
  return { units, df, avgLength, vocabulary: [...df.keys()], synonyms, terms: [...terms] };
}

// ---------- query ----------

/** One concept of the query: any of the alternatives (each a phrase of stems) counts. */
type Clause = string[][];

export function parseQuery(index: HelpIndex, query: string): Clause[] {
  const q = stems(query);
  const all = stems(query, true);
  const clauses: Clause[] = [];
  const used = new Set<number>();
  // Synonym phrases are looked up in the full word list (short forms like «ГП» are not stop words anyway).
  for (const group of index.synonyms) {
    for (const member of group) {
      for (let i = 0; i + member.length <= all.length; i++) {
        if (member.every((m, k) => all[i + k] === m)) {
          clauses.push(group);
          for (let k = 0; k < member.length; k++) used.add(i + k);
        }
      }
    }
  }
  const usedStems = new Set([...used].map((i) => all[i]));
  for (const s of q) if (!usedStems.has(s) && !clauses.some((c) => c.length === 1 && c[0]!.length === 1 && c[0]![0] === s)) clauses.push([[s]]);
  // Deduplicate identical groups.
  const seen = new Set<string>();
  return clauses.filter((c) => {
    const k = JSON.stringify(c);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

interface Expansion {
  word: string;
  weight: number;
}

function expand(index: HelpIndex, cache: Map<string, Expansion[]>, s: string): Expansion[] {
  const hit = cache.get(s);
  if (hit) return hit;
  const out: Expansion[] = [];
  for (const w of index.vocabulary) {
    const weight = matchWeight(s, w);
    if (weight > 0) out.push({ word: w, weight });
  }
  cache.set(s, out);
  return out;
}

export interface ScoredUnit {
  unit: SearchUnit;
  score: number;
  /** Share of the query's clauses found in the unit (a clause found only with a typo counts less). */
  coverage: number;
  /** Share of the query's clauses found in the title. */
  titleCoverage: number;
  /** Index words that matched (for snippets and highlighting). */
  matched: Set<string>;
}

const K1 = 1.2;
const B = 0.5;

export function scoreUnits(index: HelpIndex, query: string, filter?: (u: SearchUnit) => boolean): { clauses: Clause[]; results: ScoredUnit[] } {
  const clauses = parseQuery(index, query);
  if (!clauses.length) return { clauses, results: [] };
  const n = index.units.length;
  const cache = new Map<string, Expansion[]>();
  const results: ScoredUnit[] = [];
  for (const unit of index.units) {
    if (filter && !filter(unit)) continue;
    let score = 0;
    let found = 0;
    let inTitle = 0;
    const matched = new Set<string>();
    for (const clause of clauses) {
      let best = 0;
      let bestWeight = 0;
      let bestTitle = false;
      let bestWords: string[] = [];
      for (const alt of clause) {
        let altScore = 0;
        let altWeight = 1;
        let altTitle = true;
        const altWords: string[] = [];
        let ok = true;
        for (const s of alt) {
          let tokBest = 0;
          let tokWord = '';
          let tokWeight = 0;
          for (const e of expand(index, cache, s)) {
            const f = unit.tf.get(e.word);
            if (!f) continue;
            const df = index.df.get(e.word) ?? 1;
            const idf = Math.log(1 + (n - df + 0.5) / (df + 0.5));
            const v = e.weight * idf * ((f * (K1 + 1)) / (f + K1 * (1 - B + (B * unit.length) / index.avgLength)));
            if (v > tokBest) {
              tokBest = v;
              tokWord = e.word;
              tokWeight = e.weight;
            }
          }
          if (!tokBest) {
            ok = false;
            break;
          }
          altScore += tokBest;
          altWeight = Math.min(altWeight, tokWeight >= 0.8 ? 1 : tokWeight + 0.2);
          altWords.push(tokWord);
          if (!unit.titleStems.has(tokWord)) altTitle = false;
        }
        if (ok && altScore > best) {
          best = altScore;
          bestWeight = altWeight;
          bestTitle = altTitle;
          bestWords = altWords;
        }
      }
      if (best > 0) {
        // Exact and prefix matches count fully, typo-tolerant ones less.
        found += bestWeight;
        score += best;
        if (bestTitle) inTitle++;
        for (const w of bestWords) matched.add(w);
      }
    }
    if (!found) continue;
    const coverage = found / clauses.length;
    results.push({ unit, score: score * (0.4 + 0.6 * coverage * coverage), coverage, titleCoverage: inTitle / clauses.length, matched });
  }
  results.sort((a, b) => b.score - a.score);
  return { clauses, results };
}

// ---------- snippets ----------

const WORD = /[\p{L}\p{N}ʻʼ'’`-]+/gu;

/** A window of the text around the first match, split into highlighted and plain parts. */
export function snippet(text: string, matched: ReadonlySet<string>, size = 180): HelpSnippetPart[] {
  const flat = text.replace(/\s+/g, ' ').trim();
  const hits: [number, number][] = [];
  for (const m of flat.matchAll(WORD)) {
    const w = words(m[0]).map(stem);
    if (w.some((x) => matched.has(x))) hits.push([m.index, m.index + m[0].length]);
  }
  const first = hits[0]?.[0] ?? 0;
  let start = Math.max(0, first - Math.floor(size / 3));
  if (start > 0) {
    const sp = flat.lastIndexOf(' ', start);
    start = sp > 0 ? sp + 1 : start;
  }
  let end = Math.min(flat.length, start + size);
  if (end < flat.length) {
    const sp = flat.indexOf(' ', end);
    end = sp > 0 ? sp : flat.length;
  }
  const parts: HelpSnippetPart[] = [];
  if (start > 0) parts.push({ text: '…', match: false });
  let pos = start;
  for (const [a, b] of hits) {
    if (a < start || b > end) continue;
    if (a > pos) parts.push({ text: flat.slice(pos, a), match: false });
    parts.push({ text: flat.slice(a, b), match: true });
    pos = b;
  }
  if (pos < end) parts.push({ text: flat.slice(pos, end), match: false });
  if (end < flat.length) parts.push({ text: '…', match: false });
  return parts;
}

// ---------- the search API ----------

export function searchHelp(index: HelpIndex, query: string, limits = { terms: 5, articles: 10 }): HelpSearchResult {
  const q = query.trim();
  if (!q) return { query: q, terms: [], articles: [] };
  const { results } = scoreUnits(index, q);
  const terms: HelpTermHit[] = [];
  const articles: HelpSearchHit[] = [];
  const seen = new Set<string>();
  const top = results[0]?.score ?? 0;
  for (const r of results) {
    if (r.unit.kind === 'term') {
      // A term is found by its names; a word of the definition alone is not enough.
      if (terms.length < limits.terms && r.unit.term && r.titleCoverage >= 0.5) terms.push({ term: r.unit.term, snippet: snippet(r.unit.term.definition, r.matched), score: round(r.score) });
      continue;
    }
    if (articles.length >= limits.articles) continue;
    if (r.coverage < 0.5 || r.score < top * 0.15) continue;
    const key = `${r.unit.anchor}|${r.unit.title}`;
    if (seen.has(key)) continue;
    seen.add(key);
    articles.push({ anchor: r.unit.anchor, title: r.unit.title, articleAnchor: r.unit.articleAnchor, articleTitle: r.unit.articleTitle, snippet: snippet(r.unit.text, r.matched), score: round(r.score) });
  }
  return { query: q, terms, articles };
}

const round = (x: number) => Math.round(x * 1000) / 1000;
