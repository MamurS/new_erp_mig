/*
 * The help guide on the server: docs/help/USER_GUIDE.<locale>.md read from disk, parsed and indexed with the
 * same engine as the mock (apps/web/src/shared/help: pure TypeScript, no DOM). Content is filtered by role
 * before indexing, so a role cannot find what it may not read. Demo-only articles are served only when the
 * deployment has demo routes (ci, staging).
 *
 * Part 1 difference from the mock: answers carry no «open the screen» links (the route map of the screens
 * lives in the web app with its navigation icons); a later step moves it to a package.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Role } from '@mig/contracts';
import type { HelpArticle, HelpLocale, HelpTerm } from '@mig/contracts/help';
import type { HelpProvider } from '@mig/domain/services/help';
import { redactForAi } from '@/features/ai/redact';
import { answerQuestion } from '@/shared/help/answer';
import { GLOSSARY_ANCHOR, parseGlossary, synonymGroups } from '@/shared/help/glossary';
import { articlesFor, localizeGuide, parseGuide, type LocalizedGuide, type ParsedGuide } from '@/shared/help/guide';
import { buildIndex, searchHelp, type HelpIndex } from '@/shared/help/search';

const LOCALES: readonly HelpLocale[] = ['ru', 'uz-Latn', 'en'];

interface RoleContent {
  articles: HelpArticle[];
  terms: HelpTerm[];
  index: HelpIndex;
}

/** The folder with the guide: `HELP_DIR`, or docs/help of the repository (dev, tests, the built server). */
export function helpDir(explicit?: string): string {
  const candidates = [explicit, resolve(process.cwd(), 'docs/help'), resolve(process.cwd(), '../../docs/help')].filter((x): x is string => !!x);
  const found = candidates.find((d) => existsSync(resolve(d, 'USER_GUIDE.ru.md')));
  if (!found) throw new Error('docs/help/USER_GUIDE.ru.md not found: set HELP_DIR');
  return found;
}

export function createHelpProvider(dir: string, demo: boolean): HelpProvider<HelpIndex> {
  const parsed = new Map<HelpLocale, ParsedGuide | null>();
  for (const l of LOCALES) {
    const path = resolve(dir, `USER_GUIDE.${l}.md`);
    parsed.set(l, existsSync(path) ? parseGuide(readFileSync(path, 'utf8')) : null);
  }
  const ru = parsed.get('ru');
  if (!ru) throw new Error('USER_GUIDE.ru.md is missing');
  const localized = new Map<HelpLocale, LocalizedGuide>();
  const guideFor = (locale: HelpLocale): LocalizedGuide => {
    let g = localized.get(locale);
    if (!g) {
      g = localizeGuide(ru, locale, parsed.get(locale) ?? null);
      localized.set(locale, g);
    }
    return g;
  };
  const cache = new Map<string, RoleContent>();
  const contentFor = (role: Role, locale: HelpLocale): RoleContent => {
    const key = `${role}|${locale}`;
    let c = cache.get(key);
    if (!c) {
      const articles = articlesFor(guideFor(locale), role, demo);
      const glossary = articles.find((a) => a.anchor === GLOSSARY_ANCHOR);
      const terms = glossary ? parseGlossary(glossary.markdown) : [];
      const ruGlossary = locale === 'ru' ? terms : parseGlossary(articlesFor(guideFor('ru'), role, demo).find((a) => a.anchor === GLOSSARY_ANCHOR)?.markdown ?? '');
      const index = buildIndex(articles, terms, synonymGroups(locale === 'ru' ? terms : [...terms, ...ruGlossary]));
      c = { articles, terms, index };
      cache.set(key, c);
    }
    return c;
  };
  return {
    guide: (locale) => guideFor(locale),
    content: (role, locale) => contentFor(role, locale),
    glossaryAnchor: GLOSSARY_ANCHOR,
    search: (index, query) => searchHelp(index, query),
    redact: (question, names) => redactForAi(question, { names }).text,
    answer: (index, question) => answerQuestion(index, question, { openRoutes: () => [] }),
  };
}
