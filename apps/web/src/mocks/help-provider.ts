/*
 * The help guide for the help routes: the bundled Markdown files (./help-content.ts) with the web app's
 * search and answer engine, passed to the shared service as its provider.
 */
import type { HelpIndex } from '@/shared/help/search';
import type { HelpProvider } from '@mig/domain/services/help';
import { redactForAi } from '@/features/ai/redact';
import { screensMentioned } from '@/features/help/routeMap';
import { answerQuestion } from '@/shared/help/answer';
import { GLOSSARY_ANCHOR } from '@/shared/help/glossary';
import { searchHelp } from '@/shared/help/search';
import { contentFor, guideFor } from './help-content';

export const guideProvider: HelpProvider<HelpIndex> = {
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
