/*
 * The help screen of every portal (`/<portal>/help/<article>#<subsection>`): «Задайте вопрос» and the
 * search on top, the table of contents (only the articles the role may read) on the left, the article on
 * the right with breadcrumbs, «Предыдущая / Следующая», a copy-link button on every subsection, glossary
 * terms with their definitions, «Открыть раздел» for screens the role may open and «Скачать PDF».
 * Everything comes from /api/help already filtered for the role and in the interface language.
 */
import { useDocked } from '@/shared/ui/detail-panel';
import { SideColumn } from '@/shared/ui/side-column';
import { useCallback, useEffect, useMemo, useState, type MouseEvent, type ReactNode } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Download, Languages, Link2, ListTree } from 'lucide-react';
import { t, useLocale } from '@/i18n';
import type { Role } from '@mig/contracts';
import type { HelpArticle, HelpToc } from '@mig/contracts/help';
import { useHelpArticle, useHelpGlossary, useHelpToc } from '@/shared/api/queries/help';
import { useUser } from '@/shared/auth/session';
import { GLOSSARY_ANCHOR } from '@/shared/help/glossary';
import { useDocumentTitle } from '@/shared/lib/hooks';
import { cn } from '@/shared/lib/cn';
import { Button } from '@/shared/ui/button';
import { Menu, MenuContent, MenuItem, MenuTrigger } from '@/shared/ui/dropdown';
import { Breadcrumbs, type Crumb } from '@/shared/ui/page';
import { EmptyState, ErrorState, SkeletonRows } from '@/shared/ui/states';
import { toast } from '@/shared/ui/toast';
import { useTopbar } from '@/features/staff/topbar';
import { HelpMarkdown } from './HelpMarkdown';
import { termRenderer } from './HelpText';
import { HelpFinder } from './HelpFinder';
import { HelpPrint, type PrintScope } from './HelpPrint';
import { OpenSectionLinks } from './HelpLinks';
import { cleanAnchor, helpBase, helpHref } from './paths';
import { portalOfRole, screensMentioned } from './routeMap';

export interface HelpScreenProps {
  /** The support channel for «В справке нет ответа» when the portal has its own (HR: the client's manager). */
  support?: ReactNode;
  /** Extra content next to the article (HR: the manager's card). */
  aside?: ReactNode;
}

/** Router state of a jump into the help with a question to answer at once. */
export interface HelpLocationState {
  helpAsk?: string;
}

export function HelpScreen({ support, aside }: HelpScreenProps) {
  const user = useUser();
  if (!user) return null;
  return <HelpScreenFor role={user.role} support={support} aside={aside} />;
}

function HelpScreenFor({ role, support, aside }: HelpScreenProps & { role: Role }) {
  const locale = useLocale();
  const navigate = useNavigate();
  const { anchor: rawAnchor } = useParams();
  const { hash, state } = useLocation();
  // «Спросить в справке» of Ctrl+K: the question comes in the router state (never in the URL).
  const initialQuestion = typeof (state as HelpLocationState | null)?.helpAsk === 'string' ? (state as HelpLocationState).helpAsk! : null;
  const base = helpBase(role);
  const portal = portalOfRole(role);
  const narrow = portal === 'app';
  const toc = useHelpToc(locale);
  const glossary = useHelpGlossary(locale);
  const requested = cleanAnchor(rawAnchor) ?? toc.data?.articles[0]?.anchor ?? null;
  const article = useHelpArticle(requested, locale);
  const a = article.data;
  // The subsection to show: the hash, or a subsection anchor in the path (context help «?»).
  const section = cleanAnchor(hash) ?? (a && requested !== a.anchor ? requested : null);
  const [print, setPrint] = useState<PrintScope | null>(null);
  const [tocOpen, setTocOpen] = useState(false);

  const crumbs: Crumb[] = [{ label: t('help.title'), to: a ? base : undefined }];
  if (a) crumbs.push({ label: `${a.number}. ${a.title}`, to: section ? helpHref(base, a.anchor) : undefined });
  const sec = a?.sections.find((s) => s.anchor === section);
  if (sec) crumbs.push({ label: sec.title });
  // The staff and assistance portals show breadcrumbs in their top bar; the others on the page.
  const crumbsInTopbar = portal === 'staff' || portal === 'assist';
  useTopbar(crumbsInTopbar ? crumbs : []);
  useDocumentTitle(a ? `${a.title} · ${t('help.title')}` : t('help.title'));

  // Scroll to the subsection; a new article starts at its title (the content area scrolls to the top itself).
  useEffect(() => {
    if (!a) return;
    if (section) document.getElementById(section)?.scrollIntoView?.({ block: 'start' });
    else if (portal === 'app') window.scrollTo({ top: 0 });
  }, [a, section, portal]);

  const open = useCallback((to: string) => navigate(to), [navigate]);
  // The question of Ctrl+K is asked once: the history entry forgets it (Back does not ask again).
  useEffect(() => {
    if (initialQuestion) navigate({ hash }, { replace: true, state: null });
  }, [initialQuestion, hash, navigate]);
  // Links inside the guide text are plain <a href>: handle them in the app without reloading the page.
  const onArticleClick = (e: MouseEvent<HTMLElement>) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const link = (e.target as HTMLElement).closest('a');
    const href = link?.getAttribute('href');
    if (!link || !href?.startsWith(`${base}/`)) return;
    e.preventDefault();
    navigate(href);
  };

  const docked = useDocked() && !narrow;
  const tocBody = toc.isLoading ? (
    <SkeletonRows rows={10} />
  ) : toc.data ? (
    <TocNav toc={toc.data} base={base} current={a?.anchor ?? null} section={section} onPick={() => setTocOpen(false)} />
  ) : (
    <ErrorState error={toc.error} onRetry={() => void toc.refetch()} />
  );
  return (
    <div className="flex flex-col gap-4" data-testid="help-screen">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-heading text-[22px] font-semibold leading-tight">{t('help.title')}</h1>
          <p className="mt-0.5 text-[13px] text-muted">{t('help.subtitle')}</p>
          {toc.data?.version && <p className="text-[12px] text-muted">{toc.data.version}</p>}
        </div>
        <Menu>
          <MenuTrigger asChild>
            <Button variant="secondary" size="md" disabled={!toc.data}>
              <Download className="h-4 w-4" aria-hidden /> {t('help.pdf.button')}
            </Button>
          </MenuTrigger>
          <MenuContent>
            <MenuItem onSelect={() => setPrint({ kind: 'all' })}>{t('help.pdf.all')}</MenuItem>
            <MenuItem disabled={!a} onSelect={() => a && setPrint({ kind: 'article', article: a })}>
              {t('help.pdf.current')}
            </MenuItem>
          </MenuContent>
        </Menu>
      </div>
      {!crumbsInTopbar && <Breadcrumbs items={crumbs} />}

      <HelpFinder role={role} base={base} support={support} onOpen={open} initialQuestion={initialQuestion} />

      {/*
        The table of contents is the start column of the portal (≥ 1280 px): it stays in place and scrolls by
        itself. Below that, and in the app (a phone column), it is behind its button above the article.
      */}
      <div className="grid gap-4">
        {docked ? (
          <SideColumn position="start" label={t('help.toc')} width={280} testId="help-toc-column">
            {tocBody}
          </SideColumn>
        ) : (
          <div className="min-w-0">
            <Button variant="secondary" size="md" className="w-full justify-start" aria-expanded={tocOpen} onClick={() => setTocOpen((v) => !v)}>
              <ListTree className="h-4 w-4" aria-hidden /> {t('help.tocToggle')}
            </Button>
            <div className={cn('mt-2', !tocOpen && 'hidden')}>{tocBody}</div>
          </div>
        )}
        <div className="flex min-w-0 flex-col gap-4">
          {article.isLoading || (!requested && toc.isLoading) ? (
            <SkeletonRows rows={12} />
          ) : article.isError || !a ? (
            <EmptyState
              title={t('help.notFound')}
              action={
                toc.data?.articles[0] && (
                  <Link to={helpHref(base, toc.data.articles[0].anchor)} className="text-accent-text underline underline-offset-2">
                    {t('help.toFirst')}
                  </Link>
                )
              }
            />
          ) : (
            <ArticleView article={a} role={role} base={base} toc={toc.data} terms={glossary.data?.terms ?? []} onClick={onArticleClick} />
          )}
          {aside}
        </div>
      </div>
      {print && toc.data && <HelpPrint scope={print} role={role} title={toc.data.title} version={toc.data.version} onClose={() => setPrint(null)} />}
    </div>
  );
}

function TocNav({ toc, base, current, section, onPick }: { toc: HelpToc; base: string; current: string | null; section: string | null; onPick: () => void }) {
  return (
    <nav aria-label={t('help.toc')} data-testid="help-toc" className="rounded-card border border-border bg-surface p-2 text-[13px]">
      <p className="px-2 pb-1 pt-1 text-[12px] font-semibold uppercase tracking-wide text-muted" aria-hidden>
        {t('help.toc')}
      </p>
      <ol className="flex flex-col gap-px">
        {toc.articles.map((x) => {
          const active = x.anchor === current;
          return (
            <li key={x.anchor}>
              <Link
                to={helpHref(base, x.anchor)}
                onClick={onPick}
                aria-current={active && !section ? 'page' : undefined}
                className={cn('flex gap-1.5 rounded-btn px-2 py-1.5 hover:bg-rail', active && 'bg-accent-soft font-semibold text-accent-text')}
              >
                <span className="num w-5 shrink-0 text-right text-muted">{x.number}.</span>
                <span className="min-w-0">{x.title}</span>
              </Link>
              {active && x.sections.length > 0 && (
                <ol className="mb-1 ml-7 mt-0.5 flex flex-col gap-px border-l border-border-soft pl-2">
                  {x.sections.map((s) => (
                    <li key={s.anchor}>
                      <Link
                        to={helpHref(base, x.anchor, s.anchor)}
                        onClick={onPick}
                        aria-current={s.anchor === section ? 'location' : undefined}
                        className={cn('block rounded-btn px-2 py-1 text-muted hover:bg-rail hover:text-text', s.anchor === section && 'font-semibold text-text')}
                      >
                        {s.title}
                      </Link>
                    </li>
                  ))}
                </ol>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function ArticleView({
  article: a,
  role,
  base,
  toc,
  terms,
  onClick,
}: {
  article: HelpArticle;
  role: Role;
  base: string;
  toc: HelpToc | undefined;
  terms: Parameters<typeof termRenderer>[0];
  onClick: (e: MouseEvent<HTMLElement>) => void;
}) {
  const articles = useMemo(() => toc?.articles ?? [], [toc]);
  const idx = articles.findIndex((x) => x.anchor === a.anchor);
  const prev = idx > 0 ? articles[idx - 1] : undefined;
  const next = idx >= 0 ? articles[idx + 1] : undefined;
  // Anchor → its article, for links in the text (only anchors the role may read become links).
  const articleOf = useMemo(() => {
    const m = new Map<string, string>();
    for (const x of articles) {
      m.set(x.anchor, x.anchor);
      for (const s of x.sections) m.set(s.anchor, x.anchor);
    }
    return m;
  }, [articles]);
  const byNumber = useMemo(() => new Map(articles.map((x) => [x.number, x.anchor])), [articles]);
  const anchorHref = (anchor: string) => {
    const art = articleOf.get(anchor);
    return art ? helpHref(base, art, anchor) : null;
  };
  const articleByNumber = (n: string) => byNumber.get(n) ?? null;
  // The glossary itself is not underlined; elsewhere each term is marked once per article.
  const renderText = a.anchor === GLOSSARY_ANCHOR ? undefined : termRenderer(terms, new Set<string>());
  const allFallback = a.fallback && a.sections.every((s) => s.fallback);

  const copy = async (anchor: string) => {
    const url = `${window.location.origin}${helpHref(base, a.anchor, anchor)}`;
    try {
      await navigator.clipboard.writeText(url);
      toast.success(t('help.copied'));
    } catch {
      toast.error(t('help.copyFailed'));
    }
  };

  return (
    <article className="min-w-0 rounded-card border border-border bg-surface p-4 md:p-6" data-testid="help-article" data-anchor={a.anchor} onClick={onClick} aria-labelledby={`${a.anchor}-title`}>
      <h2 id={`${a.anchor}-title`} className="font-heading text-[20px] font-semibold leading-tight">
        {a.number}. {a.title}
      </h2>
      {allFallback && <FallbackNote />}
      {a.markdown && (
        <div className="mt-3">
          {a.fallback && !allFallback && <FallbackNote />}
          <HelpMarkdown markdown={a.markdown} anchorHref={anchorHref} articleByNumber={articleByNumber} renderText={renderText} />
          <OpenSectionLinks role={role} links={screensMentioned(a.markdown, role)} className="mt-3 flex flex-wrap gap-2" />
        </div>
      )}
      {a.sections.map((s) => (
        <section key={s.anchor} id={s.anchor} aria-labelledby={`${s.anchor}-h`} className="mt-6 scroll-mt-4" data-testid="help-section">
          <div className="group flex items-start gap-2">
            <h3 id={`${s.anchor}-h`} className="text-[16px] font-semibold leading-snug">
              {s.title}
            </h3>
            <button
              type="button"
              onClick={() => void copy(s.anchor)}
              className="shrink-0 rounded-btn p-1 text-muted hover:bg-rail hover:text-text"
              aria-label={t('help.copyLink', { title: s.title })}
              title={t('help.copyLink', { title: s.title })}
            >
              <Link2 className="h-4 w-4" aria-hidden />
            </button>
          </div>
          {s.fallback && !allFallback && <FallbackNote />}
          <HelpMarkdown className="mt-2" markdown={s.markdown} anchorHref={anchorHref} articleByNumber={articleByNumber} renderText={renderText} />
          <OpenSectionLinks role={role} links={screensMentioned(s.markdown, role)} className="mt-3 flex flex-wrap gap-2" />
        </section>
      ))}
      <nav aria-label={t('help.pager')} className="mt-8 flex flex-wrap justify-between gap-2 border-t border-border-soft pt-4 text-[13px]">
        {prev ? (
          <Link to={helpHref(base, prev.anchor)} rel="prev" className="flex max-w-[48%] items-center gap-1.5 rounded-btn px-2 py-1.5 hover:bg-rail">
            <ChevronLeft className="h-4 w-4 shrink-0" aria-hidden />
            <span className="min-w-0">
              <span className="block text-[12px] text-muted">{t('help.prev')}</span>
              <span className="font-semibold">
                {prev.number}. {prev.title}
              </span>
            </span>
          </Link>
        ) : (
          <span />
        )}
        {next && (
          <Link to={helpHref(base, next.anchor)} rel="next" className="ml-auto flex max-w-[48%] items-center gap-1.5 rounded-btn px-2 py-1.5 text-right hover:bg-rail">
            <span className="min-w-0">
              <span className="block text-[12px] text-muted">{t('help.next')}</span>
              <span className="font-semibold">
                {next.number}. {next.title}
              </span>
            </span>
            <ChevronRight className="h-4 w-4 shrink-0" aria-hidden />
          </Link>
        )}
      </nav>
    </article>
  );
}

function FallbackNote() {
  return (
    <p className="my-2 flex items-center gap-2 rounded-btn bg-sky px-3 py-2 text-[13px] text-sky-text" data-testid="help-fallback">
      <Languages className="h-4 w-4 shrink-0" aria-hidden />
      {t('help.fallback')}
    </p>
  );
}
