/*
 * The one vertical (and horizontal) scroll container of a portal: the content area under the top
 * bar. Page titles, tabs and filters scroll away inside it, while a table's header cells stick to its
 * top edge (right under the top bar) and the totals row and pagination to its bottom edge — see
 * .table-scroll in src/styles/index.css and docs/DECISIONS.md. A wide table scrolls the whole content
 * area sideways, so no table wrapper becomes a scroll container that would capture the sticky cells.
 * Navigation to another page starts at the top.
 * Next to it sits the slot of a split view's details card (<DetailPanel>, src/shared/ui/detail-panel.tsx):
 * the card is a sibling of the content area, so the content area narrows by its width and the card
 * neither scrolls with the page nor sits under the pinned table header. While a card is open over the
 * content (narrow screens) the content area does not scroll.
 */
import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { cn } from '@/shared/lib/cn';
import { DetailPanelHost } from './detail-panel';

export function ContentScroll({ className, children }: { className?: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const { pathname } = useLocation();
  useLayoutEffect(() => {
    ref.current?.scrollTo({ top: 0, left: 0 });
  }, [pathname]);
  return (
    <DetailPanelHost>
      {(locked) => (
        <div
          ref={ref}
          data-content-scroll=""
          data-locked={locked || undefined}
          className={cn('min-h-0 min-w-0 flex-1 [scrollbar-gutter:stable]', locked ? 'overflow-hidden' : 'overflow-auto')}
        >
          <main className={cn('min-w-0', className)}>{children}</main>
        </div>
      )}
    </DetailPanelHost>
  );
}
