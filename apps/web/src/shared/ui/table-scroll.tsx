/*
 * The wrapper of a table with a pinned header: header cells (thead th or [data-sticky-head]) stick to
 * the top of the nearest scroll container — the portal content area (<ContentScroll>) or a side panel,
 * dialog or card that scrolls by itself — and a totals row (tfoot or [data-sticky-foot]) to its bottom.
 * The wrapper itself never scrolls. A light shadow appears under the header while it is pinned
 * (data-scrolled). Styles: .table-scroll in src/styles/index.css.
 */
import { useEffect, useRef, type HTMLAttributes } from 'react';
import { cn } from '@/shared/lib/cn';

/** The nearest ancestor that scrolls vertically (null: the document). */
function scrollParent(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const y = getComputedStyle(p).overflowY;
    if (y === 'auto' || y === 'scroll') return p;
  }
  return null;
}

export function TableScroll({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const root = scrollParent(el);
    const target: HTMLElement | Window = root ?? window;
    const mark = () => {
      const top = root ? root.getBoundingClientRect().top : 0;
      const box = el.getBoundingClientRect();
      if (box.top < top - 0.5 && box.bottom > top) el.setAttribute('data-scrolled', '');
      else el.removeAttribute('data-scrolled');
    };
    mark();
    target.addEventListener('scroll', mark, { passive: true });
    return () => target.removeEventListener('scroll', mark);
  }, []);
  return <div {...rest} ref={ref} data-table-scroll="" className={cn('table-scroll', className)} />;
}
