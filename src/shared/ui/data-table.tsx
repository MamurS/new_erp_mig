import { t } from '@/i18n';
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import * as M from '@radix-ui/react-dropdown-menu';
import { ArrowDown, ArrowUp, Check, ChevronLeft, ChevronRight, ListFilter } from 'lucide-react';
import { cn } from '@/shared/lib/cn';
import { formatNumber } from '@/shared/lib/format';
import { Button } from './button';
import { EmptyState, ErrorState, Skeleton } from './states';
import { TableScroll } from './table-scroll';

export interface Column<T> {
  key: string;
  header: string;
  cell: (row: T) => ReactNode;
  /** Server-side sort key; column is sortable when set. */
  sortKey?: string;
  className?: string;
  align?: 'left' | 'right';
  hideable?: boolean;
  /** Filter by values in the header (a list of checkboxes); the page applies it (usually on the server). */
  filter?: ColumnFilter;
}

export interface ColumnFilter {
  options: { value: string; label: string; title?: string }[];
  selected: string[];
  onChange: (selected: string[]) => void;
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
  /** ↑/↓ moved the focus to this row (a split view switches its card to it). */
  onRowMove?: (row: T) => void;
  /** The selected row: highlighted and scrolled into view when it changes. */
  activeKey?: string | null;
  empty?: ReactNode;
  page?: number;
  pageSize?: number;
  total?: number;
  onPageChange?: (page: number) => void;
  footer?: ReactNode;
  rowHeight?: number;
  hiddenColumns?: string[];
  /** Totals row at the bottom, by column key; pinned to the bottom of the table's scroll container. */
  totals?: Partial<Record<string, ReactNode>>;
  caption: string;
  density?: 'staff' | 'client';
}

/**
 * Brings a row into view inside the portal content area, clear of the pinned header above it and the
 * pinned totals row and pager below it (Chrome's scrollIntoView ignores scroll-margin for a row that is
 * already inside the scrollport, so the offsets are applied here). Elsewhere: the browser's 'nearest'.
 */
function reveal(row: HTMLElement | undefined): void {
  if (!row) return;
  const scroller = row.closest<HTMLElement>('[data-content-scroll]');
  if (!scroller) {
    row.scrollIntoView?.({ block: 'nearest' });
    return;
  }
  const table = row.closest('table');
  // In a section with a pinned heading the table header pins below that heading.
  const sectionHead = row.closest('[data-sticky-section]') ? parseFloat(getComputedStyle(row).getPropertyValue('--section-head-h')) || 0 : 0;
  const head = (table?.tHead?.offsetHeight ?? 0) + sectionHead;
  const foot = table?.tFoot?.offsetHeight ?? 0;
  const pager = parseFloat(getComputedStyle(row).getPropertyValue('--pager-h')) || 0;
  const box = scroller.getBoundingClientRect();
  const r = row.getBoundingClientRect();
  const top = box.top + head;
  const bottom = box.top + scroller.clientHeight - foot - pager;
  if (r.top < top) scroller.scrollTop -= top - r.top;
  else if (r.bottom > bottom) scroller.scrollTop += Math.min(r.bottom - bottom, r.top - top);
}

/** Table with server sort, pagination, loading/empty/error states and ↑/↓/Enter/Esc navigation. */
export function DataTable<T>(p: DataTableProps<T>) {
  const [focusIdx, setFocusIdx] = useState(-1);
  const bodyRef = useRef<HTMLTableSectionElement>(null);
  const cols = p.columns.filter((c) => !p.hiddenColumns?.includes(c.key));
  const rows = p.rows ?? [];
  const rowH = p.rowHeight ?? (p.density === 'client' ? 56 : 44);

  useEffect(() => setFocusIdx(-1), [p.rows]);

  // The totals row sticks right above the pinned pagination bar: its height goes into --pager-h.
  const rootRef = useRef<HTMLDivElement>(null);
  const pagerRef = useRef<HTMLDivElement>(null);
  const hasPager = !!(p.onPageChange || p.footer);
  useEffect(() => {
    const root = rootRef.current;
    const pager = pagerRef.current;
    if (!root) return;
    if (!pager || typeof ResizeObserver === 'undefined') {
      root.style.removeProperty('--pager-h');
      return;
    }
    const ro = new ResizeObserver(() => root.style.setProperty('--pager-h', `${pager.offsetHeight}px`));
    ro.observe(pager);
    return () => ro.disconnect();
  }, [hasPager]);

  const focusRow = (idx: number) => {
    const el = bodyRef.current?.querySelectorAll<HTMLTableRowElement>('tr[data-row]')[idx];
    el?.focus({ preventScroll: true });
    reveal(el);
    setFocusIdx(idx);
    const row = rows[idx];
    if (row && el) p.onRowMove?.(row);
  };

  // A newly selected row (a click, a direct ?panel= link, ↑/↓) is brought into view.
  const hasRows = rows.length > 0;
  useEffect(() => {
    if (!p.activeKey || !hasRows) return;
    const el = [...(bodyRef.current?.querySelectorAll<HTMLTableRowElement>('tr[data-row]') ?? [])].find((r) => r.dataset.key === p.activeKey);
    reveal(el);
  }, [p.activeKey, hasRows]);

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
    <div ref={rootRef} className="flex min-h-0 flex-col">
      <TableScroll>
        <table className="w-full border-collapse text-left">
          <caption className="sr-only">{p.caption}</caption>
          <thead>
            <tr>
              {cols.map((c) => {
                const active = p.sort?.key === c.sortKey;
                return (
                  <th
                    key={c.key}
                    scope="col"
                    aria-sort={active ? (p.sort?.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                    className={cn('h-9 whitespace-nowrap px-3 text-[12px] font-normal text-muted', c.align === 'right' && 'text-right', c.className)}
                  >
                    <span className="inline-flex items-center gap-0.5">
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
                    {c.filter && <HeaderFilter label={c.header} filter={c.filter} />}
                    </span>
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
                      data-key={p.activeKey !== undefined ? key : undefined}
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
          {p.totals && p.rows && p.rows.length > 0 && (
            <tfoot data-testid="table-totals">
              <tr>
                {cols.map((c) => (
                  <td key={c.key} className={cn('h-9 whitespace-nowrap px-3 font-semibold', c.align === 'right' && 'text-right', c.className)}>
                    {p.totals?.[c.key] ?? null}
                  </td>
                ))}
              </tr>
            </tfoot>
          )}
        </table>
      </TableScroll>
      {p.error && !p.loading ? <ErrorState error={p.error} onRetry={p.onRetry} /> : null}
      {!p.loading && !p.error && p.rows && p.rows.length === 0 ? (p.empty ?? <EmptyState title={t('common.notFound')} description={t('shell.table.emptyHint')} />) : null}
      {hasPager && (
        <div ref={pagerRef} data-testid="table-pager" className="table-pager flex flex-wrap items-center justify-between gap-2 border-t border-border px-3 py-2 text-muted">
          <div>{p.footer}</div>
          {p.onPageChange && p.total !== undefined && p.total > 0 && (
            <nav className="flex items-center gap-2" aria-label={t('shell.table.pages')}>
              <span>
                {t('shell.table.range', {
                  from: formatNumber((p.page! - 1) * p.pageSize! + 1),
                  to: formatNumber(Math.min(p.total, p.page! * p.pageSize!)),
                  total: formatNumber(p.total),
                })}
              </span>
              <Button variant="secondary" size="icon" aria-label={t('common.prevPage')} disabled={p.page! <= 1} onClick={() => p.onPageChange?.(p.page! - 1)}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button
                variant="secondary"
                size="icon"
                aria-label={t('common.nextPage')}
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

/** Values filter in a column header: checkboxes, «reset» when something is selected. */
function HeaderFilter({ label, filter }: { label: string; filter: ColumnFilter }) {
  const active = filter.selected.length > 0;
  const toggle = (v: string, on: boolean) =>
    filter.onChange(on ? [...filter.selected, v] : filter.selected.filter((x) => x !== v));
  return (
    <M.Root>
      <M.Trigger asChild>
        <button
          type="button"
          aria-label={t('shell.table.filterBy', { label })}
          data-active={active || undefined}
          className={cn(
            'inline-flex items-center gap-0.5 rounded-sm p-0.5 hover:text-text',
            active && 'text-accent-text',
          )}
        >
          <ListFilter className="h-3 w-3" aria-hidden />
          {active && <span className="num text-[10px]">{filter.selected.length}</span>}
        </button>
      </M.Trigger>
      <M.Portal>
        <M.Content
          align="start"
          sideOffset={4}
          className="z-50 max-h-80 min-w-[180px] overflow-y-auto rounded-card border border-border bg-surface p-1 text-[13px] text-text shadow-lg"
        >
          {filter.options.map((o) => (
            <M.CheckboxItem
              key={o.value}
              checked={filter.selected.includes(o.value)}
              onCheckedChange={(on) => toggle(o.value, on === true)}
              onSelect={(e) => e.preventDefault()}
              title={o.title}
              className="flex cursor-pointer items-center gap-2 rounded-btn px-2 py-1.5 outline-hidden data-highlighted:bg-rail"
            >
              <span className="flex h-4 w-4 items-center justify-center rounded-sm border border-border">
                <M.ItemIndicator>
                  <Check className="h-3 w-3" aria-hidden />
                </M.ItemIndicator>
              </span>
              {o.label}
            </M.CheckboxItem>
          ))}
          {active && (
            <>
              <M.Separator className="my-1 h-px bg-border" />
              <M.Item
                onSelect={() => filter.onChange([])}
                className="cursor-pointer rounded-btn px-2 py-1.5 text-muted outline-hidden data-highlighted:bg-rail"
              >
                {t('shell.table.clearFilter')}
              </M.Item>
            </>
          )}
        </M.Content>
      </M.Portal>
    </M.Root>
  );
}
