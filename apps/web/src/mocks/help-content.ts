/*
 * The help content on the mock server: the guide files (docs/help/USER_GUIDE.<locale>.md, imported raw at
 * build time; demo-only articles are absent from builds without VITE_DEMO_MODE), parsed once, localised
 * with a per-part fallback to Russian, filtered by role and indexed for the search. The backend will do
 * the same on the server; the client only ever receives the filtered result.
 */
import type { Role } from '@mig/contracts';
import type { HelpArticle, HelpLocale, HelpTerm } from '@mig/contracts/help';
import { articlesFor, localizeGuide, parseGuide, type LocalizedGuide, type ParsedGuide } from '@/shared/help/guide';
import { GLOSSARY_ANCHOR, parseGlossary, synonymGroups } from '@/shared/help/glossary';
import { buildIndex, type HelpIndex } from '@/shared/help/search';

const FILES = import.meta.glob<string>('../../../../docs/help/USER_GUIDE.*.md', { query: '?raw', import: 'default', eager: true });

export const HELP_LOCALES: readonly HelpLocale[] = ['ru', 'uz-Latn', 'en'];

/** Demo-only articles are served only in a demo build (and are not even bundled otherwise). */
export const HELP_DEMO = import.meta.env.VITE_DEMO_MODE === 'true';

function source(locale: HelpLocale): string | null {
  const key = Object.keys(FILES).find((k) => k.endsWith(`/USER_GUIDE.${locale}.md`));
  return key ? (FILES[key] ?? null) : null;
}

let parsed: Map<HelpLocale, ParsedGuide | null> | null = null;
const localized = new Map<HelpLocale, LocalizedGuide>();

function parsedGuides(): Map<HelpLocale, ParsedGuide | null> {
  if (!parsed) {
    parsed = new Map();
    for (const l of HELP_LOCALES) {
      const text = source(l);
      parsed.set(l, text ? parseGuide(text) : null);
    }
  }
  return parsed;
}

export function russianGuide(): ParsedGuide {
  const ru = parsedGuides().get('ru');
  if (!ru) throw new Error('docs/help/USER_GUIDE.ru.md is missing');
  return ru;
}

export function guideFor(locale: HelpLocale): LocalizedGuide {
  let g = localized.get(locale);
  if (!g) {
    g = localizeGuide(russianGuide(), locale, parsedGuides().get(locale) ?? null);
    localized.set(locale, g);
  }
  return g;
}

export interface RoleContent {
  articles: HelpArticle[];
  terms: HelpTerm[];
  index: HelpIndex;
}

const cache = new Map<string, RoleContent>();

/** Everything the role may see in a locale, with the search index over exactly that. */
export function contentFor(role: Role, locale: HelpLocale, demo = HELP_DEMO): RoleContent {
  const key = `${role}|${locale}|${demo}`;
  let c = cache.get(key);
  if (!c) {
    const articles = articlesFor(guideFor(locale), role, demo);
    const glossary = articles.find((a) => a.anchor === GLOSSARY_ANCHOR);
    const terms = glossary ? parseGlossary(glossary.markdown) : [];
    // Synonyms always include the Russian glossary (abbreviations are typed in Russian in every locale).
    const ruGlossary = locale === 'ru' ? terms : parseGlossary(articlesFor(guideFor('ru'), role, demo).find((a) => a.anchor === GLOSSARY_ANCHOR)?.markdown ?? '');
    const index = buildIndex(articles, terms, synonymGroups(locale === 'ru' ? terms : [...terms, ...ruGlossary]));
    c = { articles, terms, index };
    cache.set(key, c);
  }
  return c;
}
