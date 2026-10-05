import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/shared/lib/cn';
import { formatNumber } from '@/shared/lib/format';
import { Button } from './button';
import { EmptyState, ErrorState, Skeleton } from './states';

export interface Column<T> {
  key: string;
  header: string;
  cell: (row: T) => ReactNode;
  /** Server-side sort key; column is sortable when set. */
  sortKey?: string;
  className?: string;
  align?: 'left' | 'right';
  hideable?: boolean;
}

export interface SortState {
  key: string;
  dir: 'asc' | 'desc';
}

export function parseSort(raw: string | null | undefined): SortState | null {
  if (!raw) return null;
  const [key, dir] = raw.split(':');
  if (!key) return null;
  return { key, dir: dir === 'desc' ? 'desc' : 'asc' };
}
export function formatSort(s: SortState | null): string | undefined {
  return s ? `${s.key}:${s.dir}` : undefined;
}

export interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[] | undefined;
  rowKey: (row: T) => string;
  loading?: boolean;
  error?: unknown;
  onRetry?: () => void;
  sort?: SortState | null;
  onSortChange?: (s: SortState) => void;
  onRowClick?: (row: T) => void;
  /** Called with Enter (open) and Esc (close) from the keyboard. */
  onRowOpen?: (row: T) => void;
  onEscape?: () => void;
  activeKey?: string | null;
  empty?: ReactNode;
  page?: number;
  pageSize?: number;
  total?: number;
  onPageChange?: (page: number) => void;
  footer?: ReactNode;
  rowHeight?: number;
  hiddenColumns?: string[];
  caption: string;
  density?: 'staff' | 'client';
}

/** Table with server sort, pagination, loading/empty/error states and ↑/↓/Enter/Esc navigation. */
export function DataTable<T>(p: DataTableProps<T>) {
  const [focusIdx, setFocusIdx] = useState(-1);
  const bodyRef = useRef<HTMLTableSectionElement>(null);
  const cols = p.columns.filter((c) => !p.hiddenColumns?.includes(c.key));
  const rows = p.rows ?? [];
  const rowH = p.rowHeight ?? (p.density === 'client' ? 56 : 44);

  useEffect(() => setFocusIdx(-1), [p.rows]);

  const focusRow = (idx: number) => {
    const el = bodyRef.current?.querySelectorAll<HTMLTableRowElement>('tr[data-row]')[idx];
    el?.focus();
    setFocusIdx(idx);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTableSectionElement>) => {
    if (!rows.length) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      focusRow(Math.min(rows.length - 1, focusIdx + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      focusRow(Math.max(0, focusIdx - 1));
    } else if (e.key === 'Enter' && focusIdx >= 0) {
      e.preventDefault();
      const row = rows[focusIdx];
      if (row) (p.onRowOpen ?? p.onRowClick)?.(row);
    } else if (e.key === 'Escape') {
      p.onEscape?.();
    }
  };

  const totalPages = p.total !== undefined && p.pageSize ? Math.max(1, Math.ceil(p.total / p.pageSize)) : 1;

  return (
    <div className="flex min-h-0 flex-col">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left">
          <caption className="sr-only">{p.caption}</caption>
          <thead>
            <tr className="border-b border-border">
              {cols.map((c) => {
                const active = p.sort?.key === c.sortKey;
                return (
                  <th
                    key={c.key}
                    scope="col"
                    aria-sort={active ? (p.sort?.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                    className={cn('h-9 whitespace-nowrap px-3 text-[12px] font-normal text-muted', c.align === 'right' && 'text-right', c.className)}
                  >
                    {c.sortKey && p.onSortChange ? (
                      <button
                        type="button"
                        className={cn('inline-flex items-center gap-1 hover:text-text', active && 'text-text')}
                        onClick={() =>
                          p.onSortChange?.({
                            key: c.sortKey!,
                            dir: active && p.sort?.dir === 'asc' ? 'desc' : 'asc',
                          })
                        }
                      >
                        {c.header}
                        {active ? (
                          p.sort?.dir === 'asc' ? (
                            <ArrowUp className="h-3 w-3" aria-hidden />
                          ) : (
                            <ArrowDown className="h-3 w-3" aria-hidden />
                          )
                        ) : null}
                      </button>
                    ) : (
                      c.header
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody ref={bodyRef} onKeyDown={onKeyDown}>
            {p.loading && !p.rows
              ? Array.from({ length: 8 }, (_, i) => (
                  <tr key={i} className="border-b border-border-soft" style={{ height: rowH }}>
                    {cols.map((c) => (
                      <td key={c.key} className="px-3">
                        <Skeleton className="h-4 w-3/4" />
                      </td>
                    ))}
                  </tr>
                ))
              : rows.map((row, idx) => {
                  const key = p.rowKey(row);
                  const interactive = !!p.onRowClick;
                  return (
                    <tr
                      key={key}
                      data-row
                      tabIndex={interactive ? (idx === Math.max(0, focusIdx) ? 0 : -1) : undefined}
                      aria-selected={p.activeKey === key || undefined}
                      onFocus={() => setFocusIdx(idx)}
                      onClick={interactive ? () => p.onRowClick?.(row) : undefined}
                      style={{ height: rowH }}
                      className={cn(
                        'border-b border-border-soft',
                        interactive && 'cursor-pointer hover:bg-rail/60 focus-visible:bg-accent-soft focus-visible:outline-hidden',
                        p.activeKey === key && 'bg-accent-soft',
                      )}
                    >
                      {cols.map((c) => (
                        <td key={c.key} className={cn('px-3', c.align === 'right' && 'text-right', c.className)}>
                          {c.cell(row)}
                        </td>
                      ))}
                    </tr>
                  );
                })}
          </tbody>
        </table>
      </div>
      {p.error && !p.loading ? <ErrorState error={p.error} onRetry={p.onRetry} /> : null}
      {!p.loading && !p.error && p.rows && p.rows.length === 0 ? (p.empty ?? <EmptyState title="Ничего не найдено" description="Измените фильтры или поиск" />) : null}
      {(p.onPageChange || p.footer) && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-3 py-2 text-muted">
          <div>{p.footer}</div>
          {p.onPageChange && p.total !== undefined && p.total > 0 && (
            <nav className="flex items-center gap-2" aria-label="Страницы">
              <span>
                {formatNumber((p.page! - 1) * p.pageSize! + 1)}–{formatNumber(Math.min(p.total, p.page! * p.pageSize!))} из {formatNumber(p.total)}
              </span>
              <Button variant="secondary" size="icon" aria-label="Предыдущая страница" disabled={p.page! <= 1} onClick={() => p.onPageChange?.(p.page! - 1)}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button
                variant="secondary"
                size="icon"
                aria-label="Следующая страница"
                disabled={p.page! >= totalPages}
                onClick={() => p.onPageChange?.(p.page! + 1)}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </nav>
          )}
        </div>
      )}
    </div>
  );
}
