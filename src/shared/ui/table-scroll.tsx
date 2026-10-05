/*
 * The scroll container of a table: header cells (thead th or [data-sticky-head]) stick to its top and a
 * totals row (tfoot or [data-sticky-foot]) to its bottom; a light shadow appears under the header once
 * the table is scrolled. Styles: .table-scroll in src/styles/index.css.
 */
import { useCallback, type HTMLAttributes } from 'react';
import { cn } from '@/shared/lib/cn';

export function TableScroll({ className, onScroll, ...rest }: HTMLAttributes<HTMLDivElement>) {
  const mark = useCallback((el: HTMLDivElement) => {
    if (el.scrollTop > 0) el.setAttribute('data-scrolled', '');
    else el.removeAttribute('data-scrolled');
  }, []);
  return (
    <div
      {...rest}
      data-table-scroll=""
      className={cn('table-scroll', className)}
      onScroll={(e) => {
        mark(e.currentTarget);
        onScroll?.(e);
      }}
    />
  );
}
