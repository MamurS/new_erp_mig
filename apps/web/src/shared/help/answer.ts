/*
 * «Задать вопрос»: an extractive answer assembled from the guide fragments visible to the role (the index
 * is built from filtered content only). Nothing is generated: the short answer, the steps and the warnings
 * are sentences, list items and table cells of the guide, and every answer names its sources. When the
 * best fragment does not cover the question well enough, the answer is «no_answer».
 */
import type { HelpAnswer, HelpOpenRoute, HelpSource } from '@mig/contracts/help';
import { inlineText, sentences, type Block, type ListItem } from './markdown';
import { scoreUnits, stems, type HelpIndex, type ScoredUnit } from './search';
import { DEFINITION_CUE, ROLE_LINE, STATUS_CUE, WARNING_CUES } from './lang';

export interface AnswerOptions {
  /** Screens the text mentions that the role may open. */
  openRoutes?: (text: string) => HelpOpenRoute[];
  /** Minimal share of the question's words the best fragment must contain. */
  minCoverage?: number;
}

const MAX_SOURCES = 3;
const MAX_STEPS = 10;
const MAX_WARNINGS = 3;

function itemText(it: ListItem): string {
  const own = it.children.filter((b) => b.type === 'paragraph').map((b) => inlineText(b.type === 'paragraph' ? b.children : [])).join(' ');
  const nested = it.children
    .filter((b): b is Extract<Block, { type: 'list' }> => b.type === 'list')
    .flatMap((l) => l.items.map(itemText))
    .filter(Boolean);
  return nested.length ? `${own} ${nested.join('; ')}` : own;
}

interface Fragments {
  paragraphs: string[];
  ordered: string[][];
  bullets: string[];
  rows: string[][];
}

function fragmentsOf(blocks: readonly Block[]): Fragments {
  const f: Fragments = { paragraphs: [], ordered: [], bullets: [], rows: [] };
  for (const b of blocks) {
    if (b.type === 'paragraph') f.paragraphs.push(inlineText(b.children));
    else if (b.type === 'list' && b.ordered) f.ordered.push(b.items.map(itemText).filter(Boolean));
    else if (b.type === 'list') f.bullets.push(...b.items.map(itemText).filter(Boolean));
    else if (b.type === 'table') for (const r of b.rows) f.rows.push(r.map((c) => inlineText(c).trim()));
    else if (b.type === 'blockquote') {
      const inner = fragmentsOf(b.children);
      f.paragraphs.push(...inner.paragraphs);
      f.bullets.push(...inner.bullets);
    }
  }
  return f;
}

/** How many of the question's stems a text contains (prefix-tolerant). */
function overlap(q: ReadonlySet<string>, text: string): number {
  const ws = stems(text);
  let n = 0;
  for (const s of q) if (ws.some((w) => w === s || (s.length >= 4 && w.startsWith(s)) || (w.length >= 4 && s.startsWith(w)))) n++;
  return n;
}

const isWarning = (s: string) => WARNING_CUES.some((re) => re.test(s));
const clean = (s: string) => s.replace(/\s+/g, ' ').trim();

function source(r: ScoredUnit): HelpSource {
  return { anchor: r.unit.anchor, title: r.unit.title, articleAnchor: r.unit.articleAnchor, articleTitle: r.unit.articleTitle };
}

/**
 * Whether the best fragment answers the question: most of its words are there (three and more words), or
 * for a short question all of them, or half of them with the matching words in the title.
 */
function covered(r: ScoredUnit, clauses: number, min?: number): boolean {
  if (min !== undefined) return r.coverage >= min;
  if (clauses >= 3) return r.coverage >= 0.6;
  if (clauses === 2) return r.coverage === 1 || (r.coverage >= 0.5 && r.titleCoverage >= 0.5);
  return r.coverage === 1 && r.titleCoverage === 1;
}

/**
 * Answers prefer instructions: glossary definitions only for «что такое…», status chains only for questions
 * about statuses, and a «Что делать, если…» row only when its situation matches the question.
 */
function rerank(results: ScoredUnit[], question: string): ScoredUnit[] {
  const definitional = DEFINITION_CUE.test(question);
  const aboutStatus = STATUS_CUE.test(question);
  return results
    .map((r) => {
      let f = 1;
      if (r.unit.kind === 'term' && !definitional) f = 0.7;
      if (r.unit.kind === 'row' && r.unit.articleAnchor === 'statuses' && !aboutStatus) f = 0.5;
      if (r.unit.kind === 'row' && r.unit.articleAnchor !== 'statuses' && r.titleCoverage < 0.6) f = 0.75;
      if (r.unit.kind === 'lead') f = 0.7;
      return f === 1 ? r : { ...r, score: r.score * f };
    })
    .sort((a, b) => b.score - a.score);
}

export function noAnswer(): HelpAnswer {
  return { status: 'no_answer', short: '', steps: [], warnings: [], sources: [], openRoutes: [] };
}

export function answerQuestion(index: HelpIndex, question: string, opts: AnswerOptions = {}): HelpAnswer {
  const { clauses, results: raw } = scoreUnits(index, question);
  const results = rerank(raw, question);
  const best = results[0];
  if (!best || !clauses.length || !covered(best, clauses.length, opts.minCoverage)) return noAnswer();
  const minCoverage = opts.minCoverage ?? (clauses.length >= 3 ? 0.6 : 0.5);

  // Sources: the best fragments, one per anchor and title, close enough to the best one.
  const picked: ScoredUnit[] = [];
  for (const r of results) {
    if (picked.length >= MAX_SOURCES) break;
    if (r.score < best.score * 0.35 || r.coverage < minCoverage * 0.6) continue;
    if (picked.some((p) => p.unit.anchor === r.unit.anchor && (p.unit.kind !== 'row' || p.unit.title === r.unit.title))) continue;
    picked.push(r);
  }

  const q = new Set(stems(question));
  const top = picked[0]!;
  const f = fragmentsOf(top.unit.blocks);
  let short = '';
  let steps: string[] = [];

  if (top.unit.kind === 'term' && top.unit.term) {
    short = `${top.unit.term.term} — ${top.unit.term.definition}`;
  } else if (top.unit.kind === 'row') {
    // «Что делать, если…» and statuses: the first cell is the situation, the rest is what to do.
    const cells = f.rows[0] ?? [];
    const action = cells.slice(1).flatMap(sentences);
    short = action[0] ?? cells.join(' — ');
    steps = action.slice(1);
  } else {
    const prose = f.paragraphs.flatMap(sentences).filter((s) => !/:$/u.test(s) && !ROLE_LINE.test(s));
    const scored = prose.map((s, i) => ({ s, i, o: overlap(q, s) }));
    const bestSentence = scored.filter((x) => x.o > 0).sort((a, b) => b.o - a.o || a.i - b.i)[0];
    // Without prose, the item of a list closest to the question (the list itself is shown as the steps).
    const items = [...f.ordered.flat(), ...f.bullets].map((s, i) => ({ s, i, o: overlap(q, s) }));
    const bestItem = items.sort((a, b) => b.o - a.o || a.i - b.i)[0];
    short = bestSentence?.s ?? prose[0] ?? bestItem?.s ?? '';
  }

  // Steps: the numbered list of the best source that has one (the top source first); it is preferred to
  // the sentences of a «Что делать, если…» row, which then gives the short answer only.
  for (const r of picked) {
    const lists = fragmentsOf(r.unit.blocks).ordered;
    if (!lists.length || r.score < best.score * 0.5) continue;
    steps = [...lists].sort((a, b) => overlap(q, b.join(' ')) - overlap(q, a.join(' ')))[0]!;
    break;
  }
  if (!steps.length && top.unit.kind !== 'row' && top.unit.kind !== 'term') {
    const bullets = f.bullets.filter((b) => overlap(q, b) > 0);
    steps = (bullets.length ? bullets : f.bullets).slice(0, 6);
  }
  steps = steps.map(clean).filter((s) => s && (top.unit.kind !== 'row' || s !== clean(short))).slice(0, MAX_STEPS);

  // Warnings: sentences of the sources with a warning cue that are not already shown.
  const shown = new Set([clean(short), ...steps].filter(Boolean));
  const warnings: string[] = [];
  for (const r of picked) {
    const fr = fragmentsOf(r.unit.blocks);
    const candidates = [...fr.paragraphs.flatMap(sentences), ...fr.bullets, ...fr.ordered.flat(), ...fr.rows.flatMap((row) => row.slice(1).flatMap(sentences))];
    for (const c of candidates.map(clean)) {
      if (warnings.length >= MAX_WARNINGS) break;
      if (!isWarning(c) || shown.has(c) || [...shown].some((s) => s.includes(c) || c.includes(s))) continue;
      if (r !== top && overlap(q, c) === 0) continue;
      warnings.push(c);
      shown.add(c);
    }
  }

  const answerText = [short, ...steps, ...warnings].join('\n');
  const routes = opts.openRoutes ? dedupeRoutes([...opts.openRoutes(answerText), ...opts.openRoutes(picked.map((p) => p.unit.text).join('\n'))]).slice(0, 3) : [];
  return { status: 'answered', short: clean(short), steps, warnings, sources: picked.map(source), openRoutes: routes };
}

function dedupeRoutes(rs: HelpOpenRoute[]): HelpOpenRoute[] {
  const seen = new Set<string>();
  return rs.filter((r) => (seen.has(r.route) ? false : (seen.add(r.route), true)));
}
