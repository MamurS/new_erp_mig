/*
 * The guide (docs/help/USER_GUIDE.<locale>.md) split into articles (##) and subsections (###), each with a
 * stable anchor and an audience, and filtered for a role.
 *
 * Markup (invisible in any markdown viewer except the anchor suffix):
 *   ## 5. Новый клиент: от лида до договора {#new-client}
 *   <!-- audience: staff hr -->              ← the first line after a heading: the heading's audience
 *   <!-- audience: staff -->                 ← later: a block until `<!-- /audience -->` or the next heading
 *   - item or | table | row | <!-- audience: staff -->   ← one list item (with its nested lines) or one row
 * Levels narrow each other (see ./audience). Anchors are lower-case Latin slugs, unique, never renamed.
 * Translations keep every anchor and marker exactly as in Russian; a part whose markers differ is served
 * in Russian with `fallback: true` (see localizeGuide).
 */
import type { Role } from '@/shared/types';
import type { HelpArticle, HelpLocale } from '@/shared/types/help';
import { AUDIENCE_ALL, AudienceError, COMMENT_LINE, MARKER_CLOSE, MARKER_LINE, MARKER_TRAILING, audienceVisible, intersectAudience, parseAudience, type Audience } from './audience';

export interface GuideLine {
  text: string;
  audience: Audience;
}

export interface GuidePart {
  anchor: string;
  title: string;
  /** Audience of the heading (already narrowed by the article's for subsections). */
  audience: Audience;
  lines: GuideLine[];
  /** Every marker of the part in order (the heading's first): translations must repeat them exactly. */
  markers: string[];
}

export interface GuideArticle extends GuidePart {
  number: string;
  sections: GuidePart[];
}

export interface ParsedGuide {
  title: string;
  version: string;
  articles: GuideArticle[];
  /** Problems of the markup (unknown tokens, missing anchors or audiences, duplicates): must be empty. */
  errors: string[];
}

const HEADING = /^(##|###)\s+(.*?)\s*$/;
const ANCHOR = /\s+\{#([a-z0-9][a-z0-9-]*)\}$/;
const LIST_START = /^([-*+]|\d{1,3}[.)])\s/;

function safeAudience(spec: string, errors: string[], where: string, fallback: Audience): Audience {
  try {
    return parseAudience(spec);
  } catch (e) {
    errors.push(`${where}: ${e instanceof AudienceError ? e.message : 'bad audience'}`);
    return fallback;
  }
}

/** Staff-only: the safe default of an article whose audience is missing. */
const STAFF_FALLBACK = (): Audience => parseAudience('staff');

export function parseGuide(markdown: string): ParsedGuide {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  const errors: string[] = [];
  let title = '';
  let version = '';
  const articles: GuideArticle[] = [];
  const anchors = new Set<string>();
  let article: GuideArticle | null = null;
  let part: GuidePart | null = null;
  /** Waiting for the heading's own marker. */
  let expectHeadingMarker = false;
  let block: Audience | null = null;
  let item: Audience | null = null;
  let prevBlank = true;

  for (const raw of lines) {
    const h = HEADING.exec(raw);
    if (!part && !article && /^#\s/.test(raw)) {
      title = raw.replace(/^#\s+/, '').trim();
      continue;
    }
    if (h) {
      const level = h[1]!.length;
      let text = h[2]!;
      const a = ANCHOR.exec(text);
      if (!a) errors.push(`no anchor: ${text}`);
      text = text.replace(ANCHOR, '');
      const anchor: string = a?.[1] ?? `missing-${articles.length}-${article?.sections.length ?? 0}`;
      if (anchors.has(anchor)) errors.push(`duplicate anchor: ${anchor}`);
      anchors.add(anchor);
      block = null;
      item = null;
      prevBlank = true;
      expectHeadingMarker = true;
      if (level === 2) {
        const m = /^(\d+)\.\s+(.*)$/.exec(text);
        article = { anchor, number: m?.[1] ?? '', title: (m?.[2] ?? text).trim(), audience: STAFF_FALLBACK(), lines: [], markers: [], sections: [] };
        articles.push(article);
        part = article;
      } else {
        if (!article) {
          errors.push(`subsection before any article: ${text}`);
          continue;
        }
        part = { anchor, title: text.trim(), audience: article.audience, lines: [], markers: [] };
        article.sections.push(part);
      }
      continue;
    }
    if (!part) {
      // Between the title and the first article: the version line.
      if (raw.trim() && !COMMENT_LINE.test(raw) && !version) version = raw.trim();
      continue;
    }
    const marker = MARKER_LINE.exec(raw);
    if (expectHeadingMarker) {
      if (!raw.trim()) continue;
      expectHeadingMarker = false;
      if (marker) {
        part.markers.push(marker[1]!.trim());
        const own = safeAudience(marker[1]!, errors, part.anchor, part === article ? STAFF_FALLBACK() : part.audience);
        part.audience = part === article ? own : intersectAudience(article!.audience, own);
        continue;
      }
      errors.push(`no audience: ${part.anchor}`);
    }
    if (marker) {
      part.markers.push(marker[1]!.trim());
      block = safeAudience(marker[1]!, errors, part.anchor, part.audience);
      item = null;
      continue;
    }
    if (MARKER_CLOSE.test(raw)) {
      part.markers.push('/');
      block = null;
      item = null;
      continue;
    }
    if (COMMENT_LINE.test(raw)) continue;
    let text = raw;
    let own: Audience | null = null;
    const trailing = MARKER_TRAILING.exec(raw);
    if (trailing) {
      part.markers.push(trailing[1]!.trim());
      own = safeAudience(trailing[1]!, errors, part.anchor, part.audience);
      text = raw.slice(0, trailing.index);
    }
    // A top-level list item starts a new item scope; indented lines belong to the current item.
    if (LIST_START.test(text)) item = own;
    // A non-indented line ends the item unless it lazily continues the item's paragraph.
    else if (/^\S/.test(text) && (prevBlank || /^[#|>]/.test(text))) item = null;
    prevBlank = !text.trim();
    let audience = block ? intersectAudience(part.audience, block) : part.audience;
    if (item) audience = intersectAudience(audience, item);
    if (own && !LIST_START.test(text)) audience = intersectAudience(audience, own);
    part.lines.push({ text, audience });
  }
  return { title, version, articles, errors };
}

/** Lines visible to the role, without empty tables and repeated blank lines. */
export function visibleMarkdown(lines: readonly GuideLine[], role: Role, demo: boolean): string {
  const kept = lines.filter((l) => audienceVisible(l.audience, role, demo)).map((l) => l.text.replace(/\s+$/, ''));
  // A table whose rows are all hidden loses its header too.
  const out: string[] = [];
  for (let i = 0; i < kept.length; i++) {
    const l = kept[i]!;
    if (l.trimStart().startsWith('|') && (i === 0 || !kept[i - 1]!.trimStart().startsWith('|'))) {
      let j = i;
      while (j < kept.length && kept[j]!.trimStart().startsWith('|')) j++;
      if (j - i > 2) out.push(...kept.slice(i, j));
      i = j - 1;
      continue;
    }
    out.push(l);
  }
  return out
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export interface LocalizedPart {
  part: GuidePart;
  fallback: boolean;
}

export interface LocalizedArticle extends LocalizedPart {
  part: GuideArticle;
  sections: LocalizedPart[];
}

export interface LocalizedGuide {
  locale: HelpLocale;
  title: string;
  version: string;
  articles: LocalizedArticle[];
}

const sameMarkers = (a: GuidePart, b: GuidePart) => a.markers.length === b.markers.length && a.markers.every((m, i) => m === b.markers[i]);

/**
 * The Russian structure with the translated parts that keep the anchors and markers of Russian. The
 * audience of every heading is always taken from Russian, so a translation can never widen access.
 */
export function localizeGuide(ru: ParsedGuide, locale: HelpLocale, tr: ParsedGuide | null): LocalizedGuide {
  const trArticles = new Map((tr?.articles ?? []).map((a) => [a.anchor, a]));
  const pick = (base: GuidePart, other: GuidePart | undefined): LocalizedPart => {
    if (!other || locale === 'ru' || !sameMarkers(base, other) || (!other.title && base.title)) return { part: base, fallback: locale !== 'ru' };
    return { part: { ...base, title: other.title, lines: other.lines.map((l, i) => ({ text: l.text, audience: retarget(base, other, i) })) }, fallback: false };
  };
  return {
    locale,
    title: (locale !== 'ru' && tr?.title) || ru.title,
    version: (locale !== 'ru' && tr?.version) || ru.version,
    articles: ru.articles.map((a) => {
      const ta = trArticles.get(a.anchor);
      const trSections = new Map((ta?.sections ?? []).map((s) => [s.anchor, s]));
      const lead = pick(a, ta);
      return {
        part: { ...a, title: lead.part.title, lines: lead.part.lines },
        fallback: lead.fallback,
        sections: a.sections.map((s) => pick(s, trSections.get(s.anchor))),
      };
    }),
  };
}

/**
 * Audience of a translated line: the translation's own line audiences are built from the same markers as
 * Russian (checked by sameMarkers), but the heading level is re-applied from Russian.
 */
function retarget(base: GuidePart, other: GuidePart, i: number): Audience {
  const line = other.lines[i]!;
  const roles = [...line.audience.roles].filter((r) => base.audience.roles.has(r));
  return { roles: new Set(roles), demoOnly: line.audience.demoOnly || base.audience.demoOnly };
}

/** Articles visible to the role with their visible subsections (empty ones dropped). */
export function articlesFor(guide: LocalizedGuide, role: Role, demo: boolean): HelpArticle[] {
  const out: HelpArticle[] = [];
  for (const a of guide.articles) {
    if (!audienceVisible(a.part.audience, role, demo)) continue;
    const sections = a.sections
      .filter((s) => audienceVisible(s.part.audience, role, demo))
      .map((s) => ({ anchor: s.part.anchor, title: s.part.title, markdown: visibleMarkdown(s.part.lines, role, demo), fallback: s.fallback }))
      .filter((s) => s.markdown.length > 0);
    const markdown = visibleMarkdown(a.part.lines, role, demo);
    if (!markdown && !sections.length) continue;
    out.push({ anchor: a.part.anchor, number: a.part.number, title: a.part.title, markdown, fallback: a.fallback, sections });
  }
  return out;
}

/** Every anchor of the guide (articles and subsections) with its audience. */
export function anchorAudiences(guide: ParsedGuide): Map<string, Audience> {
  const m = new Map<string, Audience>();
  for (const a of guide.articles) {
    m.set(a.anchor, a.audience);
    for (const s of a.sections) m.set(s.anchor, s.audience);
  }
  return m;
}

export { AUDIENCE_ALL };
