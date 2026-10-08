/*
 * Columns with pinned headings — one rule for every side column and details card (docs/DECISIONS.md):
 * - <ColumnFrame> is the column's only scroll container: the shared header (title, chips, close) is
 *   pinned at its top, the actions at its bottom, everything between scrolls. The header's height is
 *   measured into the CSS variable --column-head-h on the scroll container.
 * - A section of a column (<SideSection>, or a <Card> inside a column or with `sticky`) pins its
 *   heading inside its own box at top: var(--column-head-h): the heading rides right under the shared
 *   header while its section scrolls by, and the next heading pushes it up (as the letters in a phone's
 *   contact list). The heading is opaque; once pinned it gets data-stuck and a light bottom border
 *   (useStickySections, one listener per portal). A table inside such a section pins its header below
 *   the section heading (--section-head-h).
 */
import { createContext, useContext, useEffect, useLayoutEffect, useRef, type ReactNode, type RefObject } from 'react';
import { cn } from '@/shared/lib/cn';

/** Inside a column: cards pin their headings. */
export const StickySectionsCtx = createContext(false);

export function useStickyDefault(): boolean {
  return useContext(StickySectionsCtx);
}

/** Writes the height of `el` into `name` on `target` (or on the element itself), following resizes. */
export function useHeightVar(el: RefObject<HTMLElement | null>, target: RefObject<HTMLElement | null>, name: string, enabled = true): void {
  useLayoutEffect(() => {
    const node = el.current;
    const host = target.current;
    if (!enabled || !node || !host) return;
    const write = () => host.style.setProperty(name, `${node.offsetHeight}px`);
    write();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(write);
    ro.observe(node);
    return () => {
      ro.disconnect();
      host.style.removeProperty(name);
    };
  }, [el, target, name, enabled]);
}

/** Heading pinned when it no longer stands at the top of its section. */
export function markStuck(root: ParentNode = document): void {
  for (const head of root.querySelectorAll<HTMLElement>('[data-section-head]')) {
    const section = head.parentElement;
    if (!section) continue;
    // A card's heading stands inside its border: compare with the inner edge.
    const stuck = head.getBoundingClientRect().top - (section.getBoundingClientRect().top + section.clientTop) > 0.5;
    if (stuck) head.setAttribute('data-stuck', '');
    else head.removeAttribute('data-stuck');
  }
}

/** One capture listener for every scroll container of the portal: marks the pinned headings. */
export function useStickySections(): void {
  useEffect(() => {
    let frame = 0;
    const run = () => {
      frame = 0;
      markStuck();
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(run);
    };
    document.addEventListener('scroll', schedule, true);
    window.addEventListener('resize', schedule);
    return () => {
      document.removeEventListener('scroll', schedule, true);
      window.removeEventListener('resize', schedule);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);
}

export interface ColumnFrameProps {
  header?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
  headerClassName?: string;
  bodyClassName?: string;
  footerClassName?: string;
  testIds?: { scroll?: string; header?: string; footer?: string };
}

/** The scroll container of a column: pinned header, scrolling sections, pinned actions. */
export function ColumnFrame(p: ColumnFrameProps) {
  const scroll = useRef<HTMLDivElement>(null);
  const head = useRef<HTMLDivElement>(null);
  useHeightVar(head, scroll, '--column-head-h', !!p.header);
  return (
    <div
      ref={scroll}
      data-column-scroll=""
      data-testid={p.testIds?.scroll}
      className={cn('flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain [scrollbar-gutter:stable] print:overflow-visible', p.className)}
    >
      {p.header && (
        <div ref={head} data-column-head="" data-testid={p.testIds?.header} className={cn('sticky top-0 z-[4] shrink-0 bg-surface', p.headerClassName)}>
          {p.header}
        </div>
      )}
      <StickySectionsCtx.Provider value>
        <div className={cn('flex-[1_0_auto]', p.bodyClassName)}>{p.children}</div>
      </StickySectionsCtx.Provider>
      {p.footer && (
        <div data-column-foot="" data-testid={p.testIds?.footer} className={cn('sticky bottom-0 z-[4] shrink-0 bg-surface', p.footerClassName)}>
          {p.footer}
        </div>
      )}
    </div>
  );
}

/** A section of a column (or of a long card) whose heading pins under the column header. */
export function SideSection({
  title,
  actions,
  children,
  className,
  headClassName,
  testId,
}: {
  title: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  headClassName?: string;
  testId?: string;
}) {
  const section = useRef<HTMLElement>(null);
  const head = useRef<HTMLDivElement>(null);
  useHeightVar(head, section, '--section-head-h');
  return (
    <section ref={section} data-sticky-section="" data-testid={testId} className={className}>
      <div ref={head} data-section-head="" className={cn('flex items-center justify-between gap-2 py-1', headClassName)}>
        <h3 className="text-[14px] font-bold">{title}</h3>
        {actions}
      </div>
      {children}
    </section>
  );
}
