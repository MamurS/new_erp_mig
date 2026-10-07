/* Response schemas of the help module (src/shared/types/help.ts). */
import { z } from 'zod';
import type * as H from '@/shared/types/help';
import { role } from './schemas';

const locale = z.enum(['ru', 'uz-Latn', 'en']);

const section: z.ZodType<H.HelpSection> = z.object({ anchor: z.string(), title: z.string(), markdown: z.string(), fallback: z.boolean() });
export const helpArticle: z.ZodType<H.HelpArticle> = z.object({ anchor: z.string(), number: z.string(), title: z.string(), markdown: z.string(), fallback: z.boolean(), sections: z.array(section) });

export const helpToc: z.ZodType<H.HelpToc> = z.object({
  title: z.string(),
  version: z.string(),
  locale,
  role,
  articles: z.array(z.object({ anchor: z.string(), number: z.string(), title: z.string(), fallback: z.boolean(), sections: z.array(z.object({ anchor: z.string(), title: z.string(), fallback: z.boolean() })) })),
});

export const helpGuide: z.ZodType<H.HelpGuide> = z.object({ title: z.string(), version: z.string(), locale, role, articles: z.array(helpArticle) });

const term: z.ZodType<H.HelpTerm> = z.object({ id: z.string(), term: z.string(), definition: z.string(), synonyms: z.array(z.string()) });
export const helpGlossary: z.ZodType<H.HelpGlossary> = z.object({ locale, anchor: z.string(), terms: z.array(term) });

const snippet = z.array(z.object({ text: z.string(), match: z.boolean() }));
export const helpSearchResult: z.ZodType<H.HelpSearchResult> = z.object({
  query: z.string(),
  terms: z.array(z.object({ term, snippet, score: z.number() })),
  articles: z.array(z.object({ anchor: z.string(), title: z.string(), articleAnchor: z.string(), articleTitle: z.string(), snippet, score: z.number() })),
});

export const helpAnswer: z.ZodType<H.HelpAnswer> = z.object({
  id: z.string().uuid().optional(),
  status: z.enum(['answered', 'no_answer', 'disabled']),
  short: z.string(),
  steps: z.array(z.string()),
  warnings: z.array(z.string()),
  sources: z.array(z.object({ anchor: z.string(), title: z.string(), articleAnchor: z.string(), articleTitle: z.string() })),
  openRoutes: z.array(z.object({ route: z.string(), label: z.string(), labelKey: z.string().optional() })),
});

const question: z.ZodType<H.HelpQuestionRow> = z.object({
  id: z.string().uuid(),
  at: z.string(),
  role,
  locale,
  question: z.string(),
  status: z.enum(['answered', 'no_answer']),
  sources: z.array(z.string()),
  feedback: z.object({ helpful: z.boolean(), at: z.string() }).optional(),
});
export const helpQuestionsAdmin: z.ZodType<H.HelpQuestionsAdminView> = z.object({
  total: z.number(),
  answered: z.number(),
  noAnswer: z.number(),
  helpful: z.number(),
  notHelpful: z.number(),
  unanswered: z.array(question),
  notHelpfulQuestions: z.array(question),
});
