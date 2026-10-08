/*
 * Help module («Справка»): the guide filtered by the caller's role, the search and «Задать вопрос»
 * (AI scenario `help`, the extractive mock provider). The contract is the one the backend will serve:
 * content is always filtered on the server, the search index holds only what the role may read, and
 * answers are built only from those fragments (RAG over the guide, sources mandatory, no user data).
 * Questions are stored redacted (redactForAi) for the «Справка» tab of /staff/admin/ai.
 */
import { http } from 'msw';
import type { SessionUser } from '@mig/contracts';
import type { HelpAnswer, HelpArticle, HelpGlossary, HelpGuide, HelpQuestionsAdminView, HelpToc } from '@mig/contracts/help';
import { aiEnabled } from '@mig/domain/ai/settings';
import { redactForAi } from '@/features/ai/redact';
import { screensMentioned } from '@/features/help/routeMap';
import { answerQuestion } from '@/shared/help/answer';
import { GLOSSARY_ANCHOR } from '@/shared/help/glossary';
import { searchHelp } from '@/shared/help/search';
import { helpAnswerRequestSchema, helpFeedbackSchema, helpLocaleParam, helpSearchSchema } from '@mig/contracts/forms';
import { db } from '../db';
import { API, body, notFound, param, requirePermission, requireSession, route, validate } from '../http';
import { contentFor, guideFor } from '../help-content';
import { randomId } from '@mig/seed/rng';
import { tzIso } from '@mig/seed/time';

const locale = (url: URL) => helpLocaleParam(url.searchParams.get('locale'));

function guideOf(user: SessionUser, url: URL): HelpGuide {
  const l = locale(url);
  const g = guideFor(l);
  return { title: g.title, version: g.version, locale: l, role: user.role, articles: contentFor(user.role, l).articles };
}

function toc(g: HelpGuide): HelpToc {
  return {
    title: g.title,
    version: g.version,
    locale: g.locale,
    role: g.role,
    articles: g.articles.map((a: HelpArticle) => ({ anchor: a.anchor, number: a.number, title: a.title, fallback: a.fallback, sections: a.sections.map((s) => ({ anchor: s.anchor, title: s.title, fallback: s.fallback })) })),
  };
}

const DISABLED: HelpAnswer = { status: 'disabled', short: '', steps: [], warnings: [], sources: [], openRoutes: [] };
const MAX_QUESTIONS = 2000;

export const helpHandlers = [
  // The table of contents: only the articles and subsections the role may read.
  http.get(
    `${API}/help/toc`,
    route(({ request, url }) => toc(guideOf(requireSession(request).user, url))),
  ),
  // The whole guide for the role (the PDF «Вся справка»).
  http.get(
    `${API}/help`,
    route(({ request, url }) => guideOf(requireSession(request).user, url)),
  ),
  http.get(
    `${API}/help/glossary`,
    route(({ request, url }) => {
      const { user } = requireSession(request);
      const l = locale(url);
      return { locale: l, anchor: GLOSSARY_ANCHOR, terms: contentFor(user.role, l).terms } satisfies HelpGlossary;
    }),
  ),
  http.get(
    `${API}/help/search`,
    route(({ request, url }) => {
      const { user } = requireSession(request);
      const { q } = validate(helpSearchSchema, { q: url.searchParams.get('q') ?? '' });
      return searchHelp(contentFor(user.role, locale(url)).index, q);
    }),
  ),
  // One article by its anchor; an article the role may not read does not exist for it.
  http.get(
    `${API}/help/articles/:anchor`,
    route(({ request, url, params }) => {
      const { user } = requireSession(request);
      const anchor = String(params.anchor ?? '');
      if (!/^[a-z0-9-]{1,64}$/.test(anchor)) throw notFound();
      const a = contentFor(user.role, locale(url)).articles.find((x) => x.anchor === anchor || x.sections.some((s) => s.anchor === anchor));
      if (!a) throw notFound();
      return a;
    }),
  ),

  // ---- «Задать вопрос»: the AI scenario `help` ----
  http.post(
    `${API}/ai/help-answer`,
    route(async ({ request }) => {
      const { user } = requireSession(request);
      const input = await body(request, helpAnswerRequestSchema);
      const d = db();
      // Per-scenario switch and «Отключить ИИ везде»; the search keeps working.
      if (!aiEnabled(d.ai.settings, 'help')) return DISABLED;
      const { index } = contentFor(user.role, input.locale);
      // The question is redacted before anything else: names, PINFL, phones and document numbers become
      // labels, which are dropped from the search (they are not words of the guide).
      const redacted = redactForAi(input.question, { names: [user.displayName] }).text;
      const answer = answerQuestion(index, redacted.replace(/\[[^\]]*\]/g, ' '), {
        openRoutes: (text) => screensMentioned(text, user.role).map((s) => ({ route: s.route, label: s.names[0]!, ...(s.labelKey ? { labelKey: s.labelKey } : {}) })),
      });
      const id = randomId();
      d.help.questions.unshift({
        id,
        at: tzIso(Date.now()),
        role: user.role,
        locale: input.locale,
        // No personal data in the log: names, PINFL, phones and document numbers are replaced by labels.
        question: redacted,
        status: answer.status === 'answered' ? 'answered' : 'no_answer',
        sources: answer.sources.map((s) => s.anchor),
        askerId: user.id,
      });
      if (d.help.questions.length > MAX_QUESTIONS) d.help.questions.length = MAX_QUESTIONS;
      return { ...answer, id } satisfies HelpAnswer;
    }),
  ),
  // «Полезно / Не полезно»: only the person who asked rates the answer (others get 404).
  http.post(
    `${API}/ai/help-answer/:id/feedback`,
    route(async (ctx) => {
      const { user } = requireSession(ctx.request);
      const { helpful } = await body(ctx.request, helpFeedbackSchema);
      const q = db().help.questions.find((x) => x.id === param(ctx, 'id'));
      if (!q || q.askerId !== user.id) throw notFound();
      q.feedback = { helpful, at: tzIso(Date.now()) };
      return { ok: true as const };
    }),
  ),
  // The «Справка» tab of /staff/admin/ai: questions without an answer and answers rated «Не полезно».
  http.get(
    `${API}/ai/admin/help-questions`,
    route(({ request }) => {
      const { user } = requireSession(request);
      requirePermission(user, 'ai.admin');
      const qs = db().help.questions;
      const strip = ({ askerId: _a, ...row }: (typeof qs)[number]) => row;
      const out: HelpQuestionsAdminView = {
        total: qs.length,
        answered: qs.filter((x) => x.status === 'answered').length,
        noAnswer: qs.filter((x) => x.status === 'no_answer').length,
        helpful: qs.filter((x) => x.feedback?.helpful === true).length,
        notHelpful: qs.filter((x) => x.feedback?.helpful === false).length,
        unanswered: qs.filter((x) => x.status === 'no_answer').slice(0, 100).map(strip),
        notHelpfulQuestions: qs.filter((x) => x.feedback?.helpful === false).slice(0, 100).map(strip),
      };
      return out;
    }),
  ),
];
