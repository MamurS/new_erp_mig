/*
 * Help module («Справка»): the guide filtered by the caller's role, the search and «Задать вопрос»
 * (AI scenario `help`, the extractive answer). Content is always filtered on the server, the search index
 * holds only what the role may read, and answers are built only from those fragments (RAG over the guide,
 * sources mandatory, no user data). Questions are stored redacted for the «Справка» tab of /staff/admin/ai.
 *
 * The guide itself (its files, parsing, index, search and answer engine) comes from a provider of the
 * deployment: the mock bundles the Markdown files, the API reads them from disk.
 */
import type { Role } from '@mig/contracts';
import type { HelpAnswer, HelpArticle, HelpGlossary, HelpGuide, HelpLocale, HelpQuestionsAdminView, HelpSearchResult, HelpTerm, HelpToc } from '@mig/contracts/help';
import { helpAnswerRequestSchema, helpFeedbackSchema, helpLocaleParam, helpSearchSchema } from '@mig/contracts/forms';
import { aiEnabled } from '../ai/settings';
import { randomId } from '../lib/random';
import { tzIso } from '../lib/time';
import type { HelpQuestionStored } from '../store/db';
import { notFound, requirePermission, validate, type AuthCtx } from './kernel';

/** Everything a role may see in a locale, with the search index over exactly that. */
export interface HelpContent<I> {
  articles: HelpArticle[];
  terms: HelpTerm[];
  index: I;
}

export interface HelpProvider<I = unknown> {
  /** Title and version of the guide in a locale. */
  guide(locale: HelpLocale): { title: string; version: string };
  content(role: Role, locale: HelpLocale): HelpContent<I>;
  /** Anchor of the glossary article. */
  glossaryAnchor: string;
  search(index: I, query: string): HelpSearchResult;
  /** The question with names, PINFL, phones and document numbers replaced by `[labels]`. */
  redact(question: string, names: readonly string[]): string;
  /** The extractive answer over the index; `openRoutes` lead to the screens the answer mentions for the role. */
  answer(index: I, question: string, role: Role): HelpAnswer;
}

const DISABLED: HelpAnswer = { status: 'disabled', short: '', steps: [], warnings: [], sources: [], openRoutes: [] };
const MAX_QUESTIONS = 2000;

const localeOf = (raw: string | null): HelpLocale => helpLocaleParam(raw);

function guideOf<I>(help: HelpProvider<I>, role: Role, locale: HelpLocale): HelpGuide {
  const g = help.guide(locale);
  return { title: g.title, version: g.version, locale, role, articles: help.content(role, locale).articles };
}

// ---------------------------------------------------------------- endpoints

/** GET /help/toc: only the articles and subsections the role may read. */
export async function toc<I>(ctx: AuthCtx, help: HelpProvider<I>, locale: string | null): Promise<HelpToc> {
  const g = guideOf(help, ctx.user.role, localeOf(locale));
  return {
    title: g.title,
    version: g.version,
    locale: g.locale,
    role: g.role,
    articles: g.articles.map((a) => ({ anchor: a.anchor, number: a.number, title: a.title, fallback: a.fallback, sections: a.sections.map((s) => ({ anchor: s.anchor, title: s.title, fallback: s.fallback })) })),
  };
}

/** GET /help: the whole guide for the role (the PDF «Вся справка»). */
export async function guide<I>(ctx: AuthCtx, help: HelpProvider<I>, locale: string | null): Promise<HelpGuide> {
  return guideOf(help, ctx.user.role, localeOf(locale));
}

/** GET /help/glossary. */
export async function glossary<I>(ctx: AuthCtx, help: HelpProvider<I>, locale: string | null): Promise<HelpGlossary> {
  const l = localeOf(locale);
  return { locale: l, anchor: help.glossaryAnchor, terms: help.content(ctx.user.role, l).terms };
}

/** GET /help/search?q=. */
export async function search<I>(ctx: AuthCtx, help: HelpProvider<I>, query: string | null, locale: string | null): Promise<HelpSearchResult> {
  const { q } = validate(helpSearchSchema, { q: query ?? '' });
  return help.search(help.content(ctx.user.role, localeOf(locale)).index, q);
}

/** GET /help/articles/:anchor: an article the role may not read does not exist for it. */
export async function article<I>(ctx: AuthCtx, help: HelpProvider<I>, anchor: string, locale: string | null): Promise<HelpArticle> {
  if (!/^[a-z0-9-]{1,64}$/.test(anchor)) throw notFound();
  const a = help.content(ctx.user.role, localeOf(locale)).articles.find((x) => x.anchor === anchor || x.sections.some((s) => s.anchor === anchor));
  if (!a) throw notFound();
  return a;
}

/** POST /ai/help-answer: «Задать вопрос». */
export async function answer<I>(ctx: AuthCtx, help: HelpProvider<I>, body: unknown): Promise<HelpAnswer> {
  const { user } = ctx;
  const input = validate(helpAnswerRequestSchema, body);
  // Per-scenario switch and «Отключить ИИ везде»; the search keeps working.
  if (!aiEnabled(await ctx.repos.one.aiSettings(), 'help')) return DISABLED;
  const { index } = help.content(user.role, input.locale);
  // The question is redacted before anything else: names, PINFL, phones and document numbers become
  // labels, which are dropped from the search (they are not words of the guide).
  const redacted = help.redact(input.question, [user.displayName]);
  const out = help.answer(index, redacted.replace(/\[[^\]]*\]/g, ' '), user.role);
  const id = randomId();
  const row: HelpQuestionStored = {
    id,
    at: tzIso(ctx.now()),
    role: user.role,
    locale: input.locale,
    // No personal data in the log: names, PINFL, phones and document numbers are replaced by labels.
    question: redacted,
    status: out.status === 'answered' ? 'answered' : 'no_answer',
    sources: out.sources.map((s) => s.anchor),
    askerId: user.id,
  };
  await ctx.repos.helpQuestions.insert(row, { at: 'start' });
  const extra = await ctx.repos.helpQuestions.list({ offset: MAX_QUESTIONS });
  if (extra.length) await ctx.repos.helpQuestions.removeWhere({ id: { in: extra.map((x) => x.id) } });
  return { ...out, id };
}

/** POST /ai/help-answer/:id/feedback: only the person who asked rates the answer (others get 404). */
export async function feedback(ctx: AuthCtx, id: string, body: unknown): Promise<{ ok: true }> {
  const { helpful } = validate(helpFeedbackSchema, body);
  const q = await ctx.repos.helpQuestions.get(id);
  if (!q || q.askerId !== ctx.user.id) throw notFound();
  await ctx.repos.helpQuestions.update(q.id, { feedback: { helpful, at: tzIso(ctx.now()) } });
  return { ok: true as const };
}

/** GET /ai/admin/help-questions: questions without an answer and answers rated «Не полезно». */
export async function adminQuestions(ctx: AuthCtx): Promise<HelpQuestionsAdminView> {
  requirePermission(ctx.user, 'ai.admin');
  const qs = await ctx.repos.helpQuestions.list();
  const strip = ({ askerId: _a, ...row }: HelpQuestionStored) => row;
  return {
    total: qs.length,
    answered: qs.filter((x) => x.status === 'answered').length,
    noAnswer: qs.filter((x) => x.status === 'no_answer').length,
    helpful: qs.filter((x) => x.feedback?.helpful === true).length,
    notHelpful: qs.filter((x) => x.feedback?.helpful === false).length,
    unanswered: qs.filter((x) => x.status === 'no_answer').slice(0, 100).map(strip),
    notHelpfulQuestions: qs.filter((x) => x.feedback?.helpful === false).slice(0, 100).map(strip),
  };
}
