/*
 * Help module («Справка»). The logic is the shared service (packages/domain/src/services/help.ts); this is the
 * MSW adapter. The guide comes from the bundled Markdown files (../help-content.ts) with the web app's search
 * and answer engine, passed to the service as its provider.
 */
import { http } from 'msw';
import type { HelpIndex } from '@/shared/help/search';
import * as help from '@mig/domain/services/help';
import { redactForAi } from '@/features/ai/redact';
import { screensMentioned } from '@/features/help/routeMap';
import { answerQuestion } from '@/shared/help/answer';
import { GLOSSARY_ANCHOR } from '@/shared/help/glossary';
import { searchHelp } from '@/shared/help/search';
import { API, authCtx, param, readJson, route } from '../http';
import { contentFor, guideFor } from '../help-content';

const guideProvider: help.HelpProvider<HelpIndex> = {
  guide: (locale) => guideFor(locale),
  content: (role, locale) => contentFor(role, locale),
  glossaryAnchor: GLOSSARY_ANCHOR,
  search: (index, query) => searchHelp(index, query),
  redact: (question, names) => redactForAi(question, { names }).text,
  answer: (index, question, role) =>
    answerQuestion(index, question, {
      openRoutes: (text) => screensMentioned(text, role).map((s) => ({ route: s.route, label: s.names[0]!, ...(s.labelKey ? { labelKey: s.labelKey } : {}) })),
    }),
};

const locale = (url: URL) => url.searchParams.get('locale');

export const helpHandlers = [
  // The table of contents: only the articles and subsections the role may read.
  http.get(`${API}/help/toc`, route(async ({ request, url }) => help.toc(await authCtx(request), guideProvider, locale(url)))),
  // The whole guide for the role (the PDF «Вся справка»).
  http.get(`${API}/help`, route(async ({ request, url }) => help.guide(await authCtx(request), guideProvider, locale(url)))),
  http.get(`${API}/help/glossary`, route(async ({ request, url }) => help.glossary(await authCtx(request), guideProvider, locale(url)))),
  http.get(`${API}/help/search`, route(async ({ request, url }) => help.search(await authCtx(request), guideProvider, url.searchParams.get('q'), locale(url)))),
  // One article by its anchor; an article the role may not read does not exist for it.
  http.get(
    `${API}/help/articles/:anchor`,
    route(async ({ request, url, params }) => help.article(await authCtx(request), guideProvider, String(params.anchor ?? ''), locale(url))),
  ),
  // ---- «Задать вопрос»: the AI scenario `help` ----
  http.post(`${API}/ai/help-answer`, route(async ({ request }) => help.answer(await authCtx(request), guideProvider, await readJson(request)))),
  // «Полезно / Не полезно»: only the person who asked rates the answer (others get 404).
  http.post(`${API}/ai/help-answer/:id/feedback`, route(async (c) => help.feedback(await authCtx(c.request), param(c, 'id'), await readJson(c.request)))),
  // The «Справка» tab of /staff/admin/ai: questions without an answer and answers rated «Не полезно».
  http.get(`${API}/ai/admin/help-questions`, route(async ({ request }) => help.adminQuestions(await authCtx(request)))),
];
