/*
 * Help module («Справка»): the guide filtered by role on the server, the search, «Задать вопрос» and its
 * feedback, the admin list of questions. `locale` is the interface language (useLocale()); parts without
 * a translation come in Russian with `fallback: true`.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { HelpLocale } from '@/shared/types/help';
import { useSession } from '@/shared/auth/session';
import { request } from '../client';
import * as S from '../schemas-help';

export const helpKeys = {
  all: ['help'] as const,
  toc: (role: string, locale: HelpLocale) => ['help', role, 'toc', locale] as const,
  guide: (role: string, locale: HelpLocale) => ['help', role, 'guide', locale] as const,
  article: (role: string, locale: HelpLocale, anchor: string) => ['help', role, 'article', locale, anchor] as const,
  glossary: (role: string, locale: HelpLocale) => ['help', role, 'glossary', locale] as const,
  search: (role: string, locale: HelpLocale, q: string) => ['help', role, 'search', locale, q] as const,
  admin: ['ai', 'admin', 'help-questions'] as const,
};

/** The role is part of every key: content differs by role and must never be shown to another one. */
function useRole(): string {
  return useSession()?.user.role ?? '';
}

/** Table of contents: only the articles the role may read. */
export function useHelpToc(locale: HelpLocale) {
  const role = useRole();
  return useQuery({ queryKey: helpKeys.toc(role, locale), queryFn: () => request('/help/toc', { query: { locale }, schema: S.helpToc }), enabled: !!role, staleTime: 5 * 60_000 });
}

/** The whole guide for the role (the PDF «Вся справка»). */
export function useHelpGuide(locale: HelpLocale, enabled = true) {
  const role = useRole();
  return useQuery({ queryKey: helpKeys.guide(role, locale), queryFn: () => request('/help', { query: { locale }, schema: S.helpGuide }), enabled: !!role && enabled, staleTime: 5 * 60_000 });
}

/** One article by the anchor of the article or of one of its subsections; 404 when the role may not read it. */
export function useHelpArticle(anchor: string | null, locale: HelpLocale) {
  const role = useRole();
  return useQuery({
    queryKey: helpKeys.article(role, locale, anchor ?? ''),
    queryFn: () => request(`/help/articles/${encodeURIComponent(anchor ?? '')}`, { query: { locale }, schema: S.helpArticle }),
    enabled: !!role && !!anchor,
    staleTime: 5 * 60_000,
    retry: false,
  });
}

/** Glossary terms (underlined in the text with a definition on hover). */
export function useHelpGlossary(locale: HelpLocale) {
  const role = useRole();
  return useQuery({ queryKey: helpKeys.glossary(role, locale), queryFn: () => request('/help/glossary', { query: { locale }, schema: S.helpGlossary }), enabled: !!role, staleTime: 5 * 60_000 });
}

/** Search over the role's help: debounce `q` in the caller; queries shorter than 2 characters are not sent. */
export function useHelpSearch(q: string, locale: HelpLocale) {
  const role = useRole();
  const query = q.trim().slice(0, 200);
  return useQuery({
    queryKey: helpKeys.search(role, locale, query),
    queryFn: ({ signal }) => request('/help/search', { query: { q: query, locale }, schema: S.helpSearchResult, signal }),
    enabled: !!role && query.length >= 2,
    staleTime: 60_000,
    placeholderData: (prev) => prev,
  });
}

/** «Задать вопрос»: `status` is `disabled` when the scenario or all AI is switched off (the search still works). */
export const useHelpAnswer = () => useMutation({ mutationFn: (v: { question: string; locale: HelpLocale }) => request('/ai/help-answer', { method: 'POST', body: v, schema: S.helpAnswer }) });

/** «Полезно / Не полезно» under an answer. */
export function useHelpFeedback() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; helpful: boolean }) => request(`/ai/help-answer/${v.id}/feedback`, { method: 'POST', body: { helpful: v.helpful } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: helpKeys.admin }),
  });
}

/** The «Справка» tab of /staff/admin/ai (permission ai.admin). */
export const useHelpQuestionsAdmin = (enabled = true) => useQuery({ queryKey: helpKeys.admin, queryFn: () => request('/ai/admin/help-questions', { schema: S.helpQuestionsAdmin }), enabled });
