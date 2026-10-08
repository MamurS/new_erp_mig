/*
 * Help module («Справка»): the API contract of /api/help and /api/ai/help-answer. The backend serves the
 * same shapes. Content is already filtered by the caller's role on the server; markdown is the subset
 * rendered by src/features/help/HelpMarkdown.tsx (no HTML, links to anchors only).
 */
import type { ISODateTime, Role, UUID } from './index';

export type HelpLocale = 'ru' | 'uz-Latn' | 'en';

/** A ### subsection (or the lead of an article, see HelpArticle.markdown). */
export interface HelpSection {
  /** Stable Latin anchor, unique in the guide (`{#anchor}` in the markdown). */
  anchor: string;
  title: string;
  /** Body in the help markdown subset, filtered by role; audience markers are removed. */
  markdown: string;
  /** The translation of this part is not ready: the Russian text is served (UI: «Перевод готовится»). */
  fallback: boolean;
}

/** A ## article. */
export interface HelpArticle {
  anchor: string;
  /** Number in the guide («5»), as printed in the heading. */
  number: string;
  title: string;
  /** The lead text before the first subsection (may be empty). */
  markdown: string;
  fallback: boolean;
  sections: HelpSection[];
}

export interface HelpTocEntry {
  anchor: string;
  number: string;
  title: string;
  fallback: boolean;
  sections: { anchor: string; title: string; fallback: boolean }[];
}

/** GET /api/help/toc */
export interface HelpToc {
  title: string;
  /** «Версия 1.0 · 07.10.2026» line of the guide, as written. */
  version: string;
  locale: HelpLocale;
  /** Role the content was filtered for (the session's role). */
  role: Role;
  articles: HelpTocEntry[];
}

/** GET /api/help — the whole guide for the role (the PDF «Вся справка»). */
export interface HelpGuide {
  title: string;
  version: string;
  locale: HelpLocale;
  role: Role;
  articles: HelpArticle[];
}

/** A glossary term (section 3): `synonyms` hold abbreviations and the uz/en equivalents. */
export interface HelpTerm {
  /** Stable id: a slug of the first name of the term. */
  id: string;
  term: string;
  definition: string;
  synonyms: string[];
}

/** GET /api/help/glossary */
export interface HelpGlossary {
  locale: HelpLocale;
  /** Anchor of the glossary article. */
  anchor: string;
  terms: HelpTerm[];
}

/** A piece of a snippet; `match: true` — highlighted. */
export interface HelpSnippetPart {
  text: string;
  match: boolean;
}

export interface HelpSearchHit {
  /** Anchor of the subsection (or of the article for rows of tables and article leads). */
  anchor: string;
  title: string;
  articleAnchor: string;
  articleTitle: string;
  snippet: HelpSnippetPart[];
  score: number;
}

export interface HelpTermHit {
  term: HelpTerm;
  snippet: HelpSnippetPart[];
  score: number;
}

/** GET /api/help/search?q=&locale= */
export interface HelpSearchResult {
  query: string;
  terms: HelpTermHit[];
  articles: HelpSearchHit[];
}

export interface HelpSource {
  anchor: string;
  title: string;
  articleAnchor: string;
  articleTitle: string;
}

export interface HelpOpenRoute {
  route: string;
  /** Screen name as written in the guide (Russian). */
  label: string;
  /** i18n key of the screen's navigation label, when there is one: prefer it in the UI. */
  labelKey?: string;
}

export type HelpAnswerStatus = 'answered' | 'no_answer' | 'disabled';

/** POST /api/ai/help-answer — built only from fragments of the guide visible to the role (extractive). */
export interface HelpAnswer {
  /** Id for the feedback; absent when the scenario is off. */
  id?: UUID;
  status: HelpAnswerStatus;
  short: string;
  steps: string[];
  warnings: string[];
  /** Always non-empty when `status` is `answered`. */
  sources: HelpSource[];
  /** Screens mentioned in the answer that the role may open. */
  openRoutes: HelpOpenRoute[];
}

/** A stored question (no personal data: the text is redacted as for the AI providers). */
export interface HelpQuestionRow {
  id: UUID;
  at: ISODateTime;
  role: Role;
  locale: HelpLocale;
  question: string;
  status: Exclude<HelpAnswerStatus, 'disabled'>;
  sources: string[];
  feedback?: { helpful: boolean; at: ISODateTime };
}

/** GET /api/ai/admin/help-questions — the «Справка» tab of /staff/admin/ai. */
export interface HelpQuestionsAdminView {
  total: number;
  answered: number;
  noAnswer: number;
  helpful: number;
  notHelpful: number;
  /** Questions without an answer, newest first. */
  unanswered: HelpQuestionRow[];
  /** Answers rated «Не полезно», newest first. */
  notHelpfulQuestions: HelpQuestionRow[];
}
