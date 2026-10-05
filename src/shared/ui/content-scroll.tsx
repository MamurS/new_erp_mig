/*
 * The one vertical (and horizontal) scroll container of a portal: the content area under the top
 * bar. Page titles, tabs and filters scroll away inside it, while a table's header cells stick to its
 * top edge (right under the top bar) and the totals row and pagination to its bottom edge — see
 * .table-scroll in src/styles/index.css and docs/DECISIONS.md. A wide table scrolls the whole content
 * area sideways, so no table wrapper becomes a scroll container that would capture the sticky cells.
 * Navigation to another page starts at the top.
 */
import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { cn } from '@/shared/lib/cn';

export function ContentScroll({ className, children }: { className?: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const { pathname } = useLocation();
  useLayoutEffect(() => {
    ref.current?.scrollTo({ top: 0, left: 0 });
  }, [pathname]);
  return (
    <div ref={ref} data-content-scroll="" className="min-h-0 min-w-0 flex-1 overflow-auto [scrollbar-gutter:stable]">
      <main className={cn('min-w-0', className)}>{children}</main>
    </div>
  );
}
