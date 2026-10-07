/*
 * «Скачать PDF»: a print view of the whole guide or of the current article, then the browser's print
 * dialog («Сохранить как PDF»). Only what the server gave the role, in the interface language.
 * Print styles (src/styles/index.css, `.help-print*`): a title page (title, role, date, version), the
 * table of contents with internal links, anchor links in the text kept clickable, table rows never split,
 * no menus or buttons — the rest of the app is not printed at all while this view is open.
 * The backend will render the same content to a PDF on the server (headless Chromium, see README).
 */
import { useEffect, useId, useMemo, useRef, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { Printer, X } from 'lucide-react';
import { LOCALE_NAME, t, useLocale } from '@/i18n';
import type { Role } from '@/shared/types';
import type { HelpArticle } from '@/shared/types/help';
import { useHelpGuide } from '@/shared/api/queries/help';
import { ROLE_LABEL } from '@/shared/domain/labels';
import { formatDate } from '@/shared/lib/format';
import { Button } from '@/shared/ui/button';
import { QueryState, SkeletonRows } from '@/shared/ui/states';
import { HelpMarkdown } from './HelpMarkdown';
import { portalOfRole } from './routeMap';

export type PrintScope = { kind: 'all' } | { kind: 'article'; article: HelpArticle };

/** Ids of the print view are prefixed: the article on the screen below has the plain anchors. */
const pid = (anchor: string) => `hp-${anchor}`;

export function HelpPrint({ scope, role, title, version, onClose }: { scope: PrintScope; role: Role; title: string; version: string; onClose: () => void }) {
  const locale = useLocale();
  const guide = useHelpGuide(locale, scope.kind === 'all');
  const titleId = useId();
  const printBtn = useRef<HTMLButtonElement>(null);
  const printed = useRef(false);
  const articles = scope.kind === 'all' ? (guide.data?.articles ?? null) : [scope.article];
  const ready = articles !== null;

  // While open, only this view is printed; Esc closes it and the focus returns where it was.
  useEffect(() => {
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    document.documentElement.classList.add('help-printing');
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.documentElement.classList.remove('help-printing');
      window.removeEventListener('keydown', onKey);
      before?.focus();
    };
  }, [onClose]);

  // Once the content is there, open the print dialog (once).
  useEffect(() => {
    if (!ready) return;
    printBtn.current?.focus();
    if (printed.current) return;
    printed.current = true;
    const raf = window.requestAnimationFrame(() => window.print());
    return () => window.cancelAnimationFrame(raf);
  }, [ready]);

  // Internal links scroll inside the view (the PDF keeps them as links to its own pages).
  const onClick = (e: MouseEvent<HTMLElement>) => {
    const a = (e.target as HTMLElement).closest('a[href^="#hp-"]');
    if (!a) return;
    e.preventDefault();
    document.getElementById(a.getAttribute('href')!.slice(1))?.scrollIntoView({ block: 'start' });
  };

  const view = (
    <div data-theme={portalOfRole(role) === 'staff' || portalOfRole(role) === 'assist' ? 'staff' : 'client'} className="help-print-root fixed inset-0 z-70 overflow-y-auto bg-bg text-text" role="dialog" aria-modal="true" aria-labelledby={titleId} data-testid="help-print">
      <div className="help-print-toolbar sticky top-0 z-10 flex flex-wrap items-center gap-2 border-b border-border bg-surface px-4 py-2">
        <span className="font-semibold">{t('help.print.dialog')}</span>
        <span className="text-[13px] text-muted">{t('help.print.hint')}</span>
        <span className="ml-auto flex gap-2">
          <Button ref={printBtn} size="md" onClick={() => window.print()} disabled={!ready}>
            <Printer className="h-4 w-4" aria-hidden /> {t('help.print.print')}
          </Button>
          <Button size="md" variant="secondary" onClick={onClose}>
            <X className="h-4 w-4" aria-hidden /> {t('common.close')}
          </Button>
        </span>
      </div>
      {scope.kind === 'all' && !guide.data ? (
        <div className="mx-auto max-w-3xl p-6">
          <QueryState query={guide} skeleton={<SkeletonRows rows={8} />}>
            {() => null}
          </QueryState>
        </div>
      ) : (
        <PrintBody articles={articles ?? []} role={role} locale={locale} title={title} version={version} titleId={titleId} subtitle={scope.kind === 'article' ? `${scope.article.number}. ${scope.article.title}` : null} onClick={onClick} />
      )}
    </div>
  );
  return createPortal(view, document.body);
}

function PrintBody({
  articles,
  role,
  locale,
  title,
  version,
  titleId,
  subtitle,
  onClick,
}: {
  articles: readonly HelpArticle[];
  role: Role;
  locale: ReturnType<typeof useLocale>;
  title: string;
  version: string;
  titleId: string;
  subtitle: string | null;
  onClick: (e: MouseEvent<HTMLElement>) => void;
}) {
  const anchors = useMemo(() => new Set(articles.flatMap((a) => [a.anchor, ...a.sections.map((s) => s.anchor)])), [articles]);
  const byNumber = useMemo(() => new Map(articles.map((a) => [a.number, a.anchor])), [articles]);
  const anchorHref = (a: string) => (anchors.has(a) ? `#${pid(a)}` : null);
  const articleByNumber = (n: string) => byNumber.get(n) ?? null;
  return (
    <article className="help-print mx-auto max-w-3xl px-6 py-8" onClick={onClick} lang={locale}>
      <header className="help-print-cover flex min-h-[60vh] flex-col justify-center gap-3 border-b border-border pb-8">
        <h1 id={titleId} className="font-heading text-[28px] font-semibold leading-tight">
          {title}
        </h1>
        {subtitle && <p className="text-[20px] font-semibold">{subtitle}</p>}
        <ul className="mt-4 flex flex-col gap-1 text-[14px] text-muted" data-testid="help-print-meta">
          <li>{t('help.print.role', { role: ROLE_LABEL[role] })}</li>
          <li>{t('help.print.date', { date: formatDate(new Date()) })}</li>
          <li>{t('help.print.language', { language: LOCALE_NAME[locale] })}</li>
          <li>{version}</li>
        </ul>
      </header>
      <nav className="help-print-toc border-b border-border py-6" aria-label={t('help.print.toc')} data-testid="help-print-toc">
        <h2 className="mb-3 text-[20px] font-semibold">{t('help.print.toc')}</h2>
        <ol className="flex flex-col gap-1.5">
          {articles.map((a) => (
            <li key={a.anchor}>
              <a href={`#${pid(a.anchor)}`} className="font-semibold underline-offset-2 hover:underline">
                {a.number}. {a.title}
              </a>
              {a.sections.length > 0 && (
                <ol className="mt-1 flex flex-col gap-0.5 pl-6 text-[14px]">
                  {a.sections.map((s) => (
                    <li key={s.anchor}>
                      <a href={`#${pid(s.anchor)}`} className="underline-offset-2 hover:underline">
                        {s.title}
                      </a>
                    </li>
                  ))}
                </ol>
              )}
            </li>
          ))}
        </ol>
      </nav>
      {articles.map((a) => (
        <section key={a.anchor} id={pid(a.anchor)} className="help-print-article pt-8" aria-labelledby={`${pid(a.anchor)}-h`}>
          <h2 id={`${pid(a.anchor)}-h`} className="mb-3 text-[22px] font-semibold">
            {a.number}. {a.title}
          </h2>
          {a.fallback && <p className="mb-2 text-[12px] italic text-muted">{t('help.fallback')}</p>}
          {a.markdown && <HelpMarkdown markdown={a.markdown} anchorHref={anchorHref} articleByNumber={articleByNumber} />}
          {a.sections.map((s) => (
            <section key={s.anchor} id={pid(s.anchor)} className="help-print-section pt-5">
              <h3 className="mb-2 text-[17px] font-semibold">{s.title}</h3>
              {s.fallback && !a.fallback && <p className="mb-2 text-[12px] italic text-muted">{t('help.fallback')}</p>}
              <HelpMarkdown markdown={s.markdown} anchorHref={anchorHref} articleByNumber={articleByNumber} />
            </section>
          ))}
        </section>
      ))}
    </article>
  );
}
