/*
 * Layout «main area + side column» for every page with a narrow column next to its main content
 * (dashboard blocks, data and history panels of full cards, document previews of editors…).
 * - ≥ 1280 px (docked): the column is portalled into the side slot of the portal layout
 *   (<DetailPanelHost>), so it is a sibling of the content area, not its descendant: it does not move
 *   when the main area scrolls and spans from the top bar's bottom edge to the bottom of the window.
 *   What does not fit scrolls inside the column (<ColumnFrame>): the shared header is pinned at its top,
 *   the actions at its bottom, and the headings of its sections (cards) pin under the header in turn.
 * - < 1280 px (inline): the column is rendered where the page put it — after the main content — and
 *   scrolls with the page.
 * Pages render <SideColumn> after their main content; pages whose columns are equal in width keep
 * plain page scrolling. The list of pages and the decision for each: docs/DECISIONS.md.
 */
import type { CSSProperties, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/shared/lib/cn';
import { useDocked, useSplitHost } from './detail-panel';
import { ColumnFrame } from './sticky-sections';

export interface SideColumnProps {
  /** Accessible name of the column (an <aside> landmark). */
  label: string;
  /** Side of the content area: 'end' (right, default) or 'start' (left). */
  position?: 'start' | 'end';
  /** Width when docked: px or a CSS length (e.g. '50%'). */
  width?: number | string;
  /** Shared header, pinned at the top of the column. */
  header?: ReactNode;
  /** Action buttons, pinned at the bottom of the column. */
  footer?: ReactNode;
  /** 'plain': cards on the page background; 'panel': one white panel with a border. */
  variant?: 'plain' | 'panel';
  testId?: string;
  /** Classes of the inline (stacked) column below 1280 px. */
  inlineClassName?: string;
  /** Classes of the scrolling body when docked. */
  bodyClassName?: string;
  children: ReactNode;
}

export function SideColumn({ label, position = 'end', width = 320, header, footer, variant = 'plain', testId = 'side-column', inlineClassName, bodyClassName, children }: SideColumnProps) {
  const host = useSplitHost();
  const docked = useDocked();
  const slot = position === 'start' ? host?.startSlot : host?.endSlot;

  if (!docked || !host) {
    return (
      <aside aria-label={label} data-testid={testId} data-mode="inline" className={cn('mt-4 flex min-w-0 flex-col gap-4', inlineClassName)}>
        {header}
        {children}
        {footer}
      </aside>
    );
  }
  if (!slot) return null;
  const panel = variant === 'panel';
  const style: CSSProperties = { width };
  return createPortal(
    <aside
      aria-label={label}
      data-testid={testId}
      data-mode="docked"
      data-position={position}
      style={style}
      className={cn(
        'relative flex min-h-0 shrink-0 flex-col self-stretch print:hidden',
        panel ? 'bg-surface' : 'bg-bg',
        panel && (position === 'start' ? 'border-r border-border' : 'border-l border-border'),
      )}
    >
      <ColumnFrame
        header={header}
        footer={footer}
        headerClassName={cn(panel ? 'border-b border-border px-4 py-3' : 'bg-bg pb-2 pt-4 lg:pt-5', !panel && (position === 'start' ? 'pl-4 pr-2 lg:pl-5' : 'pl-2 pr-4 lg:pr-5'))}
        footerClassName={cn('flex flex-wrap gap-2 border-t border-border px-4 py-3', !panel && 'bg-bg')}
        bodyClassName={cn(
          'flex flex-col gap-4',
          panel ? 'p-4' : cn('py-4 lg:py-5', position === 'start' ? 'pl-4 pr-2 lg:pl-5' : 'pl-2 pr-4 lg:pr-5', header && 'pt-0 lg:pt-0'),
          bodyClassName,
        )}
        testIds={{ scroll: `${testId}-scroll`, header: `${testId}-header`, footer: `${testId}-footer` }}
      >
        {children}
      </ColumnFrame>
    </aside>,
    slot,
  );
}
